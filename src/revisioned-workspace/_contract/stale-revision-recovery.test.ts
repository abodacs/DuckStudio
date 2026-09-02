import { describe, expect, it } from "vitest";
import { CompiledEnvelopeFailure } from "../../agent-control-plane/envelope";
import { createCustodyKernel } from "../../dataset-custody/kernel";
import { createWorkspaceStore } from "../store";
import { activateSaasChurn, fakeEngine, FIXED_NOW } from "./harness";

/**
 * The stale-revision recovery contract (ADR 0005 am3 names this file; the
 * subject was unreachable at rev 0 and gets it now that mutations exist,
 * §15.8): a stale mutation executes no SQL, commits nothing, and returns the
 * executable delta-read recovery action; the retry with the current revision
 * and a fresh key succeeds.
 */

function storeWith(engine: ReturnType<typeof fakeEngine>) {
  return createWorkspaceStore({
    kernel: createCustodyKernel(() => FIXED_NOW),
    engine,
    now: () => FIXED_NOW,
  });
}

describe("stale mutation (§15.8: stale-state safety)", () => {
  it("rejects before the engine, carries both revisions, and offers the delta read", async () => {
    const engine = fakeEngine();
    const store = storeWith(engine);
    await activateSaasChurn(store);
    const before = store.getSnapshot();

    const stale = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "dataset", id: "saas_churn" },
        sql: "SELECT COUNT(*) FROM saas_churn",
        bindings: {},
        expectedRevision: 0,
        idempotencyKey: "stale-analysis-01",
      },
    });

    const parsed = CompiledEnvelopeFailure.parse(stale);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("STALE_REVISION");
    expect(parsed.error.retryable).toBe(true);
    expect(parsed.error.details).toEqual({ expectedRevision: 0, currentRevision: 1 });
    expect(parsed.nextActions).toEqual([
      { kind: "tool", tool: "duckdb_get_context", input: { scope: "summary", sinceRevision: 0 } },
    ]);
    // Zero trace: no operation accepted, no state change of any kind.
    expect(store.getSnapshot()).toBe(before);
    expect(engine.decisions).toEqual([]);
  });

  it("retries with the current revision and a new key — and succeeds", async () => {
    const store = storeWith(fakeEngine());
    await activateSaasChurn(store);

    const stale = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "dataset", id: "saas_churn" },
        sql: "SELECT COUNT(*) AS n FROM saas_churn",
        bindings: {},
        expectedRevision: 0,
        idempotencyKey: "stale-analysis-02",
      },
    });
    expect(stale.ok).toBe(false);

    const retry = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "dataset", id: "saas_churn" },
        sql: "SELECT COUNT(*) AS n FROM saas_churn",
        bindings: {},
        expectedRevision: store.getSnapshot().revision,
        idempotencyKey: "stale-analysis-03",
      },
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.revision).toBe(2);
      expect(retry.data).toHaveProperty("artifact");
    }
  });

  it("rejects a pin ahead of the workspace with the same honesty", async () => {
    const store = storeWith(fakeEngine());
    const future = await store.dispatch({
      kind: "activateDataset",
      input: { datasetId: "saas_churn", expectedRevision: 3, idempotencyKey: "future-pin-01" },
    });
    expect(future.ok).toBe(false);
    if (!future.ok) {
      expect(future.error.code).toBe("STALE_REVISION");
      expect(future.error.details.currentRevision).toBe(0);
    }
  });
});
