import { describe, expect, it } from "vitest";
import { createCustodyKernel, governedSource } from "./kernel";
import { BUDGET_DEFAULTS, BUDGET_HARD_MAX, EvidenceSnapshotSchema } from "./schemas";
import { healthcarePiiPreset, saasChurnPreset } from "../demo-presets/catalog";
import { SAAS_CHURN_CANONICAL_SQL } from "../demo-presets/canonical-sql";

/**
 * Custody-kernel unit surface (ticket 27): budget clamping per §4.6 and
 * grilling 21, the pinned decision object (grilling 22), binding redaction,
 * and the §8.4 evidence snapshot (ticket 28). Release-table and cohort
 * behavior live in `_contract/release-decision.test.ts`; the unsafe-SQL
 * matrix lives in `sql-inspector.test.ts`.
 */

const kernel = createCustodyKernel(() => "2026-09-02T00:00:00.000Z");

/** The decideRelease call shape the release pipeline uses, with the failure inputs pinned per case. */
function decide(
  dataset: Parameters<typeof governedSource>[0],
  sql: string,
  resultSchema: readonly { readonly name: string; readonly type: string }[],
  minCohortCount: number | null,
) {
  return kernel.decideRelease({
    source: governedSource(dataset),
    sql,
    resultSchema,
    minCohortCount,
    redactedBindingKeys: [],
    materializedRows: 0,
    budget: { executionMs: 5_000, resultRows: 10_000, chartPoints: 2_000 },
  });
}

describe("authorize returns the pinned decision (grilling 22)", () => {
  it("carries relation, positional SQL, ordered bindings, budget, redaction keys, policy", () => {
    const result = kernel.authorize({
      source: governedSource(saasChurnPreset),
      sql: "SELECT tickets FROM saas_churn WHERE region = $region AND tickets >= $min",
      bindings: { min: 5, region: "na" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision).toEqual({
        authorizedRelation: "saas_churn",
        positionalSql: "SELECT tickets FROM saas_churn WHERE region = $1 AND tickets >= $2",
        positionalBindings: ["na", 5],
        budget: BUDGET_DEFAULTS,
        redactedBindingKeys: [],
        releasePolicy: "public_synthetic",
      });
      expect(result.warnings).toEqual([]);
    }
  });

  it("marks sensitive and direct-identifier bindings as redacted for every projection", () => {
    const result = kernel.authorize({
      source: governedSource(healthcarePiiPreset),
      sql: "SELECT COUNT(*) FROM healthcare_pii WHERE mrn = $mrn",
      bindings: { mrn: "MRN-0042" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The decision itself carries the value for the worker's bind() call —
      // redactedBindingKeys is what every release surface uses to redact.
      expect(result.decision.positionalBindings).toEqual(["MRN-0042"]);
      expect(result.decision.redactedBindingKeys).toEqual(["mrn"]);
      // No release surface echoes the value: the evidence payload cannot contain it.
      const snapshot = kernel.evidence({ kind: "workspace", id: "ws_local_01" });
      expect(JSON.stringify(snapshot).includes("MRN-0042")).toBe(false);
    }
  });

  it("type-checks named bindings against the schema digest (null always passes)", () => {
    const mismatch = kernel.authorize({
      source: governedSource(saasChurnPreset),
      sql: "SELECT * FROM saas_churn WHERE tickets = $tickets",
      bindings: { tickets: "five" },
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.failure.code).toBe("VALIDATION_ERROR");
      expect(mismatch.failure.details).toMatchObject({ field: "tickets", expected: "INTEGER", got: "string" });
    }
    const nullPasses = kernel.authorize({
      source: governedSource(saasChurnPreset),
      sql: "SELECT * FROM saas_churn WHERE region = $region",
      bindings: { region: null },
    });
    expect(nullPasses.ok).toBe(true);
  });
});

describe("sensitive release gate is alias-proof (§5.1 row 5)", () => {
  it("denies a reassembling aggregate: FIRST() returns a raw row value", () => {
    const result = decide(healthcarePiiPreset, "SELECT FIRST(mrn) AS x FROM healthcare_pii", [{ name: "x", type: "VARCHAR" }], 500);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
      expect(result.failure.details.blockedConstruct).toBe("FIRST");
    }
  });

  it("keeps denying an aliased raw identifier select: an alias cannot reclassify a column", () => {
    const result = decide(healthcarePiiPreset, "SELECT mrn AS patient_ref FROM healthcare_pii", [{ name: "patient_ref", type: "VARCHAR" }], 500);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
  });

  it("denies an aggregate over an identifier column: counting mrn still discloses provenance", () => {
    const result = decide(healthcarePiiPreset, "SELECT COUNT(mrn) AS n FROM healthcare_pii", [{ name: "n", type: "BIGINT" }], 500);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
      expect(result.failure.details.blockedFields).toBe("mrn");
    }
  });

  it("releases the canonical shape: grouped aggregate with a cohort at the floor", () => {
    const result = decide(
      healthcarePiiPreset,
      "SELECT COUNT(*) AS n FROM healthcare_pii GROUP BY diagnosis",
      [{ name: "n", type: "BIGINT" }],
      10,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.release.status).toBe("downgraded");
      expect(result.release.omittedDirectIdentifiers).toEqual(["mrn"]);
    }
  });

  it("denies ANY_VALUE, which the aggregate word list never covered", () => {
    const result = decide(healthcarePiiPreset, "SELECT ANY_VALUE(diagnosis) AS d FROM healthcare_pii", [{ name: "d", type: "VARCHAR" }], 500);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
      expect(result.failure.details.blockedConstruct).toBe("ANY_VALUE");
    }
  });

  it("leaves the public preset untouched: FIRST() over saas_churn releases", () => {
    const result = decide(saasChurnPreset, "SELECT FIRST(plan) AS x FROM saas_churn", [{ name: "x", type: "VARCHAR" }], null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.release.status).toBe("allowed");
  });
});

