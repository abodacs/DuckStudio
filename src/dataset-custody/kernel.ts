import type { PresetColumn, PresetMetadata } from "../demo-presets/schemas";
import {
  BUDGET_DEFAULTS,
  BUDGET_HARD_MAX,
  ClampedBudgetSchema,
  EVIDENCE_LIMITATIONS,
  EvidenceSnapshotSchema,
  type AuthorizedDecision,
  type BindingValue,
  type BudgetRequest,
  type ClampedBudget,
  type CustodyFailure,
  type EvidenceSnapshot,
  type GovernedSource,
  type ReleaseDecision,
} from "./schemas";
import { inspectSql, lexSql } from "./sql-inspector";

/**
 * The custody kernel (§5; ARCHITECTURE.md): policy, SQL inspection, budget
 * clamping, release, cohort confirmation, and upload/release evidence are
 * this one module. Callers authorize before the worker sees SQL and decide
 * release after materialization; denial commits nothing.
 *
 * Raw binding values never leave the kernel — not in decisions, errors, or
 * evidence (§4.3; SECURITY.md). The decision carries the clamped budget
 * (grilling 21) and the engine consumes it verbatim.
 */

export type KernelWarnings = readonly {
  readonly code: "BUDGET_CLAMPED";
  readonly message: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}[];

export type AuthorizeResult =
  | { readonly ok: true; readonly decision: AuthorizedDecision; readonly warnings: KernelWarnings }
  | { readonly ok: false; readonly failure: CustodyFailure };

export interface AuthorizeInput {
  readonly source: GovernedSource;
  readonly sql: string;
  readonly bindings: Readonly<Record<string, BindingValue>>;
  readonly requestedBudget?: BudgetRequest;
}

export interface ReleaseInput {
  readonly source: GovernedSource;
  /** The executed statement, for statement-shape classification (aggregate vs row-level). */
  readonly sql: string;
  readonly resultSchema: readonly { readonly name: string; readonly type: string }[];
  /** Smallest cohort in the output, from the kernel's probe; null when unprobed. */
  readonly minCohortCount: number | null;
  readonly redactedBindingKeys: readonly string[];
  readonly materializedRows: number;
  readonly budget: ClampedBudget;
}

export type ReleaseResult =
  | { readonly ok: true; readonly release: ReleaseDecision }
  | { readonly ok: false; readonly failure: CustodyFailure };

/** Runs the kernel's authorized cohort probe; returns min_cohort, null when the probe read nothing. */
export type CohortProbeExecutor = (decision: AuthorizedDecision) => Promise<number | null>;

export interface ConfirmReleaseInput {
  readonly source: GovernedSource;
  /** The authorized decision from {@link CustodyKernel.authorize}; its budget and redactions carry through. */
  readonly decision: AuthorizedDecision;
  /** The original statement, for the differencing guard's shape classification. */
  readonly sql: string;
  /** The named bindings, re-authorized for the probe statement. */
  readonly bindings: Readonly<Record<string, BindingValue>>;
  readonly resultSchema: readonly { readonly name: string; readonly type: string }[];
  readonly materializedRows: number;
  /** The governed relation's row count — an unfiltered global aggregate's cohort. */
  readonly sourceRowCount: number;
  readonly executeProbe: CohortProbeExecutor;
}

/** Statement shape the release pipeline and the cohort probe compose from. */
export interface StatementPlan {
  readonly hasAggregate: boolean;
  readonly hasGrouping: boolean;
  /** Raw GROUP BY expressions; empty for `GROUP BY ALL` (no probe possible). */
  readonly groupExpressions: readonly string[];
  /** Raw WHERE clause; null when absent. */
  readonly whereExpression: string | null;
  /** A row-reassembling function (`FIRST`, `ANY_VALUE`, …) was applied. */
  readonly reassembles: boolean;
  /** The first reassembling function applied (e.g. `FIRST`); null when none. */
  readonly reassemblingFn: string | null;
}

