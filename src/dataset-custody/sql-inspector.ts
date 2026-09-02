import type { BindingValue, CustodyFailure } from "./schemas";

/**
 * The SQL inspector (ADR 0002; §6; grilling 22): the trust seam between the
 * workspace and the worker. Exactly one read-only `SELECT`/`WITH` statement
 * survives this module; unsafe SQL never crosses the worker boundary.
 *
 * Enforcement order is pinned by grilling 22 and must not be reordered:
 * statement count → head keyword → forbidden constructs → relation
 * references → binding interpolation. Deny-list violations return
 * `UNSAFE_SQL`, malformed or interpolated bindings `VALIDATION_ERROR`,
 * relations outside the authorized set `DATASET_UNAVAILABLE` — never a
 * DuckDB error (the worker sees only inspected SQL).
 */

/** The pre-release schema columns the kernel type-checks bindings against. */
export interface InspectorColumn {
  readonly name: string;
  readonly type: string;
}

export interface SqlInspection {
  /** SQL with every named `$binding` rewritten to positional `$1..$n` (first appearance, left to right). */
  readonly positionalSql: string;
  /** Binding names in positional order; the kernel type-checks and orders the values. */
  readonly bindingOrder: readonly string[];
  readonly hasGrouping: boolean;
  /** Raw `GROUP BY` expressions, verbatim from the statement (empty for `GROUP BY ALL`). */
  readonly groupExpressions: readonly string[];
  /** Raw `WHERE` clause, verbatim; null when absent. */
  readonly whereExpression: string | null;
  readonly hasAggregate: boolean;
}

export type InspectResult =
  | { readonly ok: true; readonly inspection: SqlInspection }
  | { readonly ok: false; readonly failure: CustodyFailure };

export interface InspectInput {
  readonly sql: string;
  readonly bindings: Readonly<Record<string, BindingValue>>;
  readonly authorizedRelations: readonly string[];
  readonly schema: readonly InspectorColumn[];
  /**
   * Re-inspection mode for already-authorized positional SQL (release
   * planning): binding presence and positional-reference checks are
   * skipped, and the SQL is left untouched.
   */
  readonly skipBindings?: boolean;
}

