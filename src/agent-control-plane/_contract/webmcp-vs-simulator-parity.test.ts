import { describe, expect, it } from "vitest";
import {
  CompiledActivateDatasetEnvelopeSuccess,
  CompiledCancelActiveOperationEnvelopeSuccess,
  CompiledEnvelopeFailure,
  CompiledEnvelopeSuccess,
  CompiledGetContextEnvelopeSuccess,
  CompiledRunAnalysisEnvelopeSuccess,
  CompiledSelectArtifactEnvelopeSuccess,
  CompiledVerifyCustodyEnvelopeSuccess,
  type Envelope,
} from "../envelope";
import {
  buildActivateDatasetTool,
  buildExecuteSqlToCanvasTool,
  buildGetContextTool,
  buildVerifyZeroEgressTool,
} from "../registration";
import { invokeTool, startSimulator } from "../simulator";
import {
  CHURN_SQL,
  createStore,
  defaultFakeExecute,
  fakeEngine,
  FIXED_NOW,
  type FakeEngine,
} from "../../revisioned-workspace/_contract/harness";
import { projectWorkspace } from "../../revisioned-workspace/projection";
import type { Workspace } from "../../revisioned-workspace/schemas";
import { createWorkspaceStore, type WorkspaceStore } from "../../revisioned-workspace/store";

/**
 * The parity contract — the killer-feature gate (§14, ticket 46): the native
 * tool definitions and the simulator are two adapters over one dispatch
 * seam, so their envelopes, workspace snapshots, event logs, artifacts,
 * revisions, and errors must never drift. This test fails the day either
 * adapter grows wrapping, error shaping, or a second parse.
 *
 * Two surfaces:
 *
 * 1. Same-store read parity (ticket 14's three fixed inputs) — one success,
 *    one domain failure, one validation failure, both adapters against the
 *    same store. Reads mutate nothing, so a shared store is safe.
 * 2. Full-scenario parity (ticket 46) — the §14 command chain across all six
 *    commands on two fresh stores, one driven by `build<Tool>Tool().execute`,
 *    one by `simulator.invokeTool`, with the human-only commands crossing
 *    `store.dispatch` on the native-driven store exactly as a human control
 *    would. Snapshots and event logs are compared after every command.
 */

/** The three fixed read inputs (ticket 14): success, domain failure, validation failure. */
async function runBothAdapters(store: WorkspaceStore, input: unknown) {
  // Negotiation first, then both adapters: a tool call can only arrive after
  // registration picked a surface, so both sides must see the same
  // post-negotiation snapshot (the summary reports capabilities).
  startSimulator(store);
  const native = await buildGetContextTool(store).execute(input);
  const simulated = await invokeTool("duckdb_get_context", input);

  // Deep equality already forces identical ok and errorCode; the explicit
  // assertions keep the intent legible when the shapes drift.
  expect(simulated).toEqual(native);
  expect(simulated.ok).toBe(native.ok);
  return { native, simulated };
}

describe("webmcp vs simulator parity at the dispatch seam (ticket 14)", () => {
  it("summary read: both adapters answer the same success envelope", async () => {
    const { native, simulated } = await runBothAdapters(createWorkspaceStore(), {
      scope: "summary",
    });

    expect(native.ok).toBe(true);
    CompiledEnvelopeSuccess.parse(native);
    CompiledEnvelopeSuccess.parse(simulated);
  });

  it("schema read: both adapters answer the same DATASET_UNAVAILABLE envelope", async () => {
    const { native, simulated } = await runBothAdapters(createWorkspaceStore(), {
      scope: "schema",
      datasetId: "saas_churn",
    });

    expect(native.ok).toBe(false);
    if (!native.ok) {
      expect(native.error.code).toBe("DATASET_UNAVAILABLE");
    }
    CompiledEnvelopeFailure.parse(native);
    CompiledEnvelopeFailure.parse(simulated);
  });

  it("refine violation: both adapters answer the same VALIDATION_ERROR envelope", async () => {
    const { native, simulated } = await runBothAdapters(createWorkspaceStore(), {
      scope: "schema",
    });

    expect(native.ok).toBe(false);
    if (!native.ok) {
      expect(native.error.code).toBe("VALIDATION_ERROR");
    }
    CompiledEnvelopeFailure.parse(native);
    CompiledEnvelopeFailure.parse(simulated);
  });
});