/** The kernel is stateful only in its evidence counters and monitored transports. */
export interface CustodyKernel {
  authorize(input: AuthorizeInput): AuthorizeResult;
  /** Kernel-authored cohort probe: `MIN(count per group)` over the statement's grouping and filter. */
  cohortProbeSql(relation: string, groupExpressions: readonly string[], whereExpression?: string | null): string;
  /** Statement shape, from the same inspection authorize ran — the probe composer's input. */
  inspectStatement(sql: string, authorizedRelations: readonly string[]): StatementPlan;
  decideRelease(input: ReleaseInput): ReleaseResult;
  /**
   * §5.1 release confirm — the differencing guard and the release decision in
   * one entry (CONTEXT.md: the kernel's pieces are never invoked directly).
   * Callers authorize before the worker sees SQL, execute and materialize,
   * then confirm here; the guard authors and authorizes the cohort probe
   * itself and hands `executeProbe` the authorized probe to run. A probe that
   * fails or reads nothing proves no cohort, and a sensitive aggregate
   * without a provable cohort is denied.
   */
  confirmRelease(input: ConfirmReleaseInput): Promise<ReleaseResult>;
  /** Registers a payload derived from preset relations so transports can account for it. */
  noteDatasetPayload(payload: unknown): void;
  /** Byte count when the payload is a registered dataset payload, else 0. */
  datasetPayloadBytes(payload: unknown): number;
  /** Records dataset bytes that crossed a monitored transport boundary. */
  recordDatasetUpload(bytes: number): void;
  recordTransportCoverage(coverage: readonly string[]): void;
  evidence(scope: { readonly kind: "workspace" | "operation" | "artifact"; readonly id: string }, policy?: PresetMetadata["policy"] | null): EvidenceSnapshot;
}

const REDACTED_CLASSIFICATIONS = new Set(["direct_identifier", "sensitive"]);

/**
 * §4.6 clamping (grilling 21): a request above a hard maximum is
 * `VALIDATION_ERROR`; a legal request above the workspace default is clamped
 * down with `BUDGET_CLAMPED`; a stricter request is honored untouched.
 */
function clampBudget(
  requested: BudgetRequest | undefined,
): { ok: true; budget: ClampedBudget; warnings: KernelWarnings } | { ok: false; failure: CustodyFailure } {
  const warnings: {
    code: "BUDGET_CLAMPED";
    message: string;
    details: Record<string, string | number | boolean | null>;
  }[] = [];
  const budget: ClampedBudget = { ...BUDGET_DEFAULTS };
  for (const axis of ["executionMs", "resultRows", "chartPoints"] as const) {
    const requestedValue = requested?.[axis];
    if (requestedValue === undefined) continue;
    if (requestedValue > BUDGET_HARD_MAX[axis]) {
      return {
        ok: false,
        failure: {
          code: "VALIDATION_ERROR",
          message: `The requested ${axis} exceeds the hard maximum of ${BUDGET_HARD_MAX[axis]}.`,
          retryable: false,
          details: { axis, requested: requestedValue, hardMaximum: BUDGET_HARD_MAX[axis] },
        },
      };
    }
    if (requestedValue > BUDGET_DEFAULTS[axis]) {
      warnings.push({
        code: "BUDGET_CLAMPED",
        message: `The requested ${axis} was clamped to the workspace budget of ${BUDGET_DEFAULTS[axis]}.`,
        details: { axis, requested: requestedValue, effective: BUDGET_DEFAULTS[axis] },
      });
      continue;
    }
    budget[axis] = requestedValue;
  }
  const parsed = ClampedBudgetSchema.safeParse(budget);
  if (!parsed.success) {
    return {
      ok: false,
      failure: {
        code: "INTERNAL_ERROR",
        message: "The clamped budget failed its own schema; this is a kernel defect.",
        retryable: false,
        details: { axis: "budget" },
      },
    };
  }
  return { ok: true, budget: parsed.data, warnings };
}

/**
 * Binding type check (grilling 21): a binding whose name matches a schema
 * column must carry a value of that column's type; `null` always passes as
 * NULL (preset tables carry no NOT NULL constraints).
 */
function bindingTypeMismatch(value: BindingValue, columnType: string): string | null {
  if (value === null) return null;
  const base = columnType.toUpperCase().split("(")[0] ?? columnType.toUpperCase();
  if (base === "VARCHAR" || base === "TEXT" || base === "STRING") return typeof value === "string" ? null : "string";
  if (base === "BOOLEAN") return typeof value === "boolean" ? null : "boolean";
  if (base === "DOUBLE" || base === "FLOAT" || base === "REAL") return typeof value === "number" ? null : "number";
  if (base.startsWith("DECIMAL")) return typeof value === "number" ? null : "number";
  if (base === "INTEGER" || base === "BIGINT" || base === "SMALLINT" || base === "TINYINT" || base === "HUGEINT") {
    return typeof value === "number" && Number.isInteger(value) ? null : "integer";
  }
  return null;
}