interface Token {
  readonly kind: "word" | "string" | "quotedIdent" | "param" | "positionalParam" | "punct" | "number";
  readonly text: string;
  /** String/identifier content with quotes and escapes resolved; `text` for the rest. */
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

const CLAUSE_WORDS = new Set([
  "SELECT", "FROM", "WHERE", "GROUP", "BY", "HAVING", "ORDER", "LIMIT", "OFFSET", "WINDOW", "QUALIFY",
  "WITH", "UNION", "EXCEPT", "INTERSECT", "VALUES",
]);

const AGGREGATE_WORDS = new Set([
  "COUNT", "SUM", "AVG", "MIN", "MAX", "TOTAL", "MEDIAN", "MODE", "STRING_AGG", "LIST", "ARRAY_AGG",
  "FIRST", "LAST", "PRODUCT", "STDDEV", "VARIANCE", "BOOL_AND", "BOOL_OR",
]);

/** §6: DDL, DML, transaction control, external data, extension loading, session mutation. */
const FORBIDDEN_WORDS = new Set([
  "ATTACH", "DETACH", "COPY", "EXPORT", "IMPORT", "INSTALL", "LOAD", "CALL", "PRAGMA",
  "CREATE", "DROP", "ALTER", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "MERGE", "VACUUM",
  "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "SET", "RESET", "CHECKPOINT", "ANALYZE",
  "GRANT", "REVOKE", "PREPARE", "EXECUTE", "DESCRIBE", "SUMMARIZE", "INTO",
]);

/** A `$` inside a string literal followed by an identifier character is the interpolation signature (`'$name'`). */
const INTERPOLATION_IN_LITERAL = /\$[A-Za-z_]/;

const EXTERNAL_URL_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

function unsafe(blockedConstruct: string, details: Record<string, string | number | boolean | null> = {}): InspectResult {
  return {
    ok: false,
    failure: {
      code: "UNSAFE_SQL",
      message: `The statement uses the blocked construct "${blockedConstruct}" (SQL execution policy §6).`,
      retryable: false,
      details: { blockedConstruct, ...details },
    },
  };
}

function validation(details: Record<string, string | number | boolean | null>, reason: string): InspectResult {
  return {
    ok: false,
    failure: {
      code: "VALIDATION_ERROR",
      message: `The statement or its bindings are malformed: ${reason}.`,
      retryable: false,
      details,
    },
  };
}

function datasetUnavailableFailure(relation: string): CustodyFailure {
  return {
    code: "DATASET_UNAVAILABLE",
    message: `The statement references "${relation}", which is not the authorized source relation.`,
    retryable: true,
    details: { relation },
  };
}

/**
 * Lexes the whole statement in one pass, keeping source offsets so raw
 * expressions (GROUP BY items) can be sliced verbatim. String literals and
 * comments never produce word tokens, so deny-list scanning cannot be
 * fooled by `SELECT 'DROP TABLE'` or comments.
 */
export function lexSql(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const isWordChar = (ch: string) => /[A-Za-z0-9_]/.test(ch);
  while (i < sql.length) {
    const ch = sql[i] as string;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === "'") {
      const start = i;
      i += 1;
      let value = "";
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          value += "'";
          i += 2;
        } else if (sql[i] === "'") {
          i += 1;
          break;
        } else {
          value += sql[i];
          i += 1;
        }
      }
      tokens.push({ kind: "string", text: sql.slice(start, i), value, start, end: i });
      continue;
    }
    if (ch === '"') {
      const start = i;
      i += 1;
      let value = "";
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          value += '"';
          i += 2;
        } else if (sql[i] === '"') {
          i += 1;
          break;
        } else {
          value += sql[i];
          i += 1;
        }
      }
      tokens.push({ kind: "quotedIdent", text: sql.slice(start, i), value, start, end: i });
      continue;
    }
    if (ch === "$") {
      const start = i;
      i += 1;
      while (i < sql.length && isWordChar(sql[i] as string)) i += 1;
      const text = sql.slice(start, i);
      tokens.push({ kind: /^\$\d+$/.test(text) ? "positionalParam" : "param", text, value: text.slice(1), start, end: i });
      continue;
    }
    if (isWordChar(ch)) {
      const start = i;
      while (i < sql.length && isWordChar(sql[i] as string)) i += 1;
      const text = sql.slice(start, i);
      tokens.push({ kind: /^\d/.test(text) ? "number" : "word", text, value: text, start, end: i });
      continue;
    }
    tokens.push({ kind: "punct", text: ch, value: ch, start: i, end: i + 1 });
    i += 1;
  }
  return tokens;
}

/** Word (or quoted identifier) token at `k`, else null. */
function nameToken(tokens: readonly Token[], k: number): Token | null {
  const token = tokens[k];
  return token && (token.kind === "word" || token.kind === "quotedIdent") ? token : null;
}