// --- Full-scenario parity (ticket 46) ---

/** Completes the first `holdAfter` executes so a cancel can target a live operation. */
function holdableEngine(holdAfter: number): FakeEngine {
  let completed = 0;
  const heldRejecters: ((failure: unknown) => void)[] = [];
  const engine = fakeEngine((decision) => {
    completed += 1;
    if (completed <= holdAfter) return defaultFakeExecute(decision);
    return new Promise((_resolve, reject) => {
      heldRejecters.push(reject);
    });
  });
  const realRespawn = engine.respawn.bind(engine);
  engine.respawn = () => {
    for (const reject of heldRejecters) {
      reject({
        code: "INTERNAL_ERROR",
        message: "The engine worker terminated while a request was in flight; the next request respawns it.",
        retryable: true,
        details: { phase: "transport" },
      });
    }
    realRespawn();
  };
  return engine;
}

/** One adapter side of the scenario: its own store, engine, and surface. */
interface ParitySide {
  label: "native" | "simulated";
  store: WorkspaceStore;
  /** The surface dispatch: native definitions vs the simulator's invokeTool. */
  tool(name: string, input: unknown): Promise<Envelope>;
  /** The human path: the workspace command seam directly (§13). */
  human(command: Parameters<WorkspaceStore["dispatch"]>[0]): Promise<Envelope>;
}

function nativeSide(engine: FakeEngine): ParitySide {
  const store = createStore(engine);
  const tools = new Map(
    [
      buildGetContextTool(store),
      buildActivateDatasetTool(store),
      buildExecuteSqlToCanvasTool(store),
      buildVerifyZeroEgressTool(store),
    ].map((def) => [def.name, def]),
  );
  // Post-negotiation state on the native side (registerTools appends after a
  // successful registration; the definitions are the seam under test).
  store.appendCapability("webmcp_native");
  return {
    label: "native",
    store,
    tool: (name, input) => {
      const def = tools.get(name);
      if (!def) throw new Error(`no native definition for ${name}`);
      return def.execute(input);
    },
    human: (command) => store.dispatch(command),
  };
}

function simulatedSide(engine: FakeEngine): ParitySide {
  const store = createStore(engine);
  startSimulator(store);
  return {
    label: "simulated",
    store,
    tool: (name, input) => invokeTool(name, input),
    human: (command) => invokeTool(command.kind, command.input),
  };
}

/**
 * Deep envelope equality modulo the one legitimate difference: the summary's
 * `data.capabilities` reports the negotiating surface (`webmcp_native` vs
 * `simulator_only`). Everything else — ok, errorCode, data, contextDelta,
 * warnings, nextActions — must be identical.
 */
function expectSameEnvelope(native: Envelope, simulated: Envelope): void {
  if (native.ok && simulated.ok) {
    const { capabilities: _nativeCaps, ...nativeData } = native.data as Record<string, unknown>;
    const { capabilities: _simulatedCaps, ...simulatedData } = simulated.data as Record<string, unknown>;
    expect({ ...simulated, data: simulatedData }).toEqual({ ...native, data: nativeData });
  } else {
    expect(simulated).toEqual(native);
  }
}

/** Snapshot equality modulo the same surface capability. */
function expectSameSnapshot(native: Workspace, simulated: Workspace): void {
  expect(simulated).toEqual({ ...native, capabilities: simulated.capabilities });
}

async function eventsOf(side: ParitySide): Promise<unknown> {
  const envelope = await side.store.dispatch({ kind: "getContext", input: { scope: "events" } });
  if (!envelope.ok) throw new Error("events read failed");
  return (envelope.data as { events: unknown[] }).events;
}

async function expectSameState(native: ParitySide, simulated: ParitySide): Promise<void> {
  expectSameSnapshot(native.store.getSnapshot(), simulated.store.getSnapshot());
  expect(await eventsOf(simulated)).toEqual(await eventsOf(native));
}

