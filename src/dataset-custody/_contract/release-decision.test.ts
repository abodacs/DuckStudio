import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCustodyKernel, governedSource } from "../kernel";
import { createNodeDuckRuntime, type NodeDuckRuntime } from "../../duck-engine/node-duckdb";
import { healthcarePii, saasChurn } from "../../demo-presets/triples";
import type { AuthorizedDecision, BindingValue, CustodyFailure, ReleaseDecision } from "../schemas";
import type { PresetMetadata } from "../../demo-presets/schemas";

/**
 * The §5.1 safe-release table as executable proof (ticket 29): for both
 * preset policies — schema names/types, raw rows, aggregates, direct
 * identifiers, KPI-shaped output, SQL and bindings — the kernel decides
 * exactly what the table allows, against the real preset relations
 * materialized in DuckDB. Cohorts below `minimumCohortSize` are
 * `POLICY_DENIED` before any commit could exist.
 *
 * This composition is the slice's headless seam: authorize → execute the
 * decision verbatim → cohort probe (kernel-authored SQL, executed as its
 * own decision) → decideRelease. Slice 3's workspace adopts it.
 */

let runtime: NodeDuckRuntime;
const kernel = createCustodyKernel(() => "2026-09-02T00:00:00.000Z");

beforeAll(async () => {
  runtime = await createNodeDuckRuntime();
  await runtime.warm();
}, 120_000);

afterAll(async () => {
  await runtime.dispose();
});

type AnalysisResult =
  | { readonly ok: true; readonly decision: AuthorizedDecision; readonly release: ReleaseDecision }
  | { readonly ok: false; readonly failure: CustodyFailure };

/**
 * Cohort semantics (§5.1): grouped aggregates probe `MIN(count per group)`
 * with kernel-authored SQL that carries the statement's own WHERE filter and
 * named bindings; an unfiltered global aggregate's single cohort is the
 * whole relation (row count from the preset metadata); a filtered global
 * aggregate has no provable cohort and is denied — the one-day build does
 * not claim differencing protection.
 */
async function cohortCountFor(
  dataset: PresetMetadata,
  sql: string,
  relation: string,
  bindings: Record<string, BindingValue>,
): Promise<number | null> {
  const plan = kernel.inspectStatement(sql, [relation]);
  if (!plan.hasAggregate) return null;
  if (plan.hasGrouping) {
    if (plan.groupExpressions.length === 0) return null;
    const probeSql = kernel.cohortProbeSql(relation, plan.groupExpressions, plan.whereExpression);
    const probe = kernel.authorize({ source: governedSource(dataset), sql: probeSql, bindings });
    if (!probe.ok) return null;
    const read = await runtime.runBounded(probe.decision.positionalSql, probe.decision.positionalBindings, 1);
    return Number(read.rows[0]?.min_cohort ?? -1);
  }
  return plan.whereExpression === null ? dataset.rowCount : null;
}

async function analyze(
  dataset: PresetMetadata,
  sql: string,
  bindings: Record<string, BindingValue> = {},
): Promise<AnalysisResult> {
  const authorized = kernel.authorize({ source: governedSource(dataset), sql, bindings });
  if (!authorized.ok) return { ok: false, failure: authorized.failure };
  const decision = authorized.decision;
  const read = await runtime.runBounded(decision.positionalSql, decision.positionalBindings, decision.budget.resultRows);
  expect(read.executionMs).toBeLessThanOrEqual(decision.budget.executionMs);
  const minCohortCount = await cohortCountFor(dataset, sql, decision.authorizedRelation, bindings);
  const released = kernel.decideRelease({
    source: governedSource(dataset),
    sql: decision.positionalSql,
    resultSchema: read.schema,
    minCohortCount,
    redactedBindingKeys: decision.redactedBindingKeys,
    materializedRows: read.rows.length,
    budget: decision.budget,
  });
  if (!released.ok) return { ok: false, failure: released.failure };
  return { ok: true, decision, release: released.release };
}

describe("public_synthetic (saas_churn)", () => {
  it("releases the canonical aggregate: allowed, zero rows to tools, bounded shared canvas", async () => {
    const result = await analyze(saasChurn.metadata, saasChurn.sql);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.release.status).toBe("allowed");
      expect(result.release.rawRowsToAgent).toBe(0);
      expect(result.release.rawRowsToSharedCanvas).toBeGreaterThan(0);
      expect(result.release.rawRowsToSharedCanvas).toBeLessThanOrEqual(result.decision.budget.resultRows);
      expect(result.release.omittedDirectIdentifiers).toEqual([]);
      expect(result.release.cohortMinimum).toBe(10);
    }
  });

  it("releases a bounded raw grid — measured rows, clamped to the row budget", async () => {
    const result = await analyze(
      saasChurn.metadata,
      "SELECT tenant_id, tickets, churned FROM saas_churn WHERE churned ORDER BY tickets DESC",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.release.status).toBe("allowed");
      expect(result.release.rawRowsToSharedCanvas).toBe(10_000);
    }
  });
});