/** Depth-aware relation scan: every candidate named after FROM/JOIN (any depth) must be authorized or a CTE. */
function checkRelations(tokens: readonly Token[], authorized: ReadonlySet<string>): CustodyFailure | null {
  // CTE names are relations the statement itself defines.
  const defined = new Set<string>();
  let i = 0;
  const first = tokens[0];
  if (first?.kind === "word" && first.text.toUpperCase() === "WITH") {
    i = 1;
    const afterWith = tokens[i];
    if (afterWith?.kind === "word" && afterWith.text.toUpperCase() === "RECURSIVE") i += 1;
    while (i < tokens.length) {
      const name = nameToken(tokens, i);
      if (!name) return null;
      defined.add(name.value);
      let j = i + 1;
      if (tokens[j]?.text === "(") {
        // Optional explicit column list: `WITH t(a, b) AS (...)`.
        let depth = 1;
        j += 1;
        while (j < tokens.length && depth > 0) {
          const token = tokens[j];
          if (!token) break;
          if (token.text === "(") depth += 1;
          if (token.text === ")") depth -= 1;
          j += 1;
        }
      }
      if (tokens[j]?.text.toUpperCase() !== "AS" || tokens[j + 1]?.text !== "(") return null;
      let depth = 1;
      j += 2;
      while (j < tokens.length && depth > 0) {
        const token = tokens[j];
        if (!token) break;
        if (token.text === "(") depth += 1;
        if (token.text === ")") depth -= 1;
        j += 1;
      }
      i = j;
      if (tokens[i]?.text === ",") {
        i += 1;
        continue;
      }
      break;
    }
  }

  const known = (candidate: string) => authorized.has(candidate) || defined.has(candidate);

  /** Checks every relation named in the from-items following one FROM/JOIN. */
  function checkFromItems(tokens: readonly Token[], fromIndex: number): CustodyFailure | null {
    let pos = fromIndex + 1;
    let expectingName = true;
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (!t) break;
      if (t.text === "(") {
        // Derived table or parenthesized group: contents carry their own
        // FROMs, which the main scan reaches on its own.
        let d = 1;
        pos += 1;
        while (pos < tokens.length && d > 0) {
          const u = tokens[pos];
          if (!u) break;
          if (u.text === "(") d += 1;
          if (u.text === ")") d -= 1;
          pos += 1;
        }
        expectingName = false;
        continue;
      }
      if (t.text === ")") break;
      if (t.text === "," && !expectingName) {
        expectingName = true;
        pos += 1;
        continue;
      }
      if (t.kind !== "word" && t.kind !== "quotedIdent") break;
      const upper = t.text.toUpperCase();
      if (t.kind === "word") {
        if (expectingName && (upper === "LATERAL" || upper === "UNNEST")) {
          pos += 1;
          continue;
        }
        if (upper === "JOIN") {
          expectingName = true;
          pos += 1;
          continue;
        }
        if (!expectingName && (upper === "INNER" || upper === "LEFT" || upper === "RIGHT" || upper === "FULL" || upper === "CROSS" || upper === "OUTER" || upper === "NATURAL" || upper === "AS")) {
          pos += 1;
          continue;
        }
        if (!expectingName && (upper === "ON" || upper === "USING" || CLAUSE_WORDS.has(upper))) break;
      }
      if (expectingName) {
        // Candidate relation, with an optional dotted prefix (`main.t`).
        let end = pos;
        while (tokens[end + 1]?.text === "." && nameToken(tokens, end + 2)) end += 2;
        const relationName = (tokens[end] as Token).value;
        if (!known(relationName)) {
          return datasetUnavailableFailure(relationName);
        }
        pos = end + 1;
        expectingName = false;
        continue;
      }
      // Alias position: consume the bare name or `AS name`.
      pos += 1;
    }
    return null;
  }

  for (let k = 0; k < tokens.length; k += 1) {
    const word = tokens[k];
    if (!word || word.kind !== "word") continue;
    const upper = word.text.toUpperCase();
    if (upper !== "FROM" && upper !== "JOIN") continue;
    const failure = checkFromItems(tokens, k);
    if (failure) return failure;
  }
  return null;
}