describe("full-scenario parity across the six commands (ticket 46)", () => {
  it("activate → analysis → refinement → verify → select → cancel: identical envelopes, snapshots, and event logs", async () => {
    const native = nativeSide(holdableEngine(2));
    const simulated = simulatedSide(holdableEngine(2));

    /** One scenario step: run through both surfaces, compare everything. */
    async function step(name: string, run: (side: ParitySide) => Promise<Envelope>, parse?: (envelope: Envelope) => void): Promise<void> {
      const [nativeEnvelope, simulatedEnvelope] = await Promise.all([run(native), run(simulated)]);
      expectSameEnvelope(nativeEnvelope, simulatedEnvelope);
      if (parse) {
        parse(nativeEnvelope);
        parse(simulatedEnvelope);
      }
      await expectSameState(native, simulated);
    }

    // 1. activate_dataset — forward action suggests the canonical analysis.
    await step(
      "activate",
      (side) => side.tool("duckdb_activate_dataset", { datasetId: "saas_churn", expectedRevision: 0, idempotencyKey: "parity-activate-01" }),
      (envelope) => {
        expect(envelope.ok).toBe(true);
        CompiledActivateDatasetEnvelopeSuccess.parse(envelope);
        CompiledEnvelopeSuccess.parse(envelope);
      },
    );

    // 2. execute_sql_to_canvas — one artifact, atomically presented+selected.
    await step(
      "analysis",
      (side) =>
        side.tool("duckdb_execute_sql_to_canvas", {
          source: { kind: "dataset", id: "saas_churn" },
          sql: CHURN_SQL,
          bindings: {},
          expectedRevision: 1,
          idempotencyKey: "parity-analysis-01",
        }),
      (envelope) => {
        expect(envelope.ok).toBe(true);
        CompiledRunAnalysisEnvelopeSuccess.parse(envelope);
      },
    );

    // 3. refinement — sources a_01; lineage names the ancestor.
    await step(
      "refinement",
      (side) =>
        side.tool("duckdb_execute_sql_to_canvas", {
          source: { kind: "artifact", id: "a_01" },
          sql: "SELECT tickets, accounts FROM artifact_a_01 WHERE accounts > 10",
          bindings: {},
          expectedRevision: 2,
          idempotencyKey: "parity-analysis-02",
        }),
      (envelope) => CompiledRunAnalysisEnvelopeSuccess.parse(envelope),
    );

    // 4. verify_zero_egress — artifact-scoped evidence with limitations.
    await step(
      "verify",
      (side) => side.tool("duckdb_verify_zero_egress", { scope: "artifact", artifactId: "a_02" }),
      (envelope) => {
        expect(envelope.ok).toBe(true);
        CompiledVerifyCustodyEnvelopeSuccess.parse(envelope);
      },
    );

    // 5. get_context summary — the negotiation read.
    await step(
      "summary",
      (side) => side.tool("duckdb_get_context", { scope: "summary" }),
      (envelope) => {
        expect(envelope.ok).toBe(true);
        CompiledGetContextEnvelopeSuccess.parse(envelope);
      },
    );

    // 6. human-only selectArtifact — store.dispatch on the native side, the
    // simulator's command seam on the other; same domain events (§14).
    await step(
      "selectArtifact",
      (side) =>
        side.human({
          kind: "selectArtifact",
          input: { artifactId: "a_01", expectedRevision: 3, idempotencyKey: "parity-select-01" },
        }),
      (envelope) => {
        expect(envelope.ok).toBe(true);
        CompiledSelectArtifactEnvelopeSuccess.parse(envelope);
      },
    );

    // 7. cancelActiveOperation — targets the held runAnalysis each adapter
    // started; the cancelled op settles OPERATION_CANCELLED on both sides.
    const pendingNative = native.tool("duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "saas_churn" },
      sql: CHURN_SQL,
      bindings: {},
      expectedRevision: 4,
      idempotencyKey: "parity-cancel-setup-01",
    });
    const pendingSimulated = simulated.tool("duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "saas_churn" },
      sql: CHURN_SQL,
      bindings: {},
      expectedRevision: 4,
      idempotencyKey: "parity-cancel-setup-01",
    });
    await Promise.resolve();
    await Promise.resolve();

    await step(
      "cancelActiveOperation",
      (side) =>
        side.human({
          kind: "cancelActiveOperation",
          input: { expectedRevision: 4, idempotencyKey: "parity-cancel-01" },
        }),
      (envelope) => {
        expect(envelope.ok).toBe(true);
        CompiledCancelActiveOperationEnvelopeSuccess.parse(envelope);
      },
    );

    for (const pending of await Promise.all([pendingNative, pendingSimulated])) {
      expect(pending.ok).toBe(false);
      if (!pending.ok) expect(pending.error.code).toBe("OPERATION_CANCELLED");
      CompiledEnvelopeFailure.parse(pending);
    }
    expectSameEnvelope(
      await pendingNative,
      await pendingSimulated,
    );
    await expectSameState(native, simulated);
  });

  it("mutation failures match too: stale revision through both surfaces", async () => {
    const native = nativeSide(fakeEngine());
    const simulated = simulatedSide(fakeEngine());
    for (const side of [native, simulated]) {
      const activated = await side.tool("duckdb_activate_dataset", {
        datasetId: "saas_churn",
        expectedRevision: 0,
        idempotencyKey: "parity-stale-activate-01",
      });
      expect(activated.ok).toBe(true);
    }

    const staleInput = {
      datasetId: "healthcare_pii",
      expectedRevision: 99,
      idempotencyKey: "parity-stale-01",
    };
    expectSameEnvelope(
      await native.tool("duckdb_activate_dataset", staleInput),
      await simulated.tool("duckdb_activate_dataset", staleInput),
    );
    await expectSameState(native, simulated);
  });
});

