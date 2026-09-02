import { describe, expect, it } from "vitest";
import type { ExecutionResult } from "../duck-engine/protocol";
import { downsampleChartPoints, inferPresentation, measureSummary, resolvePresentation } from "./presentation";

/**
 * Presentation inference and deny-over-strip (§4.5 as amended by grilling
 * 34): inference proposes legal candidates only; a supplied illegal element
 * denies the whole request with `blockedFields`/`permittedPresentation` —
 * never a silent strip, never `PRESENTATION_DOWNGRADED` (removed from §7).
 * Store-level presentation behavior is exercised once in the workspace
 * contract tests; this file owns the pure rules.
 */

const publicResult = [
  { name: "tickets", type: "INTEGER", classification: "public" },
  { name: "churn_rate", type: "DOUBLE", classification: "public" },
  { name: "plan", type: "VARCHAR", classification: "public" },
] as const;

const sensitiveResult = [
  { name: "diagnosis", type: "VARCHAR", classification: "sensitive" },
  { name: "patients", type: "INTEGER", classification: "public" },
] as const;

describe("inference (§4.5 verbatim, policy-aware by construction)", () => {
  it("two numerics infer a scatter on the first two in result order", () => {
    const spec = inferPresentation({
      policy: "public_synthetic",
      resultSchema: [...publicResult],
      omittedColumns: [],
    });
    expect(spec.chart).toEqual({ type: "scatter", x: "tickets", y: "churn_rate" });
    expect(spec.kpis?.map((kpi) => kpi.column)).toEqual(["tickets", "churn_rate"]);
    expect(spec.kpis?.[0]).toEqual({ label: "tickets", column: "tickets", format: "integer" });
    expect(spec.kpis?.[1]).toEqual({ label: "churn_rate", column: "churn_rate", format: "decimal" });
    expect(spec.grid).toEqual({ visible: true });
  });

  it("one categorical plus one numeric infers a bar", () => {
    const spec = inferPresentation({
      policy: "public_synthetic",
      resultSchema: [
        { name: "plan", type: "VARCHAR", classification: "public" },
        { name: "accounts", type: "BIGINT", classification: "public" },
      ],
      omittedColumns: [],
    });
    expect(spec.chart).toEqual({ type: "bar", x: "plan", y: "accounts" });
  });

  it("caps KPIs at six numeric columns", () => {
    const schema = ["a", "b", "c", "d", "e", "f", "g"].map((name) => ({
      name,
      type: "DOUBLE",
      classification: "public" as const,
    }));
    const spec = inferPresentation({ policy: "public_synthetic", resultSchema: schema, omittedColumns: [] });
    expect(spec.kpis).toHaveLength(6);
  });

  it("never proposes a grid for sensitive_aggregate_only and omits nothing legal", () => {
    const spec = inferPresentation({
      policy: "sensitive_aggregate_only",
      resultSchema: [...sensitiveResult],
      omittedColumns: [],
    });
    expect(spec.grid).toBeUndefined();
    expect(spec.kpis?.map((kpi) => kpi.column)).toEqual(["patients"]);
  });

  it("excludes omitted identifiers from every candidate; empty spec is legal", () => {
    const spec = inferPresentation({
      policy: "sensitive_aggregate_only",
      resultSchema: [{ name: "mrn", type: "VARCHAR", classification: "direct_identifier" }],
      omittedColumns: ["mrn"],
    });
    expect(spec).toEqual({});
  });
});