/** Classification of the materialized result columns, by name, through the source's digest. */
function resultColumnClassifications(
  source: { readonly columns: readonly PresetColumn[] },
  resultSchema: readonly { readonly name: string; readonly type: string }[],
): Map<string, PresetColumn["classification"]> {
  const byName = new Map(source.columns.map((column) => [column.name, column.classification]));
  return new Map(resultSchema.map((column) => [column.name, byName.get(column.name) ?? "public"]));
}

/** First token naming a direct-identifier column of the source, else null. */
function referencesIdentifierColumn(sql: string, source: GovernedSource): string | null {
  const identifiers = new Set(
    source.columns.filter((c) => c.classification === "direct_identifier").map((c) => c.name.toUpperCase()),
  );
  if (identifiers.size === 0) return null;
  for (const token of lexSql(sql)) {
    if ((token.kind === "word" || token.kind === "quotedIdent") && identifiers.has(token.value.toUpperCase())) {
      return token.value;
    }
  }
  return null;
}

function inspectStatementShape(sql: string, authorizedRelations: readonly string[]): StatementPlan {
  // Planning mode: the SQL is already authorized; bindings are not re-checked.
  const inspection = inspectSql({
    sql,
    bindings: {},
    authorizedRelations,
    schema: [],
    skipBindings: true,
  });
  if (!inspection.ok) {
    return {
      hasAggregate: false,
      hasGrouping: false,
      groupExpressions: [],
      whereExpression: null,
      reassembles: false,
      reassemblingFn: null,
    };
  }
  const shaped = inspection.inspection;
  return {
    hasAggregate: shaped.hasAggregate,
    hasGrouping: shaped.hasGrouping,
    groupExpressions: [...shaped.groupExpressions],
    whereExpression: shaped.whereExpression,
    reassembles: shaped.reassembles,
    reassemblingFn: shaped.reassemblingFn,
  };
}

/**
 * §5.1 differencing guard, one home: grouped aggregates probe
 * `MIN(count per group)` with kernel-authored SQL re-authorized as its own
 * decision; an unfiltered global aggregate's single cohort is the whole
 * relation; a filtered global aggregate has no provable cohort — denied.
 * A probe that cannot run (execution or authorization failure) proves no
 * cohort and is denied the same way.
 */
async function probeCohortCount(
  kernel: CustodyKernel,
  source: GovernedSource,
  sql: string,
  bindings: Readonly<Record<string, BindingValue>>,
  sourceRowCount: number,
  executeProbe: CohortProbeExecutor,
): Promise<number | null> {
  const plan = kernel.inspectStatement(sql, [source.relation]);
  if (!plan.hasAggregate) return null;
  if (plan.hasGrouping) {
    if (plan.groupExpressions.length === 0) return null;
    const probeSql = kernel.cohortProbeSql(source.relation, plan.groupExpressions, plan.whereExpression);
    const probe = kernel.authorize({ source, sql: probeSql, bindings });
    if (!probe.ok) return null;
    try {
      return await executeProbe(probe.decision);
    } catch {
      return null;
    }
  }
  return plan.whereExpression === null ? sourceRowCount : null;
}

/**
 * The governed view of a preset dataset: its relation is the datasetId the
 * worker materialized it under (grilling 23). Slice 3's artifact sources
 * build their GovernedSource from the committed artifact instead.
 */
export function governedSource(preset: PresetMetadata): GovernedSource {
  return {
    relation: preset.datasetId,
    policy: preset.policy,
    minimumCohortSize: preset.minimumCohortSize,
    columns: preset.columns,
  };
}