describe("budget clamping (§4.6; grilling 21)", () => {
  it("honors stricter requests untouched", () => {
    const result = kernel.authorize({
      source: governedSource(saasChurnPreset),
      sql: SAAS_CHURN_CANONICAL_SQL,
      bindings: {},
      requestedBudget: { executionMs: 1_000, resultRows: 100, chartPoints: 10 },
    });
    expect(result.ok && result.decision.budget).toEqual({ executionMs: 1_000, resultRows: 100, chartPoints: 10 });
    expect(result.ok && result.warnings).toEqual([]);
  });

  it("clamps a legal-but-above-default request and emits BUDGET_CLAMPED", () => {
    const result = kernel.authorize({
      source: governedSource(saasChurnPreset),
      sql: SAAS_CHURN_CANONICAL_SQL,
      bindings: {},
      requestedBudget: { executionMs: 12_000, resultRows: 20_000 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.budget).toEqual(BUDGET_DEFAULTS);
      expect(result.warnings.map((warning) => warning.code)).toEqual(["BUDGET_CLAMPED", "BUDGET_CLAMPED"]);
      expect(result.warnings[0]?.details).toMatchObject({ axis: "executionMs", requested: 12_000, effective: 5_000 });
    }
  });

  it("rejects a request above a hard maximum with VALIDATION_ERROR", () => {
    const result = kernel.authorize({
      source: governedSource(saasChurnPreset),
      sql: SAAS_CHURN_CANONICAL_SQL,
      bindings: {},
      requestedBudget: { chartPoints: BUDGET_HARD_MAX.chartPoints + 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_ERROR");
      expect(result.failure.details).toMatchObject({ axis: "chartPoints", hardMaximum: BUDGET_HARD_MAX.chartPoints });
    }
  });
});

describe("evidence (§8.4; ticket 28)", () => {
  it("starts at zero uploads and parses against the pinned shape", () => {
    const fresh = createCustodyKernel(() => "2026-09-02T00:00:00.000Z");
    const snapshot = fresh.evidence({ kind: "workspace", id: "ws_local_01" });
    expect(EvidenceSnapshotSchema.parse(snapshot)).toBeTruthy();
    expect(snapshot.datasetBytesUploaded).toBe(0);
    expect(snapshot.rawSensitiveValuesReleasedToTools).toBe(0);
    expect(snapshot.rawSensitiveValuesReleasedToSharedCanvas).toBe(0);
    expect(snapshot.observedAt).toBe("2026-09-02T00:00:00.000Z");
  });

  it("always carries the pinned limitation strings", () => {
    const snapshot = kernel.evidence({ kind: "workspace", id: "ws_local_01" });
    expect(snapshot.limitations).toEqual([
      "Application shell traffic is outside dataset-upload accounting.",
      "Runtime interception is operational evidence, not a formal proof.",
    ]);
  });

  it("stamps observedAt per read and never double-counts", () => {
    let clock = 0;
    const ticking = createCustodyKernel(() => `2026-09-02T00:00:0${clock++}.000Z`);
    const first = ticking.evidence({ kind: "workspace", id: "ws_local_01" });
    const second = ticking.evidence({ kind: "workspace", id: "ws_local_01" });
    expect(first.observedAt).not.toBe(second.observedAt);
    expect(second.datasetBytesUploaded).toBe(first.datasetBytesUploaded);
  });

  it("counts only registered dataset payloads, never raw values into the snapshot", () => {
    const fresh = createCustodyKernel();
    const payload = { values: { tickets: [1, 2, 3] } };
    expect(fresh.datasetPayloadBytes(payload)).toBe(0);
    fresh.noteDatasetPayload(payload);
    expect(fresh.datasetPayloadBytes(payload)).toBeGreaterThan(0);
    expect(fresh.datasetPayloadBytes({ values: { tickets: [1, 2, 3] } })).toBe(0);
    fresh.recordDatasetUpload(2048);
    const snapshot = fresh.evidence({ kind: "workspace", id: "ws_local_01" });
    expect(snapshot.datasetBytesUploaded).toBe(2048);
    // No payload content rides in the snapshot — only counters and strings.
    expect(JSON.stringify(snapshot).includes("tickets")).toBe(false);
  });
});