export function inspectSql(input: InspectInput): InspectResult {
  const { sql, bindings, authorizedRelations, skipBindings = false } = input;
  if (!sql.trim()) {
    return validation({ field: "sql" }, "the statement is empty");
  }
  const tokens = lexSql(sql);

  // 1. Statement count — one statement, one optional trailing semicolon.
  const meaningful = [...tokens];
  if (meaningful[meaningful.length - 1]?.text === ";") meaningful.pop();
  if (meaningful.some((token) => token.text === ";")) {
    return unsafe("multiple_statements");
  }

  // 2. Head keyword — SELECT or WITH after comments/whitespace.
  const head = meaningful[0];
  const headUpper = head?.kind === "word" ? head.text.toUpperCase() : "";
  if (headUpper !== "SELECT" && headUpper !== "WITH") {
    return unsafe("head_keyword", { found: head?.text ?? "" });
  }

  // 3. Forbidden constructs — deny list over word tokens and string contents.
  for (let k = 0; k < meaningful.length; k += 1) {
    const token = meaningful[k] as Token;
    if (token.kind === "word") {
      const upper = token.text.toUpperCase();
      if (FORBIDDEN_WORDS.has(upper)) {
        return unsafe(upper.toLowerCase());
      }
      const next = meaningful[k + 1];
      if (next?.text === "(" && (upper.startsWith("READ_") || upper.endsWith("_SCAN") || upper === "GLOB")) {
        return unsafe("external_scan", { function: upper });
      }
    }
    if (token.kind === "string") {
      if (EXTERNAL_URL_PATTERN.test(token.value)) {
        return unsafe("external_url");
      }
      if (INTERPOLATION_IN_LITERAL.test(token.value)) {
        return validation(
          { field: "sql", reason: "interpolated_binding" },
          "a binding reference appears inside a string literal",
        );
      }
    }
  }
  if (sql.includes("${")) {
    return validation({ field: "sql", reason: "interpolated_binding" }, "a template interpolation appears in the statement");
  }

  // 4. Relation references — the authorized set plus the statement's own CTEs.
  const relationFailure = checkRelations(meaningful, new Set(authorizedRelations));
  if (relationFailure) {
    return { ok: false, failure: relationFailure };
  }

  // 5. Binding interpolation and the positional rewrite (first appearance,
  // left to right), plus the statement-shape scan the release pipeline
  // composes from (GROUP BY items, WHERE clause, aggregate presence).
  const bindingOrder: string[] = [];
  let rebuilt = "";
  let cursor = 0;
  let hasGrouping = false;
  let groupExpressions: string[] = [];
  let whereExpression: string | null = null;
  let hasAggregate = false;

  for (let k = 0; k < meaningful.length; k += 1) {
    const token = meaningful[k] as Token;
    if (token.kind === "param" && !skipBindings) {
      if (!Object.prototype.hasOwnProperty.call(bindings, token.value)) {
        return validation(
          { field: token.value, reason: "missing_binding" },
          `binding "${token.value}" is referenced but not supplied`,
        );
      }
      let index = bindingOrder.indexOf(token.value);
      if (index === -1) {
        bindingOrder.push(token.value);
        index = bindingOrder.length - 1;
      }
      rebuilt += sql.slice(cursor, token.start) + `$${index + 1}`;
      cursor = token.end;
      continue;
    }
    if (token.kind === "positionalParam" && !skipBindings) {
      return validation(
        { field: token.text, reason: "positional_ref" },
        "positional references must use named bindings",
      );
    }
    const upper = token.kind === "word" ? token.text.toUpperCase() : "";
    if (upper === "GROUP" && meaningful[k + 1]?.text.toUpperCase() === "BY") {
      hasGrouping = true;
      // Slice the raw expressions between BY and the next clause boundary.
      const items: Array<{ start: number; end: number }> = [];
      let depth = 0;
      let current: { start: number; end: number } | null = null;
      for (let by = k + 2; by < meaningful.length; by += 1) {
        const t = meaningful[by] as Token;
        if (depth === 0) {
          if (t.text === ",") {
            if (current) items.push(current);
            current = null;
            continue;
          }
          if (t.kind === "word" && (CLAUSE_WORDS.has(t.text.toUpperCase()) || t.text.toUpperCase() === ";")) break;
        }
        if (!current) current = { start: t.start, end: t.end };
        else current.end = t.end;
        if (t.text === "(") depth += 1;
        if (t.text === ")") depth -= 1;
        k = by;
      }
      if (current) items.push(current);
      groupExpressions = items.map((item) => sql.slice(item.start, item.end).trim());
      if (groupExpressions.length === 1 && groupExpressions[0]?.toUpperCase() === "ALL") {
        // `GROUP BY ALL` names no columns; the cohort probe cannot be composed.
        groupExpressions = [];
      }
      continue;
    }
    if (upper === "WHERE") {
      // Raw WHERE slice, verbatim to the next top-level clause boundary —
      // the cohort probe runs the statement's own filter.
      const startToken = meaningful[k + 1];
      if (startToken) {
        let depth = 0;
        let last = k;
        for (let w = k + 1; w < meaningful.length; w += 1) {
          const t = meaningful[w] as Token;
          if (depth === 0 && t.kind === "word" && CLAUSE_WORDS.has(t.text.toUpperCase())) break;
          if (t.text === "(") depth += 1;
          if (t.text === ")") depth -= 1;
          last = w;
        }
        if (last > k) {
          whereExpression = sql.slice(startToken.start, (meaningful[last] as Token).end).trim();
        }
      }
      continue;
    }
    if (token.kind === "word" && AGGREGATE_WORDS.has(upper) && meaningful[k + 1]?.text === "(") {
      hasAggregate = true;
    }
  }
  rebuilt += sql.slice(cursor);

  return {
    ok: true,
    inspection: {
      positionalSql: skipBindings ? sql : rebuilt,
      bindingOrder,
      hasGrouping,
      groupExpressions,
      whereExpression,
      hasAggregate: hasAggregate || hasGrouping,
    },
  };
}
