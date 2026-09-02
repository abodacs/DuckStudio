import type { CustodyFailure } from "../dataset-custody/schemas";
import type { ArtifactSummary, PresentationSpec, ResultColumn } from "../analysis-artifacts/schemas";
import type { ExecutionResult } from "../duck-engine/protocol";
import type { Policy } from "./schemas";

/**
 * Presentation inference and the release interplay (§4.5 as amended by
 * grilling 34): inference is policy-aware by construction — it proposes only
 * legal candidates, and an empty spec is legal. A *supplied* element that
 * would cross release policy is never silently stripped (deny over strip):
 * the whole request is `POLICY_DENIED` with `blockedFields` and the nearest
 * legal spec as `permittedPresentation`. `PRESENTATION_DOWNGRADED` is gone —
 * there is no strip path.
 *
 * Chart downsampling happens at commit (§4.5/34): the committed spec keeps
 * `maxPoints`; `metrics.chartPoints` reports the emitted count and the
 * envelope carries `CHART_DOWNSAMPLED {requested, emitted}` when the two
 * differ. The measured summary composes here too — the one place KPI values
 * are read from the materialized batches, so the envelope, the cards, and
 * Insights render one object (§15.15).
 */

/** Column family, from the DuckDB type string the engine reports. */
function columnKind(type: string): "integer" | "numeric" | "categorical" {
  const base = (type.toUpperCase().split("(")[0] ?? type).trim();
  if (base.startsWith("INT") || ["TINYINT", "SMALLINT", "BIGINT", "HUGEINT", "UTINYINT", "USMALLINT", "UINTEGER", "UBIGINT"].includes(base)) {
    return "integer";
  }
  if (["DOUBLE", "FLOAT", "REAL", "DECIMAL", "NUMERIC"].includes(base)) {
    return "numeric";
  }
  return "categorical";
}

export type PresentationDenial = CustodyFailure & { readonly code: "POLICY_DENIED" };

type ValidationFailure = CustodyFailure & { readonly code: "VALIDATION_ERROR" };

export type PresentationOutcome =
  | { readonly ok: true; readonly spec: PresentationSpec }
  | { readonly ok: false; readonly denial: PresentationDenial }
  | { readonly ok: false; readonly validation: CustodyFailure & { readonly code: "VALIDATION_ERROR" } };

export interface PresentationInput {
  readonly policy: Policy;
  /** The materialized result schema, with classification resolved through the source. */
  readonly resultSchema: readonly ResultColumn[];
  /** Direct-identifier columns custody omitted — never presentation candidates. */
  readonly omittedColumns: readonly string[];
  readonly supplied?: PresentationSpec | undefined;
}

/** Legal presentation candidates: produced columns minus custody-omitted ones. */
function legalColumns(resultSchema: readonly ResultColumn[], omitted: readonly string[]): ResultColumn[] {
  return resultSchema.filter(
    (column) => !omitted.includes(column.name) && column.classification !== "direct_identifier",
  );
}

/** §4.5 inference, verbatim: legal candidates only, possibly empty. */
export function inferPresentation(input: PresentationInput): PresentationSpec {
  const columns = legalColumns(input.resultSchema, input.omittedColumns);
  const numeric = columns.filter((column) => columnKind(column.type) !== "categorical");
  const integerish = columns.filter((column) => columnKind(column.type) === "integer");
  const categorical = columns.filter((column) => columnKind(column.type) === "categorical");

  const spec: PresentationSpec = {};

  // 1. KPIs: up to six numeric result columns in result order.
  if (numeric.length > 0) {
    spec.kpis = numeric.slice(0, 6).map((column) => ({
      label: column.name,
      column: column.name,
      format: columnKind(column.type) === "integer" ? ("integer" as const) : ("decimal" as const),
    }));
  }

  // 2. Chart: one categorical/integer + one numeric → bar; two numerics → scatter
  //    on the first two in result order (grilling 34 tie-break).
  if (numeric.length >= 2) {
    spec.chart = {
      type: "scatter",
      x: (numeric[0] as ResultColumn).name,
      y: (numeric[1] as ResultColumn).name,
    };
  } else if ((categorical.length > 0 || integerish.length > 0) && numeric.length === 1) {
    spec.chart = {
      type: "bar",
      x: (categorical[0] ?? integerish[0] as ResultColumn).name,
      y: (numeric[0] as ResultColumn).name,
    };
  }

  // 3. Grid: visible only for public_synthetic.
  if (input.policy === "public_synthetic") {
    spec.grid = { visible: true };
  }

  return spec;
}

/** The one KPI/chart column legality check: produced, never omitted. */
function columnIssue(
  element: string,
  column: string,
  input: PresentationInput,
): { blocked: string[] } | { invalid: string } | null {
  if (!input.resultSchema.some((resultColumn) => resultColumn.name === column)) {
    return { invalid: column };
  }
  if (input.omittedColumns.includes(column)) {
    return { blocked: [column] };
  }
  return null;
}