describe("sensitive_aggregate_only (healthcare_pii)", () => {
  it("releases the canonical aggregate as downgraded: mrn omitted, rows never leave", async () => {
    const result = await analyze(healthcarePii.metadata, healthcarePii.sql);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.release.status).toBe("downgraded");
      expect(result.release.omittedDirectIdentifiers).toEqual(["mrn"]);
      expect(result.release.rawRowsToAgent).toBe(0);
      expect(result.release.rawRowsToSharedCanvas).toBe(0);
      expect(result.release.cohortMinimum).toBe(10);
    }
  });

  it("suppresses raw grids: a row-level select is POLICY_DENIED before anything ships", async () => {
    const result = await analyze(
      healthcarePii.metadata,
      "SELECT age_band, region, diagnosis FROM healthcare_pii WHERE visit_count > 5",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
      expect(String(result.failure.details.blockedFields).split(",")).toEqual(["age_band", "region", "diagnosis"]);
    }
  });

  it("never releases direct-identifier columns: the kernel denies any result carrying them", () => {
    // The engine's materialized relation omits mrn entirely (custody
    // omission rule); the kernel guard is the backstop for any surface
    // whose result schema carries a direct identifier.
    const released = kernel.decideRelease({
      source: governedSource(healthcarePii.metadata),
      sql: "SELECT mrn, COUNT(*) AS n FROM healthcare_pii GROUP BY mrn",
      resultSchema: [{ name: "mrn", type: "VARCHAR" }, { name: "n", type: "BIGINT" }],
      minCohortCount: 500,
      redactedBindingKeys: [],
      materializedRows: 0,
      budget: { executionMs: 5_000, resultRows: 10_000, chartPoints: 2_000 },
    });
    expect(released.ok).toBe(false);
    if (!released.ok) {
      expect(released.failure.code).toBe("POLICY_DENIED");
      expect(released.failure.details.blockedFields).toBe("mrn");
    }
  });

  it("denies an aggregate whose smallest cohort is below the ten-record floor — no commit", async () => {
    // The pinched filter manufactures cohorts below ten from the real seed.
    const result = await analyze(
      healthcarePii.metadata,
      `
      SELECT region, diagnosis, COUNT(*) AS patients, ROUND(AVG(billed_amount), 2) AS avg_billed
      FROM healthcare_pii
      WHERE age_band = '0-17' AND visit_count = 12
      GROUP BY region, diagnosis
      ORDER BY patients DESC
      `,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
      expect(result.failure.details.cohortMinimum).toBe(10);
      expect(Number(result.failure.details.observedCohort)).toBeLessThan(10);
      expect(Number(result.failure.details.observedCohort)).toBeGreaterThanOrEqual(0);
    }
  });

  it("releases a grouped aggregate whose every cohort clears the floor", async () => {
    const result = await analyze(
      healthcarePii.metadata,
      "SELECT region, COUNT(*) AS patients, ROUND(AVG(billed_amount), 2) AS avg_billed FROM healthcare_pii GROUP BY region ORDER BY patients DESC",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.release.rawRowsToSharedCanvas).toBe(0);
      expect(result.release.omittedDirectIdentifiers).toEqual(["mrn"]);
    }
  });

  it("denies a filtered global aggregate — its cohort is not provable", async () => {
    const result = await analyze(
      healthcarePii.metadata,
      "SELECT COUNT(*) AS n, ROUND(AVG(billed_amount), 2) AS avg_billed FROM healthcare_pii WHERE readmitted",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
      expect(result.failure.details.cohortMinimum).toBe(10);
    }
  });

  it("releases an unfiltered global aggregate — the cohort is the whole relation", async () => {
    const result = await analyze(
      healthcarePii.metadata,
      "SELECT COUNT(*) AS n, ROUND(AVG(billed_amount), 2) AS avg_billed FROM healthcare_pii",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.release.rawRowsToSharedCanvas).toBe(0);
    }
  });
});

describe("SQL and bindings row (§5.1)", () => {
  it("redacts sensitive binding keys on the decision; values surface in no release surface", async () => {
    // A releasable grouped aggregate with a sensitive-classified binding:
    // the key redacts; the value never appears in the release decision.
    const authorized = kernel.authorize({
      source: governedSource(healthcarePii.metadata),
      sql: "SELECT region, COUNT(*) AS patients FROM healthcare_pii WHERE diagnosis = $diagnosis GROUP BY region",
      bindings: { diagnosis: "migraine" },
    });
    expect(authorized.ok).toBe(true);
    if (authorized.ok) {
      expect(authorized.decision.redactedBindingKeys).toEqual(["diagnosis"]);
      expect(JSON.stringify(authorized.decision.redactedBindingKeys).includes("migraine")).toBe(false);
      const released = kernel.decideRelease({
        source: governedSource(healthcarePii.metadata),
        sql: authorized.decision.positionalSql,
        resultSchema: [{ name: "region", type: "VARCHAR" }, { name: "patients", type: "BIGINT" }],
        minCohortCount: 1_000,
        redactedBindingKeys: authorized.decision.redactedBindingKeys,
        materializedRows: 4,
        budget: authorized.decision.budget,
      });
      expect(released.ok).toBe(true);
      if (released.ok) {
        expect(released.release.status).toBe("downgraded");
        expect(released.release.redactedBindingKeys).toEqual(["diagnosis"]);
        expect(JSON.stringify(released.release).includes("migraine")).toBe(false);
      }
    }
  });

  it("keeps public-classified bindings visible on the decision", () => {
    const authorized = kernel.authorize({
      source: governedSource(healthcarePii.metadata),
      sql: "SELECT COUNT(*) AS n FROM healthcare_pii WHERE region = $region",
      bindings: { region: "north" },
    });
    expect(authorized.ok).toBe(true);
    if (authorized.ok) {
      expect(authorized.decision.redactedBindingKeys).toEqual([]);
      expect(authorized.decision.positionalBindings).toEqual(["north"]);
    }
  });
});
