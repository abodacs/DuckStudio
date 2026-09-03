import { afterAll, describe, expect, it } from "vitest";
import {
  CompiledActivateDatasetEnvelopeSuccess,
  CompiledEnvelopeFailure,
  CompiledRunAnalysisEnvelopeSuccess,
  WarningCodeSchema,
} from "../../agent-control-plane/envelope";
import { createCustodyKernel } from "../../dataset-custody/kernel";
import { createNodeDuckRuntime, type NodeDuckRuntime } from "../../duck-engine/node-duckdb";
import { createWorkerHandler } from "../../duck-engine/worker-handler";
import type { EngineResponse } from "../../duck-engine/protocol";
import type { WorkspaceEngine } from "../../duck-engine/worker";
import type { WorkspaceEvent } from "../schemas";
import { projectArtifact } from "../projection";
import { createWorkspaceStore } from "../store";
import {
  activateSaasChurn,
  CHURN_SQL,
  createStore,
  defaultFakeExecute,
  fakeEngine,
  FIXED_NOW,
  runChurn,
} from "./harness";

/**
 * The mutation contracts (ticket 38; grilling 31–34): idempotent replay,
 * key conflicts, single-flight, cancel semantics, no-partial-commit
 * atomicity, refinement lineage, retention disclosure, and the event ring —
 * all headless against the store with the real custody kernel and the fake
 * engine. One live-DuckDB describe proves the generated relations are
 * actually queryable (ticket 36's refinement acceptance).
 *
 * Failure semantics per grilling 31: pre-release failures commit nothing —
 * revision, artifacts, and selection are untouched; the accepted operation
 * records its terminal `failed` state and the `analysis_failed` lifecycle
 * event (events fire only on terminal states). Synchronous rejections
 * (stale, conflict, validation) leave zero trace.
 */

function storeWith(engine: ReturnType<typeof fakeEngine>) {
  return createWorkspaceStore({
    kernel: createCustodyKernel(() => FIXED_NOW),
    engine,
    now: () => FIXED_NOW,
  });
}

const eventsOf = async (store: ReturnType<typeof createStore>) => {
  const envelope = await store.dispatch({ kind: "getContext", input: { scope: "events", sinceRevision: 0 } });
  if (!envelope.ok) throw new Error("events read failed");
  return (envelope.data as { events: WorkspaceEvent[] }).events;
};

describe("activation commits (grilling 31: uniform commit)", () => {
  it("activates with one revision bump and the dataset_activated event, painting no rows", async () => {
    const store = storeWith(fakeEngine());
    const envelope = await store.dispatch({
      kind: "activateDataset",
      input: { datasetId: "saas_churn", expectedRevision: 0, idempotencyKey: "activate-01" },
    });
    const parsed = CompiledActivateDatasetEnvelopeSuccess.parse(envelope);
    expect(parsed.revision).toBe(1);
    expect(parsed.data.policy).toBe("public_synthetic");
    expect(parsed.data.minimumCohortSize).toBe(10);
    expect(store.getSnapshot().selectedArtifactId).toBeNull();
    expect(store.getSnapshot().artifacts).toEqual([]);

    const events = await eventsOf(store);
    expect(events).toEqual([
      { revision: 1, at: FIXED_NOW, kind: "dataset_activated", operationId: "op_01", datasetId: "saas_churn" },
    ]);
  });

  it("re-activating the active dataset is a uniform commit — success, event, +1 revision", async () => {
    const store = storeWith(fakeEngine());
    await activateSaasChurn(store);
    const again = await store.dispatch({
      kind: "activateDataset",
      input: { datasetId: "saas_churn", expectedRevision: 1, idempotencyKey: "activate-again-01" },
    });
    expect(again.ok).toBe(true);
    expect(again.ok && again.revision).toBe(2);
    expect((await eventsOf(store)).filter((event) => event.kind === "dataset_activated")).toHaveLength(2);
  });

  it("switching datasets is a uniform commit too", async () => {
    const store = storeWith(fakeEngine());
    await activateSaasChurn(store);
    const switched = await store.dispatch({
      kind: "activateDataset",
      input: { datasetId: "healthcare_pii", expectedRevision: 1, idempotencyKey: "activate-switch-01" },
    });
    expect(switched.ok).toBe(true);
    expect(store.getSnapshot().activeDatasetId).toBe("healthcare_pii");
    expect(store.getSnapshot().selectedArtifactId).toBeNull();
  });
});

