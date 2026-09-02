import { describe, expect, it, vi } from "vitest";
import {
  CompiledEnvelopeFailure,
  CompiledGetContextEnvelopeSuccess,
  CompiledGetContextEventsEnvelopeSuccess,
  type Envelope,
} from "../agent-control-plane/envelope";
import { createWorkspaceStore, type DomainCommand } from "./store";

function createStore() {
  return createWorkspaceStore();
}

// Reads share one seeded workspace; every dispatch below is a read and must
// leave the snapshot both unchanged in value and identical by reference.
describe("rev-0 seed", () => {
  it("seeds ws_local_01 at revision 0 with the bootstrap capabilities and §4.6 default budgets", () => {
    const ws = createStore().getSnapshot();
    expect(ws).toEqual({
      workspaceId: "ws_local_01",
      revision: 0,
      schemaVersion: "duckstudio.webmcp/v1",
      capabilities: [
        "activate_local_preset",
        "run_readonly_sql",
        "present_artifact",
        "verify_custody",
        "cancel_active_operation",
        "select_artifact",
      ],
      activeDatasetId: null,
      activeDataset: null,
      selectedArtifactId: null,
      budgets: {
        executionMs: 5000,
        resultRows: 10000,
        chartPoints: 2000,
        toolSummaryBytes: 8192,
        retainedArtifacts: 20,
        contextItems: 20,
      },
      operations: [],
      recentArtifactIds: [],
      artifacts: [],
      evictedArtifactIds: [],
    });
  });

  it("keeps the snapshot reference stable across reads (StrictMode-safe)", () => {
    const store = createStore();
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    expect(store.getServerSnapshot()).toBe(store.getServerSnapshot());
  });

  it("freezes the server snapshot (SSR N/A, API required)", () => {
    expect(Object.isFrozen(createStore().getServerSnapshot())).toBe(true);
  });
});

describe("getContext scope table at rev 0 (ticket 04)", () => {
  it("summary returns the five bootstrap fields with activeDataset null", async () => {
    const store = createStore();
    const envelope = await store.dispatch({ kind: "getContext", input: { scope: "summary" } });

    const parsed = CompiledGetContextEnvelopeSuccess.parse(envelope);
    expect(parsed.ok).toBe(true);
    expect(parsed.workspaceId).toBe("ws_local_01");
    expect(parsed.revision).toBe(0);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.data).toEqual({
      capabilities: [
        "activate_local_preset",
        "run_readonly_sql",
        "present_artifact",
        "verify_custody",
        "cancel_active_operation",
        "select_artifact",
      ],
      activeDataset: null,
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
    });
  });

  it("schema scope rejects with DATASET_UNAVAILABLE and the pinned details", async () => {
    const store = createStore();
    const envelope = await store.dispatch({
      kind: "getContext",
      input: { scope: "schema", datasetId: "saas_churn" },
    });

    const parsed = CompiledEnvelopeFailure.parse(envelope);
    expect(parsed.error.code).toBe("DATASET_UNAVAILABLE");
    expect(parsed.error.retryable).toBe(true);
    expect(parsed.error.details).toEqual({ datasetId: "saas_churn", activeDatasetId: null });
    // Grilling 42's emission table: the activate-preset action plus the
    // named human gesture, exactly as the §9 row lists them.
    expect(parsed.nextActions).toEqual([
      {
        kind: "tool",
        tool: "duckdb_activate_dataset",
        input: { datasetId: "saas_churn", expectedRevision: 0, idempotencyKey: "recover-activate-r0" },
      },
      { kind: "human_action", action: "select_local_file" },
    ]);
  });

  it("artifact scope rejects with ARTIFACT_UNAVAILABLE", async () => {
    const store = createStore();
    const envelope = await store.dispatch({
      kind: "getContext",
      input: { scope: "artifact", artifactId: "a_01" },
    });

    const parsed = CompiledEnvelopeFailure.parse(envelope);
    expect(parsed.error.code).toBe("ARTIFACT_UNAVAILABLE");
    expect(parsed.error.retryable).toBe(true);
    expect(parsed.error.details).toEqual({ artifactId: "a_01" });
    expect(parsed.nextActions).toEqual([
      { kind: "tool", tool: "duckdb_get_context", input: { scope: "summary" } },
    ]);
  });

  it("events scope returns the empty delta window anchored at revision 0", async () => {
    const store = createStore();
    const envelope = await store.dispatch({
      kind: "getContext",
      input: { scope: "events", sinceRevision: 0 },
    });

    const parsed = CompiledGetContextEventsEnvelopeSuccess.parse(envelope);
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toEqual({ events: [], oldestRetainedRevision: 0 });
    expect(parsed.warnings).toEqual([]);
  });
});