export function createCustodyKernel(now: () => string = () => new Date().toISOString()): CustodyKernel {
  let datasetBytesUploaded = 0;
  let rawSensitiveValuesReleasedToTools = 0;
  let rawSensitiveValuesReleasedToSharedCanvas = 0;
  let monitoredTransports: readonly string[] = [];
  const datasetPayloads = new WeakSet<object>();
  const datasetPayloadStrings = new Set<string>();

  const api: CustodyKernel = {
    authorize(input) {
      const { source, sql, bindings, requestedBudget } = input;
      const inspection = inspectSql({
        sql,
        bindings,
        authorizedRelations: [source.relation],
        schema: source.columns,
      });
      if (!inspection.ok) {
        return { ok: false, failure: inspection.failure };
      }
      const { positionalSql, bindingOrder } = inspection.inspection;

      const positionalBindings: BindingValue[] = [];
      const redactedBindingKeys: string[] = [];
      const classification = new Map(source.columns.map((column) => [column.name, column]));
      for (const name of bindingOrder) {
        const value = bindings[name] as BindingValue;
        const column = classification.get(name);
        if (column) {
          const mismatch = bindingTypeMismatch(value, column.type);
          if (mismatch) {
            return {
              ok: false,
              failure: {
                code: "VALIDATION_ERROR",
                message: `The binding "${name}" does not match the column type ${column.type}; expected ${mismatch}.`,
                retryable: false,
                details: { field: name, expected: column.type, got: typeof value },
              },
            };
          }
          if (REDACTED_CLASSIFICATIONS.has(column.classification)) {
            redactedBindingKeys.push(name);
          }
        }
        positionalBindings.push(value);
      }

      const clamped = clampBudget(requestedBudget);
      if (!clamped.ok) {
        return clamped;
      }
      return {
        ok: true,
        decision: {
          authorizedRelation: source.relation,
          positionalSql,
          positionalBindings,
          budget: clamped.budget,
          redactedBindingKeys,
          releasePolicy: source.policy,
        },
        warnings: clamped.warnings,
      };
    },

    cohortProbeSql(relation, groupExpressions, whereExpression) {
      const where = whereExpression ? ` WHERE ${whereExpression}` : "";
      return `SELECT MIN(n) AS min_cohort FROM (SELECT COUNT(*) AS n FROM ${relation}${where} GROUP BY ${groupExpressions.join(", ")})`;
    },

    inspectStatement(sql, authorizedRelations) {
      return inspectStatementShape(sql, authorizedRelations);
    },

    decideRelease(input) {
      const { source, sql, resultSchema, minCohortCount, redactedBindingKeys, materializedRows, budget } = input;
      const { relation, policy, minimumCohortSize, columns } = source;

      // §5.1 row 5: direct-identifier values never leave, in any policy.
      const classifications = resultColumnClassifications(source, resultSchema);
      const identifierColumns = [...classifications.entries()]
        .filter(([, classification]) => classification === "direct_identifier")
        .map(([name]) => name);
      if (identifierColumns.length > 0) {
        const failure: CustodyFailure = {
          code: "POLICY_DENIED",
          message: "The result would release direct-identifier values, which never leave custody.",
          retryable: false,
          details: { blockedFields: identifierColumns.join(",") },
        };
        return { ok: false, failure };
      }

      const sensitive = policy === "sensitive_aggregate_only";
      if (sensitive) {
        const shape = inspectStatementShape(sql, [relation]);
        // §5.1: raw grids are suppressed; only aggregates survive.
        if (!shape.hasAggregate) {
          const failure: CustodyFailure = {
            code: "POLICY_DENIED",
            message: "The dataset is sensitive_aggregate_only; raw rows are suppressed and only aggregates release.",
            retryable: false,
            details: { blockedFields: resultSchema.map((column) => column.name).join(",") },
          };
          return { ok: false, failure };
        }
        // §5.1: an aggregate that reassembles a raw per-row value (FIRST,
        // ANY_VALUE, …) is an aggregate by shape only and cannot release.
        if (shape.reassembles) {
          const failure: CustodyFailure = {
            code: "POLICY_DENIED",
            message: `Sensitive datasets release aggregates only; ${shape.reassemblingFn}() reassembles a raw row value and cannot release.`,
            retryable: false,
            details: { blockedFields: shape.reassemblingFn ?? "" },
          };
          return { ok: false, failure };
        }
        // Identifier provenance, statement-level by design: on a sensitive
        // source any reference to a direct-identifier column — aliased,
        // wrapped, or through a CTE — can only feed the result, so it is
        // denied regardless of the result schema's names.
        const identifierToken = referencesIdentifierColumn(sql, source);
        if (identifierToken !== null) {
          const failure: CustodyFailure = {
            code: "POLICY_DENIED",
            message: "The result would derive from direct-identifier values, which never leave custody.",
            retryable: false,
            details: { blockedFields: identifierToken },
          };
          return { ok: false, failure };
        }
        // §5.1: every cohort must have at least `minimumCohortSize` source rows.
        if (minCohortCount === null || minCohortCount < minimumCohortSize) {
          const failure: CustodyFailure = {
            code: "POLICY_DENIED",
            message: `A cohort is below the minimum size of ${minimumCohortSize}; the aggregate cannot release.`,
            retryable: false,
            details: {
              cohortMinimum: minimumCohortSize,
              observedCohort: minCohortCount ?? -1,
            },
          };
          return { ok: false, failure };
        }
      }

      const omittedDirectIdentifiers = sensitive
        ? columns.filter((column) => column.classification === "direct_identifier").map((column) => column.name)
        : [];
      const rawRowsToSharedCanvas = sensitive ? 0 : Math.min(materializedRows, budget.resultRows);
      // Sensitive values release only when a public policy exposes sensitive-classified columns.
      const releasedSensitiveRows =
        !sensitive && resultSchema.some((column) => classifications.get(column.name) === "sensitive")
          ? rawRowsToSharedCanvas
          : 0;
      rawSensitiveValuesReleasedToSharedCanvas += releasedSensitiveRows;

      const suppressed = omittedDirectIdentifiers.length > 0 || redactedBindingKeys.length > 0;
      return {
        ok: true,
        release: {
          status: suppressed ? "downgraded" : "allowed",
          rawRowsToAgent: 0,
          rawRowsToSharedCanvas,
          omittedDirectIdentifiers,
          cohortMinimum: minimumCohortSize,
          redactedBindingKeys: [...redactedBindingKeys],
        },
      };
    },

    async confirmRelease(input) {
      const { source, decision, sql, bindings, resultSchema, materializedRows, sourceRowCount, executeProbe } = input;
      // The differencing guard runs only where its verdict is release-relevant.
      const minCohortCount =
        source.policy === "sensitive_aggregate_only"
          ? await probeCohortCount(api, source, sql, bindings, sourceRowCount, executeProbe)
          : null;
      return api.decideRelease({
        source,
        sql: decision.positionalSql,
        resultSchema,
        minCohortCount,
        redactedBindingKeys: decision.redactedBindingKeys,
        materializedRows,
        budget: decision.budget,
      });
    },

    noteDatasetPayload(payload) {
      if (typeof payload === "string") {
        datasetPayloadStrings.add(payload);
        return;
      }
      if (typeof payload === "object" && payload !== null) {
        datasetPayloads.add(payload);
      }
    },

    datasetPayloadBytes(payload) {
      if (typeof payload === "string") {
        return datasetPayloadStrings.has(payload) ? new TextEncoder().encode(payload).byteLength : 0;
      }
      if (typeof payload === "object" && payload !== null && datasetPayloads.has(payload)) {
        const byteLength = (payload as { byteLength?: unknown }).byteLength;
        if (typeof byteLength === "number") return byteLength;
        const size = (payload as { size?: unknown }).size;
        if (typeof size === "number") return size;
        return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
      }
      return 0;
    },

    recordDatasetUpload(bytes) {
      datasetBytesUploaded += bytes;
    },

    recordTransportCoverage(coverage) {
      monitoredTransports = [...coverage];
    },

    evidence(scope, policy = null) {
      return EvidenceSnapshotSchema.parse({
        observedAt: now(),
        scope: { kind: scope.kind, id: scope.id },
        datasetBytesUploaded,
        rawSensitiveValuesReleasedToTools,
        rawSensitiveValuesReleasedToSharedCanvas,
        monitoredTransports: [...monitoredTransports],
        policy,
        lineage: [],
        limitations: [...EVIDENCE_LIMITATIONS],
      });
    },
  };

  return api;
}

/**
 * The one app binding (mirrors `workspaceStore`): boot arms egress
 * monitoring into this kernel in the warm slot, so zero dataset uploads are
 * provable from first paint (grilling 24). Tests create fresh kernels
 * through {@link createCustodyKernel}.
 */
export const custodyKernel: CustodyKernel = createCustodyKernel();