describe("deny over strip (grilling 34: supplied illegal elements are never removed)", () => {
  it("a grid request on a sensitive dataset denies with blockedFields and the nearest legal spec", () => {
    const outcome = resolvePresentation({
      policy: "sensitive_aggregate_only",
      resultSchema: [...sensitiveResult],
      omittedColumns: [],
      supplied: {
        kpis: [{ label: "Patients", column: "patients", format: "integer" }],
        grid: { visible: true },
      },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok && "denial" in outcome) {
      expect(outcome.denial.code).toBe("POLICY_DENIED");
      expect(outcome.denial.retryable).toBe(false);
      expect(outcome.denial.details.blockedFields).toBe("grid");
      const permitted = JSON.parse(String(outcome.denial.details.permittedPresentation));
      expect(permitted.grid).toEqual({ visible: false });
      expect(permitted.kpis).toEqual([{ label: "Patients", column: "patients", format: "integer" }]);
    }
  });

  it("a KPI on an omitted identifier denies with the column named", () => {
    const outcome = resolvePresentation({
      policy: "sensitive_aggregate_only",
      resultSchema: [
        { name: "mrn", type: "VARCHAR", classification: "direct_identifier" },
        { name: "patients", type: "INTEGER", classification: "public" },
      ],
      omittedColumns: ["mrn"],
      supplied: { kpis: [{ label: "MRN", column: "mrn", format: "integer" }] },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok && "denial" in outcome) {
      expect(outcome.denial.details.blockedFields).toBe("mrn");
    }
  });

  it("a column the analysis does not produce is a validation error, not a policy denial", () => {
    const outcome = resolvePresentation({
      policy: "public_synthetic",
      resultSchema: [...publicResult],
      omittedColumns: [],
      supplied: { chart: { type: "bar", x: "nope", y: "tickets" } },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok && "validation" in outcome) {
      expect(outcome.validation.code).toBe("VALIDATION_ERROR");
      expect(outcome.validation.details.unknown).toBe("nope");
    }
  });

  it("fills missing fields of a supplied presentation by the same inference rules", () => {
    const outcome = resolvePresentation({
      policy: "public_synthetic",
      resultSchema: [...publicResult],
      omittedColumns: [],
      supplied: { kpis: [{ label: "Churn", column: "churn_rate", format: "percent" }] },
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.spec.kpis).toEqual([{ label: "Churn", column: "churn_rate", format: "percent" }]);
      expect(outcome.spec.chart).toEqual({ type: "scatter", x: "tickets", y: "churn_rate" });
      expect(outcome.spec.grid).toEqual({ visible: true });
    }
  });
});

describe("measured summary and downsampling (§8.3, grilling 34)", () => {
  const result: ExecutionResult = {
    schema: [
      { name: "tickets", type: "INTEGER" },
      { name: "churn_rate", type: "DOUBLE" },
    ],
    batches: [
      {
        columns: [
          { name: "tickets", type: "INTEGER" },
          { name: "churn_rate", type: "DOUBLE" },
        ],
        rowCount: 2,
        values: { tickets: [3, 9], churn_rate: [0.1, 0.4] },
      },
    ],
    metrics: { executionMs: 12.5, materializedRows: 2, chartPoints: 2 },
  };

  it("reads each KPI's value from the first materialized row", () => {
    const summary = measureSummary(
      { kpis: [{ label: "tickets", column: "tickets", format: "integer" }] },
      result,
      2,
    );
    expect(summary.kpis).toEqual([
      { label: "tickets", column: "tickets", format: "integer", value: 3 },
    ]);
  });

  it("carries the emitted point count on the chart", () => {
    const summary = measureSummary(
      { chart: { type: "scatter", x: "tickets", y: "churn_rate" } },
      result,
      7,
    );
    expect(summary.chart).toEqual({ type: "scatter", x: "tickets", y: "churn_rate", pointCount: 7 });
  });

  it("caps committed metrics at the spec's maxPoints and discloses the gap", () => {
    const downsample = downsampleChartPoints(
      { chart: { type: "bar", x: "plan", y: "n", maxPoints: 10 } },
      40,
    );
    expect(downsample.emitted).toBe(10);
    expect(downsample.warning).toEqual({ requested: 40, emitted: 10 });
  });

  it("does not warn when the materialized points fit the spec", () => {
    expect(downsampleChartPoints({}, 40).warning).toBeNull();
  });
});