describe("atomic runAnalysis path (ticket 37)", () => {
  it("creates one artifact, infers the presentation, selects it, bumps once", async () => {
    const engine = fakeEngine();
    const store = storeWith(engine);
    await activateSaasChurn(store);

    const envelope = await runChurn(store, "analysis-01");
    const parsed = CompiledRunAnalysisEnvelopeSuccess.parse(envelope);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.revision).toBe(2);
    expect(parsed.data.operationId).toBe("op_02");
    expect(parsed.data.artifact.artifactId).toBe("a_01");
    expect(parsed.data.artifact.relationName).toBe("artifact_a_01");
    expect(parsed.data.artifact.lineage).toEqual([{ kind: "dataset", id: "saas_churn" }]);
    // Measured metrics, never targets; the committed presentation infers
    // KPIs and a scatter (two numeric columns) with a public grid.
    expect(parsed.data.metrics).toEqual({ executionMs: 12.5, materializedRows: 2, chartPoints: 2 });
    expect(parsed.data.summary.chart?.pointCount).toBe(2);
    expect(parsed.warnings).toEqual([]);
    expect(store.getSnapshot().selectedArtifactId).toBe("a_01");
    expect(store.getSnapshot().recentArtifactIds).toEqual(["a_01"]);
    // Zero rows cross the envelope: only handles, summaries, and metrics.
    expect(JSON.stringify(parsed.data)).not.toContain('"values"');

    const events = await eventsOf(store);
    expect(events.slice(-2)).toEqual([
      { revision: 2, at: FIXED_NOW, kind: "analysis_succeeded", operationId: "op_02", artifactId: "a_01" },
      { revision: 2, at: FIXED_NOW, kind: "artifact_selected", operationId: "op_02", artifactId: "a_01" },
    ]);
    // The relation materialized under the generated name before release.
    expect(engine.materialized).toEqual(["artifact_a_01"]);
  });

  it("redacts direct-identifier binding values everywhere downstream of the kernel", async () => {
    const store = storeWith(fakeEngine());
    await store.dispatch({
      kind: "activateDataset",
      input: { datasetId: "healthcare_pii", expectedRevision: 0, idempotencyKey: "redact-activate-01" },
    });
    const envelope = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "dataset", id: "healthcare_pii" },
        sql: "SELECT diagnosis, COUNT(*) AS patients FROM healthcare_pii WHERE mrn = $mrn GROUP BY diagnosis HAVING COUNT(*) >= 10",
        bindings: { mrn: "MRN-CLASSIFIED-0042" },
        expectedRevision: 1,
        idempotencyKey: "binding-01",
      },
    });
    expect(envelope.ok).toBe(true);
    // The raw value never leaves the kernel — not in the envelope, not in
    // the committed artifact's redacted bindings.
    expect(JSON.stringify(envelope)).not.toContain("MRN-CLASSIFIED-0042");

    const artifact = await store.dispatch({ kind: "getContext", input: { scope: "artifact", artifactId: "a_01" } });
    expect(artifact.ok).toBe(true);
    if (artifact.ok) {
      const record = artifact.data as { artifact: { bindings: Record<string, unknown>; release: { redactedBindingKeys: string[] } } };
      expect(record.artifact.release.redactedBindingKeys).toEqual(["mrn"]);
      expect(record.artifact.bindings).toEqual({ mrn: "[redacted]" });
      expect(JSON.stringify(record)).not.toContain("MRN-CLASSIFIED-0042");
    }
  });
});

