import { describe, expect, it } from "vitest";
import {
  CompiledEnvelopeFailure,
  CompiledEnvelopeSuccess,
  CompiledGetContextEnvelopeSuccess,
} from "./envelope";

describe("CompiledEnvelopeFailure", () => {
  // §7 verbatim. Envelope shape only: STALE_REVISION is unreachable at rev 0
  // (ticket 04), so dispatch behavior tests stay dropped until Slice 3.
  it("parses the §7 STALE_REVISION literal with its executable delta-read recovery", () => {
    const parsed = CompiledEnvelopeFailure.parse({
      ok: false,
      schemaVersion: "duckstudio.webmcp/v1",
      workspaceId: "ws_local_01",
      revision: 4,
      error: {
        code: "STALE_REVISION",
        message: "Expected revision 3; current revision is 4.",
        retryable: true,
        details: { expectedRevision: 3, currentRevision: 4 },
      },
      nextActions: [
        { kind: "tool", tool: "duckdb_get_context", input: { scope: "events", sinceRevision: 3 } },
      ],
    });

    expect(parsed.error).toEqual({
      code: "STALE_REVISION",
      message: "Expected revision 3; current revision is 4.",
      retryable: true,
      details: { expectedRevision: 3, currentRevision: 4 },
    });
    expect(parsed.nextActions).toEqual([
      { kind: "tool", tool: "duckdb_get_context", input: { scope: "events", sinceRevision: 3 } },
    ]);
  });

  it("parses a VALIDATION_ERROR as non-retryable with scalar-safe field details", () => {
    const parsed = CompiledEnvelopeFailure.parse({
      ok: false,
      schemaVersion: "duckstudio.webmcp/v1",
      workspaceId: "ws_local_01",
      revision: 0,
      error: {
        code: "VALIDATION_ERROR",
        message: "Input does not match the duckdb_get_context schema.",
        retryable: false,
        details: { path: "scope", problem: "invalid_enum_value" },
      },
      nextActions: [],
    });

    expect(parsed.error.retryable).toBe(false);
    expect(parsed.error.details).toEqual({ path: "scope", problem: "invalid_enum_value" });
  });
});

describe("CompiledGetContextEnvelopeSuccess", () => {
  it("parses the §8.1 bootstrap summary with the full six-key budgets", () => {
    const parsed = CompiledGetContextEnvelopeSuccess.parse({
      ok: true,
      schemaVersion: "duckstudio.webmcp/v1",
      workspaceId: "ws_local_01",
      revision: 0,
      data: {
        capabilities: [
          "activate_local_preset",
          "run_readonly_sql",
          "present_artifact",
          "verify_custody",
          "cancel_active_operation",
          "select_artifact",
        ],
        activeDataset: { datasetId: "saas_churn", policy: "public_synthetic", rowCount: 250000 },
        budgets: {
          executionMs: 5000,
          resultRows: 10000,
          chartPoints: 2000,
          toolSummaryBytes: 8192,
          retainedArtifacts: 20,
          contextItems: 20,
        },
        selectedArtifactId: null,
        recentArtifacts: [],
      },
      warnings: [],
      nextActions: [],
    });

    expect(parsed.data.budgets.contextItems).toBe(20);
    expect(parsed.data.activeDataset?.policy).toBe("public_synthetic");
  });
});

describe("nextActions bound", () => {
  const action = { kind: "tool", tool: "duckdb_get_context", input: {} } as const;

  it("accepts three nextActions and rejects a fourth", () => {
    const head = {
      ok: true,
      schemaVersion: "duckstudio.webmcp/v1",
      workspaceId: "ws_local_01",
      revision: 0,
      data: {},
      warnings: [],
    };

    expect(
      CompiledEnvelopeSuccess.parse({ ...head, nextActions: [action, action, action] }),
    ).toBeTruthy();
    expect(() =>
      CompiledEnvelopeSuccess.parse({ ...head, nextActions: [action, action, action, action] }),
    ).toThrow();
  });
});