/**
 * Fill-then-check (grilling 34): a supplied presentation's missing fields
 * fill by the same inference rules, then every supplied element is checked.
 * Any illegal element denies the whole request; `permittedPresentation` is
 * the nearest legal spec — inference overlaid with the supplied elements
 * that are themselves legal. Inferred presentations never hit this path.
 */
export function resolvePresentation(input: PresentationInput): PresentationOutcome {
  const inferred = inferPresentation(input);
  if (!input.supplied) {
    return { ok: true, spec: inferred };
  }

  const blockedFields: string[] = [];
  let kpisBlocked = false;
  let chartBlocked = false;
  let gridBlocked = false;
  const check = (element: string, column: string): ValidationFailure | null => {
    const issue = columnIssue(element, column, input);
    if (!issue) return null;
    if ("invalid" in issue) {
      return {
        code: "VALIDATION_ERROR",
        message: `The presentation references "${issue.invalid}", which the analysis does not produce.`,
        retryable: false,
        details: { field: `presentation.${element}`, unknown: issue.invalid },
      };
    }
    blockedFields.push(...issue.blocked);
    if (element === "kpis") kpisBlocked = true;
    else chartBlocked = true;
    return null;
  };

  for (const kpi of input.supplied.kpis ?? []) {
    const failure = check("kpis", kpi.column);
    if (failure) return { ok: false, validation: failure };
  }
  if (input.supplied.chart) {
    for (const axis of ["x", "y"] as const) {
      const failure = check("chart", input.supplied.chart[axis]);
      if (failure) return { ok: false, validation: failure };
    }
  }
  if (input.supplied.grid?.visible && input.policy !== "public_synthetic") {
    blockedFields.push("grid");
    gridBlocked = true;
  }

  if (blockedFields.length > 0) {
    // Deny over strip: the nearest legal spec keeps exactly the supplied
    // elements that are themselves legal and fills the rest by inference —
    // a suggestion, never the committed spec.
    const permitted: PresentationSpec = { ...inferred };
    if (!kpisBlocked && input.supplied.kpis) permitted.kpis = input.supplied.kpis;
    if (!chartBlocked && input.supplied.chart) permitted.chart = { ...input.supplied.chart };
    if (gridBlocked) permitted.grid = { visible: false };
    else if (input.supplied.grid) permitted.grid = input.supplied.grid;
    return {
      ok: false,
      denial: {
        code: "POLICY_DENIED",
        message: "The supplied presentation would cross release policy; no element is silently stripped.",
        retryable: false,
        details: {
          blockedFields: blockedFields.join(","),
          permittedPresentation: JSON.stringify(permitted),
        },
      },
    };
  }

  // Fill-then-check: missing fields carry the inferred candidates; supplied
  // legal elements stand.
  const spec: PresentationSpec = { ...inferred };
  if (input.supplied.kpis) spec.kpis = input.supplied.kpis;
  if (input.supplied.chart) spec.chart = { ...input.supplied.chart };
  if (input.supplied.grid) spec.grid = input.supplied.grid;
  return { ok: true, spec };
}

/**
 * §8.3 measured summary: the projected spec plus measured values, read once
 * from the materialized batches. A KPI's value is that column's cell in the
 * first materialized row; the chart's pointCount is the emitted count.
 */
export function measureSummary(
  spec: PresentationSpec,
  result: ExecutionResult,
  emittedChartPoints: number,
): ArtifactSummary {
  const firstRow = new Map<string, unknown>();
  for (const batch of result.batches) {
    if (batch.rowCount > 0) {
      for (const [column, values] of Object.entries(batch.values)) {
        firstRow.set(column, values[0]);
      }
      break;
    }
  }
  return {
    kpis: (spec.kpis ?? []).map((kpi) => {
      const value = firstRow.get(kpi.column);
      return { ...kpi, value: typeof value === "number" ? value : null };
    }),
    chart: spec.chart
      ? {
          type: spec.chart.type,
          x: spec.chart.x,
          y: spec.chart.y,
          ...(spec.chart.title === undefined ? {} : { title: spec.chart.title }),
          pointCount: emittedChartPoints,
        }
      : undefined,
  };
}

/**
 * Commit-time chart downsampling (grilling 34): the emitted count is the
 * engine's materialized points capped by the spec's `maxPoints`. Returns the
 * disclosed warning's details when the two differ.
 */
export function downsampleChartPoints(
  spec: PresentationSpec,
  materializedChartPoints: number,
): { emitted: number; warning: { requested: number; emitted: number } | null } {
  const maxPoints = spec.chart?.maxPoints;
  const emitted = Math.min(materializedChartPoints, maxPoints ?? materializedChartPoints);
  return {
    emitted,
    warning: emitted < materializedChartPoints ? { requested: materializedChartPoints, emitted } : null,
  };
}