describe("exact replay and key conflicts (grilling 33; §15.9)", () => {
  it("replays the original envelope verbatim — original revision, no duplicate artifact", async () => {
    const engine = fakeEngine();
    const store = storeWith(engine);
    await activateSaasChurn(store);

    // Exact replay = same key + same input, including the original
    // expectedRevision (grilling 33).
    const input = {
      source: { kind: "dataset" as const, id: "saas_churn" },
      sql: CHURN_SQL,
      bindings: {},
      expectedRevision: 1,
      idempotencyKey: "replay-01",
    };
    const first = await store.dispatch({ kind: "runAnalysis", input });
    const snapshotAfterFirst = store.getSnapshot();
    const replay = await store.dispatch({ kind: "runAnalysis", input });

    expect(replay).toEqual(first);
    expect(store.getSnapshot()).toBe(snapshotAfterFirst);
    expect(store.getSnapshot().artifacts).toHaveLength(1);
    expect(engine.decisions).toHaveLength(1);
  });

  it("reuses a key with different input → IDEMPOTENCY_CONFLICT, retryable false", async () => {
    const store = storeWith(fakeEngine());
    await activateSaasChurn(store);
    await runChurn(store, "conflict-01");

    const conflict = await runChurn(store, "conflict-01", { sql: CHURN_SQL.replace("tickets", "seats") });
    const parsed = CompiledEnvelopeFailure.parse(conflict);
    expect(parsed.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(parsed.error.retryable).toBe(false);
  });

  it("caches deterministic denials — a retried denied command re-answers", async () => {
    const engine = fakeEngine(() =>
      Promise.reject({
        code: "BUDGET_EXCEEDED",
        message: "Execution exceeded the 12 ms budget; no partial materialization left the engine.",
        retryable: true,
        details: { axis: "executionMs", elapsed: 40, limit: 12 },
      }),
    );
    const store = storeWith(engine);
    await activateSaasChurn(store);

    const first = await runChurn(store, "budget-01");
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.code).toBe("BUDGET_EXCEEDED");

    const retry = await runChurn(store, "budget-01");
    expect(retry).toEqual(first);
    expect(engine.decisions).toHaveLength(1);
  });

  it("never caches transient outcomes — OPERATION_CONFLICT re-executes fresh", async () => {
    const store = storeWith(fakeEngine());
    await activateSaasChurn(store);

    const conflict = await runChurn(store, "transient-01", { expectedRevision: 99 });
    expect(conflict.ok).toBe(false);

    const fresh = await runChurn(store, "transient-01");
    expect(fresh.ok).toBe(true);
  });

  it("evicts cache entries FIFO at 100 — an evicted key re-executes as new", async () => {
    const store = storeWith(fakeEngine());
    await activateSaasChurn(store);
    await runChurn(store, "cache-seed-01");

    const replayInput = (key: string) => ({
      kind: "selectArtifact" as const,
      input: { artifactId: "a_01", expectedRevision: store.getSnapshot().revision, idempotencyKey: key },
    });
    for (let i = 0; i < 101; i += 1) {
      const envelope = await store.dispatch(replayInput(`select-${String(i).padStart(3, "0")}`));
      expect(envelope.ok).toBe(true);
    }

    // select-000 was evicted: replaying it with a NEW revision succeeds as a
    // fresh commit. A still-cached key would IDEMPOTENCY_CONFLICT instead.
    const evicted = await store.dispatch(replayInput("select-000"));
    expect(evicted.ok).toBe(true);

    // Control: a still-cached key replayed with a different input conflicts.
    const cached = await store.dispatch(replayInput("select-100"));
    expect(cached.ok).toBe(false);
    if (!cached.ok) expect(cached.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});

describe("page memory is per-store state (grilling 51 item 3)", () => {
  it("two stores in one process never collide: each projection reads its own captured rows", async () => {
    const secondEngine = fakeEngine(() =>
      Promise.resolve({
        schema: [
          { name: "tickets", type: "INTEGER" },
          { name: "accounts", type: "BIGINT" },
        ],
        batches: [
          {
            columns: [
              { name: "tickets", type: "INTEGER" },
              { name: "accounts", type: "BIGINT" },
            ],
            rowCount: 2,
            values: { tickets: [7, 11], accounts: [900, 30] },
          },
        ],
        metrics: { executionMs: 12.5, materializedRows: 2, chartPoints: 2 },
      }),
    );
    const first = storeWith(fakeEngine());
    const second = storeWith(secondEngine);
    await activateSaasChurn(first);
    await activateSaasChurn(second);
    await runChurn(first, "memory-first-01");
    await runChurn(second, "memory-second-01");

    // Both commits carry the same artifact id in their own workspace; a
    // module-global row cache would let the second overwrite the first.
    const firstView = projectArtifact(first.getSnapshot(), "a_01");
    const secondView = projectArtifact(second.getSnapshot(), "a_01");
    expect(firstView.kind).toBe("artifact");
    expect(secondView.kind).toBe("artifact");
    if (firstView.kind === "artifact" && secondView.kind === "artifact") {
      expect(firstView.grid).toMatchObject({ kind: "rows", rows: [[3, 120], [9, 40]] });
      expect(secondView.grid).toMatchObject({ kind: "rows", rows: [[7, 900], [11, 30]] });
    }
  });
});

describe("single-flight slot (grilling 31; §9)", () => {
  it("rejects a mutating command while an operation runs, reads stay free", async () => {
    let releaseExecute: (() => void) | undefined;
    const engine = fakeEngine(
      () =>
        new Promise((resolve) => {
          releaseExecute = () =>
            resolve({
              schema: [{ name: "n", type: "BIGINT" }],
              batches: [{ columns: [{ name: "n", type: "BIGINT" }], rowCount: 1, values: { n: [1] } }],
              metrics: { executionMs: 1, materializedRows: 1, chartPoints: 1 },
            });
        }),
    );
    const store = storeWith(engine);
    await activateSaasChurn(store);

    const pending = runChurn(store, "flight-01");
    await Promise.resolve();
    await Promise.resolve();
    // Reads never take the slot.
    const read = await store.dispatch({ kind: "getContext", input: { scope: "summary" } });
    expect(read.ok).toBe(true);

    const conflicting = await store.dispatch({
      kind: "activateDataset",
      input: { datasetId: "healthcare_pii", expectedRevision: store.getSnapshot().revision, idempotencyKey: "flight-02" },
    });
    const parsed = CompiledEnvelopeFailure.parse(conflicting);
    expect(parsed.error.code).toBe("OPERATION_CONFLICT");
    expect(parsed.error.retryable).toBe(true);
    expect(parsed.error.details.runningOperationId).toBe("op_02");

    // selectArtifact is not an operation: allowed during the run.
    // (Nothing selected yet — the selection of an unknown id is denied
    // deterministically, which itself proves the seam stayed open.)
    const duringRun = await store.dispatch({
      kind: "selectArtifact",
      input: { artifactId: "a_00", expectedRevision: store.getSnapshot().revision, idempotencyKey: "flight-03" },
    });
    expect(duringRun.ok).toBe(false);
    if (!duringRun.ok) expect(duringRun.error.code).toBe("ARTIFACT_UNAVAILABLE");

    releaseExecute?.();
    const settled = await pending;
    expect(settled.ok).toBe(true);
  });
});

describe("cancel semantics (grilling 31; §15.11)", () => {
  /** Serves the first executes normally; `hold()` makes the next one puntil respawn kills it. */
  function cancellableEngine() {
    let holding = false;
    const hooks: ((failure: unknown) => void)[] = [];
    const engine = fakeEngine((decision) => {
      if (!holding) return defaultFakeExecute(decision);
      return new Promise((_resolve, reject) => {
        hooks.push(reject);
      });
    });
    const realRespawn = engine.respawn.bind(engine);
    engine.respawn = () => {
      holding = false;
      for (const hook of hooks) {
        hook({
          code: "INTERNAL_ERROR",
          message: "The engine worker terminated while a request was in flight; the next request respawns it.",
          retryable: true,
          details: { phase: "transport" },
        });
      }
      realRespawn();
    };
    return { engine, hold: () => (holding = true) };
  }

  it("cancel succeeds and commits; the cancelled op resolves OPERATION_CANCELLED with zero trace", async () => {
    const { engine, hold } = cancellableEngine();
    const store = storeWith(engine);
    await activateSaasChurn(store);
    await runChurn(store, "cancel-setup-01");
    const revisionBeforeCancel = store.getSnapshot().revision;

    hold();
    const pending = runChurn(store, "cancel-01");
    await Promise.resolve();
    await Promise.resolve();

    const cancel = await store.dispatch({
      kind: "cancelActiveOperation",
      input: { expectedRevision: revisionBeforeCancel, idempotencyKey: "cancel-02" },
    });
    expect(cancel.ok).toBe(true);
    if (cancel.ok) expect(cancel.data).toEqual({ operationId: "op_03" });
    expect(store.getSnapshot().revision).toBe(revisionBeforeCancel + 1);
    // Prior selection intact; no artifact from the cancelled op.
    expect(store.getSnapshot().selectedArtifactId).toBe("a_01");
    expect(store.getSnapshot().artifacts).toHaveLength(1);
    expect(store.getSnapshot().operations.at(-1)?.status).toBe("cancelled");

    const settled = await pending;
    expect(settled.ok).toBe(false);
    if (!settled.ok) {
      const parsed = CompiledEnvelopeFailure.parse(settled);
      expect(parsed.error.code).toBe("OPERATION_CANCELLED");
      expect(parsed.error.retryable).toBe(true);
    }
    expect(store.getSnapshot().artifacts).toHaveLength(1);
    const events = await eventsOf(store);
    expect(events.at(-1)?.kind).toBe("operation_cancelled");
    expect(events.some((event) => event.kind === "analysis_failed")).toBe(false);
  });

  it("cancelling with no operation running is a VALIDATION_ERROR", async () => {
    const store = storeWith(fakeEngine());
    await activateSaasChurn(store);
    const cancel = await store.dispatch({
      kind: "cancelActiveOperation",
      input: { expectedRevision: store.getSnapshot().revision, idempotencyKey: "cancel-none-01" },
    });
    expect(cancel.ok).toBe(false);
    if (!cancel.ok) expect(cancel.error.code).toBe("VALIDATION_ERROR");
  });

  it("a stale operationId is a VALIDATION_ERROR, never a different op's cancel", async () => {
    const store = storeWith(cancellableEngine().engine);
    await activateSaasChurn(store);
    const cancel = await store.dispatch({
      kind: "cancelActiveOperation",
      input: { operationId: "op_99", expectedRevision: store.getSnapshot().revision, idempotencyKey: "cancel-stale-01" },
    });
    expect(cancel.ok).toBe(false);
    if (!cancel.ok) expect(cancel.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("no partial commit (ticket 38; §15.10)", () => {
  it("a release denial leaves revision, artifacts, selection untouched and drops the relation", async () => {
    const engine = fakeEngine();
    const store = storeWith(engine);
    await activateSaasChurn(store);
    await runChurn(store, "denial-setup-01");
    const before = store.getSnapshot();

    // Switch to the sensitive preset and request raw rows — the release
    // guard denies after execution (§15.6), so nothing may remain.
    await store.dispatch({
      kind: "activateDataset",
      input: { datasetId: "healthcare_pii", expectedRevision: before.revision, idempotencyKey: "denial-activate-01" },
    });
    const denied = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "dataset", id: "healthcare_pii" },
        sql: "SELECT age_band, region, diagnosis FROM healthcare_pii WHERE visit_count > 5",
        bindings: {},
        expectedRevision: store.getSnapshot().revision,
        idempotencyKey: "denial-01",
      },
    });
    const parsed = CompiledEnvelopeFailure.parse(denied);
    expect(parsed.error.code).toBe("POLICY_DENIED");
    expect(parsed.error.retryable).toBe(false);
    expect(String(parsed.error.details.blockedFields).split(",")).toEqual(["diagnosis", "patients"]);

    expect(store.getSnapshot().revision).toBe(before.revision + 1); // only the activation committed
    expect(store.getSnapshot().selectedArtifactId).toBe("a_01");
    expect(store.getSnapshot().artifacts).toHaveLength(1);
    expect(store.getSnapshot().artifacts[0]?.artifact.artifactId).toBe("a_01");
    // The attempted relation was cleaned up; the failure is auditable.
    expect(engine.dropped).toEqual(["artifact_a_02"]);
    const events = await eventsOf(store);
    const failureEvent = events.at(-1);
    expect(failureEvent?.kind).toBe("analysis_failed");
    expect(failureEvent?.errorCode).toBe("POLICY_DENIED");
    expect(events.some((event) => event.kind === "analysis_succeeded" && event.artifactId === "a_02")).toBe(false);
  });

  it("a supplied presentation that crosses policy denies the whole request (grilling 34)", async () => {
    const store = storeWith(fakeEngine());
    await store.dispatch({
      kind: "activateDataset",
      input: { datasetId: "healthcare_pii", expectedRevision: 0, idempotencyKey: "strip-activate-01" },
    });
    const denied = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "dataset", id: "healthcare_pii" },
        sql: "SELECT diagnosis, COUNT(*) AS patients FROM healthcare_pii GROUP BY diagnosis HAVING COUNT(*) >= 10",
        bindings: {},
        presentation: { grid: { visible: true } },
        expectedRevision: 1,
        idempotencyKey: "strip-01",
      },
    });
    const parsed = CompiledEnvelopeFailure.parse(denied);
    expect(parsed.error.code).toBe("POLICY_DENIED");
    expect(parsed.error.details.blockedFields).toBe("grid");
    expect(JSON.parse(String(parsed.error.details.permittedPresentation)).grid).toEqual({ visible: false });
    expect(store.getSnapshot().artifacts).toEqual([]);
  });

  it("an unknown refinement source denies with ARTIFACT_UNAVAILABLE and commits nothing", async () => {
    const store = storeWith(fakeEngine());
    await activateSaasChurn(store);
    const before = store.getSnapshot();
    const denied = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "artifact", id: "a_99" },
        sql: "SELECT * FROM artifact_a_99",
        bindings: {},
        expectedRevision: store.getSnapshot().revision,
        idempotencyKey: "unknown-artifact-01",
      },
    });
    const parsed = CompiledEnvelopeFailure.parse(denied);
    expect(parsed.error.code).toBe("ARTIFACT_UNAVAILABLE");
    expect(store.getSnapshot().revision).toBe(before.revision);
  });
});