describe("emission policy at the seam (grilling 42; ticket 46)", () => {
  it("failures carry exactly §9's required recovery — floor equals ceiling", async () => {
    // STALE_REVISION → the events delta read from the prepared revision.
    const stale = await createStore(fakeEngine()).dispatch({
      kind: "activateDataset",
      input: { datasetId: "saas_churn", expectedRevision: 7, idempotencyKey: "emit-stale-01" },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.nextActions).toEqual([
        { kind: "tool", tool: "duckdb_get_context", input: { scope: "events", sinceRevision: 7 } },
      ]);
    }

    // DATASET_UNAVAILABLE → activate-preset action + the named human gesture.
    const engine = fakeEngine();
    const store = createStore(engine);
    const unavailable = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "dataset", id: "healthcare_pii" },
        sql: "SELECT COUNT(*) AS n FROM healthcare_pii",
        bindings: {},
        expectedRevision: 0,
        idempotencyKey: "emit-unavailable-01",
      },
    });
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) {
      expect(unavailable.nextActions).toEqual([
        {
          kind: "tool",
          tool: "duckdb_activate_dataset",
          input: { datasetId: "healthcare_pii", expectedRevision: 0, idempotencyKey: "recover-activate-r0" },
        },
        { kind: "human_action", action: "select_local_file" },
      ]);
    }

    // ARTIFACT_UNAVAILABLE → read recent artifacts.
    await store.dispatch({
      kind: "activateDataset",
      input: { datasetId: "saas_churn", expectedRevision: 0, idempotencyKey: "emit-artifact-activate-01" },
    });
    const unknownArtifact = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "artifact", id: "a_99" },
        sql: "SELECT * FROM artifact_a_99",
        bindings: {},
        expectedRevision: 1,
        idempotencyKey: "emit-artifact-01",
      },
    });
    expect(unknownArtifact.ok).toBe(false);
    if (!unknownArtifact.ok) {
      expect(unknownArtifact.nextActions).toEqual([
        { kind: "tool", tool: "duckdb_get_context", input: { scope: "summary" } },
      ]);
    }

    // IDEMPOTENCY_CONFLICT → recovers through details alone, no action.
    await store.dispatch({
      kind: "activateDataset",
      input: { datasetId: "healthcare_pii", expectedRevision: 1, idempotencyKey: "emit-conflict-01" },
    });
    const conflict = await store.dispatch({
      kind: "activateDataset",
      input: { datasetId: "saas_churn", expectedRevision: 1, idempotencyKey: "emit-conflict-01" },
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.error.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(conflict.nextActions).toEqual([]);
    }

    // POLICY_DENIED → recovers through details.permittedPresentation.
    const denied = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "dataset", id: "healthcare_pii" },
        sql: "SELECT age_band, region, diagnosis FROM healthcare_pii WHERE visit_count > 5",
        bindings: {},
        expectedRevision: 2,
        idempotencyKey: "emit-denied-01",
      },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe("POLICY_DENIED");
      expect(denied.nextActions).toEqual([]);
    }
  });

  it("successful mutations carry at most one forward action; reads and human-only successes carry none", async () => {
    const store = createStore(fakeEngine());

    const activated = await store.dispatch({
      kind: "activateDataset",
      input: { datasetId: "saas_churn", expectedRevision: 0, idempotencyKey: "emit-forward-01" },
    });
    expect(activated.ok).toBe(true);
    if (activated.ok) {
      expect(activated.nextActions).toHaveLength(1);
      expect(activated.nextActions[0]).toEqual({
        kind: "tool",
        tool: "duckdb_execute_sql_to_canvas",
        input: {
          source: { kind: "dataset", id: "saas_churn" },
          sql: expect.stringContaining("SELECT"),
          bindings: {},
          expectedRevision: 1,
          idempotencyKey: "analyze-saas_churn-r1",
        },
      });
    }

    const analyzed = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "dataset", id: "saas_churn" },
        sql: CHURN_SQL,
        bindings: {},
        expectedRevision: 1,
        idempotencyKey: "emit-forward-02",
      },
    });
    expect(analyzed.ok).toBe(true);
    if (analyzed.ok) {
      expect(analyzed.nextActions).toEqual([
        { kind: "tool", tool: "duckdb_verify_zero_egress", input: { scope: "artifact", artifactId: "a_01" } },
      ]);
    }

    const selected = await store.dispatch({
      kind: "selectArtifact",
      input: { artifactId: "a_01", expectedRevision: 2, idempotencyKey: "emit-forward-03" },
    });
    expect(selected.ok).toBe(true);
    if (selected.ok) expect(selected.nextActions).toEqual([]);

    const summary = await store.dispatch({ kind: "getContext", input: { scope: "summary" } });
    const evidence = await store.dispatch({ kind: "verifyCustody", input: { scope: "workspace" } });
    expect(summary.ok && summary.nextActions).toEqual([]);
    expect(evidence.ok && evidence.nextActions).toEqual([]);
  });

  it("contextDelta rides successful mutations only and equals the changed-top-level projection diff", async () => {
    const store = createStore(fakeEngine());

    // Reads and failures never carry it.
    const read = await store.dispatch({ kind: "getContext", input: { scope: "summary" } });
    expect(read.ok && "contextDelta" in read).toBe(false);

    const before = projectWorkspace(store.getSnapshot());
    const activated = await store.dispatch({
      kind: "activateDataset",
      input: { datasetId: "saas_churn", expectedRevision: 0, idempotencyKey: "emit-delta-01" },
    });
    const after = projectWorkspace(store.getSnapshot());
    expect(activated.ok).toBe(true);
    if (activated.ok) {
      // Recomputed here independently: the delta is the projection diff
      // restricted to changed top-level fields, never a second model.
      const expected: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(after)) {
        if (JSON.stringify(before[key as keyof typeof before]) !== JSON.stringify(value)) {
          expected[key] = value;
        }
      }
      expect(activated.contextDelta).toEqual(expected);
      expect(Object.keys(activated.contextDelta ?? {})).toEqual(["revision", "datasetState", "datasetLine"]);
    }

    // A failed mutation commits nothing and carries no delta.
    const stale = await store.dispatch({
      kind: "activateDataset",
      input: { datasetId: "healthcare_pii", expectedRevision: 99, idempotencyKey: "emit-delta-02" },
    });
    expect(stale.ok === false && "contextDelta" in stale).toBe(false);
  });

  it("every emitted envelope keeps nextActions within the §7 bound of three", async () => {
    // Fresh store: the analysis source is inactive, so the response carries
    // the widest legal emission — the §9 DATASET_UNAVAILABLE pair.
    const store = createStore(fakeEngine());
    const unavailable = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "dataset", id: "healthcare_pii" },
        sql: "SELECT COUNT(*) AS n FROM healthcare_pii",
        bindings: {},
        expectedRevision: 0,
        idempotencyKey: "emit-bound-02",
      },
    });
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) {
      expect(unavailable.nextActions.length).toBeLessThanOrEqual(3);
      CompiledEnvelopeFailure.parse(unavailable);
    }
  });

  it("timestamps are the harness clock so both surfaces see identical envelopes", () => {
    expect(FIXED_NOW).toBe("2026-09-02T12:00:00.000Z");
  });
});
