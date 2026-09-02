import { describe, expect, it } from "vitest";
import { createCustodyKernel } from "../kernel";
import { CustodyFailureSchema } from "../schemas";
import type { DuckEngineRuntime } from "../../duck-engine/worker-handler";
import { createWorkerHandler } from "../../duck-engine/worker-handler";
import { healthcarePiiPreset, saasChurnPreset } from "../../demo-presets/catalog";
import { SAAS_CHURN_CANONICAL_SQL } from "../../demo-presets/canonical-sql";

/**
 * The §9 error taxonomy at the custody seam (ticket 29): stable codes,
 * explicit retryability, recovery-useful details — and errors that never
 * echo raw rows, sensitive bindings, or stack traces. Every failure parses
 * against the schema that mirrors the envelope's `error` member, so an
 * agent's recovery loop reads `code` + `details` and re-dispatches.
 */

const kernel = createCustodyKernel(() => "2026-09-02T00:00:00.000Z");
/** A sentinel whose presence anywhere in an error payload means a leak. */
const SENSITIVE_BINDING = "MRN-CLASSIFIED-0042";

describe("authorize-time failures (pre-worker)", () => {
  it("UNSAFE_SQL: not retryable, names the blocked construct", () => {
    const result = kernel.authorize({
      dataset: saasChurnPreset,
      sql: "ATTACH 'x.db' AS x",
      bindings: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(CustodyFailureSchema.parse(result.failure)).toBeTruthy();
      expect(result.failure.code).toBe("UNSAFE_SQL");
      expect(result.failure.retryable).toBe(false);
      expect(result.failure.details.blockedConstruct).toBeTruthy();
    }
  });

  it("VALIDATION_ERROR: not retryable, carries field details", () => {
    const result = kernel.authorize({
      dataset: saasChurnPreset,
      sql: "SELECT * FROM saas_churn WHERE tickets = $tickets",
      bindings: { tickets: "five" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_ERROR");
      expect(result.failure.retryable).toBe(false);
      expect(result.failure.details.field).toBe("tickets");
    }
  });

  it("DATASET_UNAVAILABLE: retryable, names the relation", () => {
    const result = kernel.authorize({
      dataset: saasChurnPreset,
      sql: "SELECT diagnosis FROM healthcare_pii",
      bindings: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("DATASET_UNAVAILABLE");
      expect(result.failure.retryable).toBe(true);
      expect(result.failure.details.relation).toBe("healthcare_pii");
    }
  });

  it("budget above a hard maximum is VALIDATION_ERROR with the axis and limit", () => {
    const result = kernel.authorize({
      dataset: saasChurnPreset,
      sql: SAAS_CHURN_CANONICAL_SQL,
      bindings: {},
      requestedBudget: { executionMs: 99_999 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_ERROR");
      expect(result.failure.retryable).toBe(false);
      expect(result.failure.details).toMatchObject({ axis: "executionMs", hardMaximum: 15_000 });
    }
  });

  it("sensitive binding values never appear in any authorize failure", () => {
    const results = [
      kernel.authorize({
        dataset: healthcarePiiPreset,
        sql: "SELECT * FROM healthcare_pii WHERE mrn = '$mrn'",
        bindings: { mrn: SENSITIVE_BINDING },
      }),
      kernel.authorize({
        dataset: healthcarePiiPreset,
        sql: "SELECT * FROM healthcare_pii WHERE mrn = $mrn AND visit_count = $visit_count",
        bindings: { mrn: SENSITIVE_BINDING, visit_count: "not-a-number" },
      }),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(JSON.stringify(result.failure).includes(SENSITIVE_BINDING)).toBe(false);
      }
    }
  });
});

describe("post-materialization failures", () => {
  it("POLICY_DENIED: not retryable, blockedFields plus cohort details", () => {
    const result = kernel.decideRelease({
      dataset: healthcarePiiPreset,
      sql: "SELECT age_band FROM healthcare_pii",
      resultSchema: [{ name: "age_band", type: "VARCHAR" }],
      minCohortCount: null,
      redactedBindingKeys: [],
      materializedRows: 100,
      budget: { executionMs: 5_000, resultRows: 10_000, chartPoints: 2_000 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(CustodyFailureSchema.parse(result.failure)).toBeTruthy();
      expect(result.failure.code).toBe("POLICY_DENIED");
      expect(result.failure.retryable).toBe(false);
      expect(result.failure.details.blockedFields).toBeTruthy();
      const cohort = kernel.decideRelease({
        dataset: healthcarePiiPreset,
        sql: "SELECT region, COUNT(*) AS n FROM healthcare_pii GROUP BY region",
        resultSchema: [{ name: "region", type: "VARCHAR" }, { name: "n", type: "BIGINT" }],
        minCohortCount: 3,
        redactedBindingKeys: [],
        materializedRows: 4,
        budget: { executionMs: 5_000, resultRows: 10_000, chartPoints: 2_000 },
      });
      expect(cohort.ok).toBe(false);
      if (!cohort.ok) {
        expect(cohort.failure.details).toMatchObject({ cohortMinimum: 10, observedCohort: 3 });
      }
    }
  });
});

describe("runtime engine failures (classified once at the seam)", () => {
  it("BUDGET_EXCEEDED: retryable, axis and limit in details, no partial data", async () => {
    const slow: DuckEngineRuntime = {
      warm: () => Promise.resolve({ materializedRelations: [], warmMs: 0, materializationMs: 0 }),
      runBounded: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ schema: [], rows: [{ tickets: 1 }], executionMs: 50 }), 50),
        ),
    };
    const response = await createWorkerHandler(slow)({
      id: 1,
      kind: "execute",
      decision: {
        authorizedRelation: "saas_churn",
        positionalSql: "SELECT tickets FROM saas_churn",
        positionalBindings: [],
        budget: { executionMs: 10, resultRows: 100, chartPoints: 100 },
        redactedBindingKeys: [],
        releasePolicy: "public_synthetic",
      },
    });
    expect(response.kind === "execute" && !response.ok).toBe(true);
    if (response.kind === "execute" && !response.ok) {
      expect(CustodyFailureSchema.parse(response.failure)).toBeTruthy();
      expect(response.failure.code).toBe("BUDGET_EXCEEDED");
      expect(response.failure.retryable).toBe(true);
      expect(response.failure.details).toMatchObject({ axis: "executionMs", limit: 10 });
      expect(JSON.stringify(response.failure).includes("tickets")).toBe(false);
    }
  });

  it("INTERNAL_ERROR: retryable, no engine message, no stack trace", async () => {
    const throwing: DuckEngineRuntime = {
      warm: () => Promise.resolve({ materializedRelations: [], warmMs: 0, materializationMs: 0 }),
      runBounded: () => Promise.reject(new Error("IO Error: unexpected internal state at line 42")),
    };
    const response = await createWorkerHandler(throwing)({
      id: 1,
      kind: "execute",
      decision: {
        authorizedRelation: "saas_churn",
        positionalSql: "SELECT 1",
        positionalBindings: [],
        budget: { executionMs: 5_000, resultRows: 100, chartPoints: 100 },
        redactedBindingKeys: [],
        releasePolicy: "public_synthetic",
      },
    });
    expect(response.kind === "execute" && !response.ok).toBe(true);
    if (response.kind === "execute" && !response.ok) {
      expect(response.failure.code).toBe("INTERNAL_ERROR");
      expect(response.failure.retryable).toBe(true);
      const payload = JSON.stringify(response.failure);
      expect(payload.includes("IO Error")).toBe(false);
      expect(payload.includes("node:internal")).toBe(false);
      expect(payload.includes("    at ")).toBe(false);
    }
  });
});