describe("refinement, retention, and the event ring (ticket 36/38)", () => {
  it("refines from the artifact relation; lineage is dataset → a_01; never recomputed", async () => {
    const engine = fakeEngine();
    const store = storeWith(engine);
    await activateSaasChurn(store);
    await runChurn(store, "refine-setup-01");

    const refined = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "artifact", id: "a_01" },
        sql: "SELECT tickets, accounts FROM artifact_a_01 WHERE accounts > 10",
        bindings: {},
        expectedRevision: store.getSnapshot().revision,
        idempotencyKey: "refine-01",
      },
    });
    expect(refined.ok).toBe(true);
    if (refined.ok) {
      const data = refined.data as { artifact: { artifactId: string; lineage: unknown[]; relationName: string } };
      expect(data.artifact.artifactId).toBe("a_02");
      expect(data.artifact.lineage).toEqual([
        { kind: "dataset", id: "saas_churn" },
        { kind: "artifact", id: "a_01" },
      ]);
    }
    // The refinement's authorized relation is the generated artifact relation.
    expect(engine.decisions[1]?.authorizedRelation).toBe("artifact_a_01");
  });

  it("evicts the oldest relation at 21 artifacts and discloses the eviction", async () => {
    const store = storeWith(fakeEngine());
    await activateSaasChurn(store);
    for (let i = 0; i < 21; i += 1) {
      const envelope = await runChurn(store, `retention-${String(i).padStart(2, "0")}`);
      expect(envelope.ok).toBe(true);
    }
    expect(store.getSnapshot().artifacts).toHaveLength(21);
    expect(store.getSnapshot().recentArtifactIds[0]).toBe("a_21");

    const evicted = await store.dispatch({ kind: "getContext", input: { scope: "artifact", artifactId: "a_01" } });
    const parsed = CompiledEnvelopeFailure.parse(evicted);
    expect(parsed.error.code).toBe("ARTIFACT_UNAVAILABLE");
    expect(parsed.error.details).toEqual({ artifactId: "a_01", reason: "relation_evicted" });

    // The summary still lists the evicted id, flagged (grilling 32).
    const summary = await store.dispatch({ kind: "getContext", input: { scope: "summary" } });
    if (summary.ok) {
      const data = summary.data as { recentArtifacts: { artifactId: string; evicted: boolean }[] };
      expect(data.recentArtifacts.at(-1)).toEqual({ artifactId: "a_01", evicted: true });
    }

    // Refining from an evicted relation → same disclosure; recovery = recompute.
    const refineEvicted = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "artifact", id: "a_01" },
        sql: "SELECT * FROM artifact_a_01",
        bindings: {},
        expectedRevision: store.getSnapshot().revision,
        idempotencyKey: "refine-evicted-01",
      },
    });
    if (!refineEvicted.ok) {
      const parsedFailure = CompiledEnvelopeFailure.parse(refineEvicted);
      expect(parsedFailure.error.code).toBe("ARTIFACT_UNAVAILABLE");
      expect(parsedFailure.error.details.reason).toBe("relation_evicted");
    }

    // Selecting an evicted artifact is denied too.
    const select = await store.dispatch({
      kind: "selectArtifact",
      input: { artifactId: "a_01", expectedRevision: store.getSnapshot().revision, idempotencyKey: "select-evicted-01" },
    });
    expect(select.ok).toBe(false);
  });

  it("bounds the event ring and returns DELTA_WINDOW_EXPIRED for an expired sinceRevision", async () => {
    const store = storeWith(fakeEngine());
    await activateSaasChurn(store);
    for (let i = 0; i < 12; i += 1) {
      await runChurn(store, `ring-key-${String(i).padStart(2, "0")}`);
    }
    // 1 activation + 12 analyses × 2 events = 25 events; the ring holds 20.
    const fresh = await store.dispatch({ kind: "getContext", input: { scope: "events", sinceRevision: 5 } });
    if (!fresh.ok) throw new Error("expected events read");
    expect(fresh.warnings).toEqual([]);
    expect((fresh.data as { events: WorkspaceEvent[] }).events.every((event) => event.revision > 5)).toBe(true);

    const expired = await store.dispatch({ kind: "getContext", input: { scope: "events", sinceRevision: 1 } });
    if (!expired.ok) throw new Error("expected events read");
    expect(expired.warnings.map((warning) => warning.code)).toEqual(["DELTA_WINDOW_EXPIRED"]);
    const expiredData = expired.data as { events: WorkspaceEvent[]; oldestRetainedRevision: number };
    expect(expiredData.oldestRetainedRevision).toBeGreaterThan(1);
    expect(expiredData.events).toHaveLength(20);
  });
});

