import { describe, expect, it } from "vitest";
import { createCustodyKernel } from "./kernel";
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

describe("authorize returns the pinned decision (grilling 22)", () => {
  it("carries relation, positional SQL, ordered bindings, budget, redaction keys, policy", () => {
    const result = kernel.authorize({
      dataset: saasChurnPreset,
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
      dataset: healthcarePiiPreset,
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
      dataset: saasChurnPreset,
      sql: "SELECT * FROM saas_churn WHERE tickets = $tickets",
      bindings: { tickets: "five" },
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.failure.code).toBe("VALIDATION_ERROR");
      expect(mismatch.failure.details).toMatchObject({ field: "tickets", expected: "INTEGER", got: "string" });
    }
    const nullPasses = kernel.authorize({
      dataset: saasChurnPreset,
      sql: "SELECT * FROM saas_churn WHERE region = $region",
      bindings: { region: null },
    });
    expect(nullPasses.ok).toBe(true);
  });
});

describe("budget clamping (§4.6; grilling 21)", () => {
  it("honors stricter requests untouched", () => {
    const result = kernel.authorize({
      dataset: saasChurnPreset,
      sql: SAAS_CHURN_CANONICAL_SQL,
      bindings: {},
      requestedBudget: { executionMs: 1_000, resultRows: 100, chartPoints: 10 },
    });
    expect(result.ok && result.decision.budget).toEqual({ executionMs: 1_000, resultRows: 100, chartPoints: 10 });
    expect(result.ok && result.warnings).toEqual([]);
  });

  it("clamps a legal-but-above-default request and emits BUDGET_CLAMPED", () => {
    const result = kernel.authorize({
      dataset: saasChurnPreset,
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
      dataset: saasChurnPreset,
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