describe("sinceRevision delta read", () => {
  it("returns the compact event delta, not a full re-ingest of the workspace", async () => {
    const store = createStore();
    const envelope = await store.dispatch({
      kind: "getContext",
      input: { scope: "events", sinceRevision: 0 },
    });

    // The delta's data carries exactly the event-window keys — no summary
    // fields tagged on, so agents re-ingest nothing larger than the delta.
    expect(Object.keys((envelope as { data: object }).data)).toEqual([
      "events",
      "oldestRetainedRevision",
    ]);
  });

  it("accepts a sinceRevision beyond the window without DELTA_WINDOW_EXPIRED — every legal value is inside the window by construction", async () => {
    const store = createStore();
    const envelope = await store.dispatch({
      kind: "getContext",
      input: { scope: "events", sinceRevision: 999 },
    });

    expect(
      envelope.ok && envelope.warnings.some((warning) => warning.code === "DELTA_WINDOW_EXPIRED"),
    ).toBe(false);
    CompiledGetContextEventsEnvelopeSuccess.parse(envelope);
  });
});

describe("dispatch honesty at the synchronous seam (ADR 0004 am4)", () => {
  it("rejects a refinement violation with a synchronous VALIDATION_ERROR envelope", async () => {
    const store = createStore();
    const before = store.getSnapshot();

    // scope schema without datasetId violates the input refinement.
    const promise = store.dispatch({
      kind: "getContext",
      input: { scope: "schema" },
    } as DomainCommand);
    expect(promise).toBeInstanceOf(Promise);

    const parsed = CompiledEnvelopeFailure.parse(await promise);
    expect(parsed.error.code).toBe("VALIDATION_ERROR");
    expect(parsed.error.retryable).toBe(false);
    expect(Object.keys(parsed.error.details)).toContain("input.datasetId");
    expect(store.getSnapshot()).toBe(before);
  });

  it("rejects an unknown command kind instead of faking success", async () => {
    const store = createStore();
    const promise = store.dispatch({
      kind: "activate_dataset",
      input: {},
    } as unknown as DomainCommand);

    const parsed = CompiledEnvelopeFailure.parse(await promise);
    expect(parsed.error.code).toBe("VALIDATION_ERROR");
  });

  it("settles a malformed dispatch on the next microtask — no awaited round trip", async () => {
    const store = createStore();
    let settled: Envelope | undefined;
    void store
      .dispatch({ kind: "getContext", input: { scope: "schema" } } as DomainCommand)
      .then((envelope) => {
        settled = envelope;
      });

    await Promise.resolve();
    expect(settled).toBeDefined();
    expect(settled?.ok).toBe(false);
  });
});

describe("capability negotiation (ticket 14)", () => {
  it("appendCapability replaces the snapshot whole at rev 0, frozen, without touching the old snapshot", () => {
    const store = createStore();
    const before = store.getSnapshot();

    store.appendCapability("simulator_only");

    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.capabilities).toContain("simulator_only");
    expect(after.revision).toBe(0);
    expect(Object.isFrozen(after)).toBe(true);
    expect(Object.isFrozen(after.capabilities)).toBe(true);
    expect(before.capabilities).not.toContain("simulator_only");
  });

  it("notifies listeners when a capability is appended", () => {
    const store = createStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.appendCapability("webmcp_native");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("throws on a double append instead of silently negotiating twice", () => {
    const store = createStore();
    store.appendCapability("webmcp_native");

    expect(() => store.appendCapability("webmcp_native")).toThrow();
  });
});