describe("verifyCustody evidence (§8.4)", () => {
  it("scopes the artifact snapshot, appends self to the lineage, and lists limitations", async () => {
    const store = storeWith(fakeEngine());
    await activateSaasChurn(store);
    await runChurn(store, "verify-setup-01");

    const evidence = await store.dispatch({
      kind: "verifyCustody",
      input: { scope: "artifact", artifactId: "a_01" },
    });
    expect(evidence.ok).toBe(true);
    if (evidence.ok) {
      const data = evidence.data as {
        scope: { kind: string; id: string };
        datasetBytesUploaded: number;
        lineage: { kind: string; id: string }[];
        monitoredTransports: string[];
        limitations: string[];
        policy: string;
      };
      expect(data.scope).toEqual({ kind: "artifact", id: "a_01" });
      expect(data.datasetBytesUploaded).toBe(0);
      expect(data.policy).toBe("public_synthetic");
      expect(data.lineage).toEqual([
        { kind: "dataset", id: "saas_churn" },
        { kind: "artifact", id: "a_01" },
      ]);
      expect(data.limitations.length).toBeGreaterThan(0);
    }
  });

  it("keeps evidence available for an evicted artifact's metadata", async () => {
    const store = storeWith(fakeEngine());
    await activateSaasChurn(store);
    for (let i = 0; i < 21; i += 1) {
      await runChurn(store, `evict-verify-${String(i).padStart(2, "0")}`);
    }
    const evidence = await store.dispatch({
      kind: "verifyCustody",
      input: { scope: "artifact", artifactId: "a_01" },
    });
    expect(evidence.ok).toBe(true);
  });
});

