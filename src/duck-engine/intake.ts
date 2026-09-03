import type { DescribedColumn, EngineColumn } from "./protocol";

/**
 * The intake helpers shared by both `DuckEngineRuntime` adapters (slice 7):
 * describe the sniffed CSV, classify it, and build the materialization SQL.
 * The classified full schema is what becomes dataset metadata; the
 * materialized relation omits direct-identifier columns, so the value never
 * enters DuckDB (SECURITY.md: name-based detection is defense in depth on
 * top of the sensitive-by-default policy).
 */

/** Amendment 3's column ceiling, enforced on the described schema pre-materialization. */
export const MAX_IMPORT_COLUMNS = 5_000;

/**
 * Name-heuristic direct-identifier classification for imported columns.
 * Deliberately narrow: a false positive only omits a column from the
 * relation (metadata keeps it, flagged), a false negative is still contained
 * by the imported dataset's default `sensitive_aggregate_only` policy.
 */
const DIRECT_IDENTIFIER_PATTERNS: readonly RegExp[] = [
  /(^|_)ssn($|_)/,
  /social_?security/,
  /(^|_)mrn($|_)/,
  /medical_?record/,
  /patient_?id/,
  /(^|_)e_?mail($|_)/,
  /(^|_)(phone|telephone|mobile)($|_)/,
  /passport/,
  /driver_?licen[cs]e/,
  /national_?(id|insurance)/,
  /(^|_)nhs($|_)/,
  /(^|_)iban($|_)/,
  /(credit|debit)_?card/,
  /(^|_)card_?number($|_)/,
  /(^|_)tax_?id($|_)/,
];

export function classifyIntakeColumn(name: string): DescribedColumn["classification"] {
  const normalized = name.trim().toLowerCase().replaceAll(/[\s-]+/g, "_");
  return DIRECT_IDENTIFIER_PATTERNS.some((pattern) => pattern.test(normalized))
    ? "direct_identifier"
    : "public";
}

/** The ceiling denial: a `VALIDATION_ERROR`-shaped engine failure via the handler's translation. */
export class IntakeCeilingError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, string | number | boolean | null>,
  ) {
    super(message);
  }
}

/**
 * Classifies the described columns and enforces the column ceiling. Throws
 * {@link IntakeCeilingError} (a `VALIDATION_ERROR`, pre-execution) when the
 * file carries more than {@link MAX_IMPORT_COLUMNS} columns.
 */
export function describeIntakeColumns(columns: readonly EngineColumn[]): DescribedColumn[] {
  if (columns.length > MAX_IMPORT_COLUMNS) {
    throw new IntakeCeilingError(
      `That file has ${columns.length} columns — the import ceiling is ${MAX_IMPORT_COLUMNS}.`,
      { field: "columns", columns: columns.length, maximum: MAX_IMPORT_COLUMNS },
    );
  }
  return columns.map((column) => ({ ...column, classification: classifyIntakeColumn(column.name) }));
}

/**
 * The materialized column list: every described column minus direct
 * identifiers. An all-identifier file has nothing analyzable, so it denies
 * the same way the ceilings do rather than building an empty relation.
 */
export function materializedIntakeColumns(columns: readonly DescribedColumn[]): EngineColumn[] {
  const materialized = columns.filter((column) => column.classification !== "direct_identifier");
  if (columns.length > 0 && materialized.length === 0) {
    throw new IntakeCeilingError(
      "Every column in that file looks like a direct identifier — there is nothing to analyze.",
      { field: "columns", omitted: columns.length },
    );
  }
  return materialized.map(({ name, type }) => ({ name, type }));
}

/** The virtual FS file name the buffer registers under — SQL- and path-safe. */
export function intakeFileName(name: string): string {
  const stem =
    name
      .replace(/\.[^.]*$/, "")
      .replaceAll(/[^A-Za-z0-9_-]+/g, "_")
      .slice(0, 60) || "file";
  return `${stem}.csv`;
}

/**
 * The one materialization statement: `CREATE OR REPLACE` so re-importing the
 * same file (same digest suffix) rebuilds the relation in place, and the
 * explicit projection is the custody omission rule — direct identifiers are
 * never in the column list at all.
 */
export function buildIntakeSql(relation: string, fileName: string, columns: readonly EngineColumn[]): string {
  const projection = columns.map((column) => `"${column.name}"`).join(", ");
  return `CREATE OR REPLACE TABLE ${relation} AS SELECT ${projection} FROM read_csv('${fileName}')`;
}