describe("the removed downgrade warning (ticket 34)", () => {
  it("PRESENTATION_DOWNGRADED is unreachable — struck from the §7 vocabulary", () => {
    expect(() => WarningCodeSchema.parse("PRESENTATION_DOWNGRADED")).toThrow();
  });
});

describe("refinement against a live relation (ticket 36's query acceptance)", () => {
  let runtime: NodeDuckRuntime;

  afterAll(async () => {
    await runtime?.dispose();
  });

  function liveEngine(rt: NodeDuckRuntime): WorkspaceEngine {
    const handler = createWorkerHandler(rt);
    let nextId = 1;
    const send = async (input: Record<string, unknown>): Promise<EngineResponse> =>
      handler({ ...input, id: nextId++ } as Parameters<typeof handler>[0]);
    return {
      async execute(decision) {
        const response = await send({ kind: "execute", decision });
        if (response.kind !== "execute") throw new Error("engine response kind mismatch");
        if (!response.ok) throw response.failure;
        return response.result;
      },
      async materializeRelation(relationName, result) {
        const response = await send({ kind: "materialize", relationName, result });
        if (response.kind !== "materialize") throw new Error("engine response kind mismatch");
        if (!response.ok) throw response.failure;
        return response.result;
      },
      async intakeFile(input) {
        const response = await send({ kind: "intake", ...input });
        if (response.kind !== "intake") throw new Error("engine response kind mismatch");
        if (!response.ok) throw response.failure;
        return response.result;
      },
      async dropRelation(relationName) {
        const response = await send({ kind: "drop", relationName });
        if (response.kind !== "drop") throw new Error("engine response kind mismatch");
        if (!response.ok) throw response.failure;
      },
      respawn: () => undefined,
    };
  }

  it("queries artifact_a_01: one artifact refines without recomputing its ancestor", { timeout: 180_000 }, async () => {
    runtime = await createNodeDuckRuntime();
    const handler = createWorkerHandler(runtime);
    await handler({ id: 0, kind: "warm" });
    const store = createWorkspaceStore({
      kernel: createCustodyKernel(() => FIXED_NOW),
      engine: liveEngine(runtime),
      now: () => FIXED_NOW,
    });
    await activateSaasChurn(store);

    const first = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "dataset", id: "saas_churn" },
        sql: CHURN_SQL,
        bindings: {},
        expectedRevision: 1,
        idempotencyKey: "live-001",
      },
    });
    expect(first.ok, JSON.stringify(first.ok ? "" : first.error)).toBe(true);

    const refined = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "artifact", id: "a_01" },
        sql: "SELECT SUM(accounts) AS churned_accounts_total FROM artifact_a_01",
        bindings: {},
        expectedRevision: 2,
        idempotencyKey: "live-002",
      },
    });
    expect(refined.ok, JSON.stringify(refined.ok ? "" : refined.error)).toBe(true);
    if (refined.ok) {
      const data = refined.data as { artifact: { artifactId: string; lineage: { kind: string; id: string }[]; rowCount: number } };
      expect(data.artifact.artifactId).toBe("a_02");
      expect(data.artifact.lineage).toEqual([
        { kind: "dataset", id: "saas_churn" },
        { kind: "artifact", id: "a_01" },
      ]);
      expect(data.artifact.rowCount).toBe(1);
    }
  });
});
