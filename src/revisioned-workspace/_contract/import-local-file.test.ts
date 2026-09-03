import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../analysis-artifacts/sql-hash";
import { canonicalSchemaJson, type PresetColumn } from "../../demo-presets/schemas";
import { createCustodyKernel } from "../../dataset-custody/kernel";
import {
  CompiledGetContextEventsEnvelopeSuccess as CompiledGetContextEvents,
  CompiledGetContextSchemaEnvelopeSuccess as CompiledGetContextSchema,
  CompiledRunAnalysisEnvelopeSuccess as CompiledRunAnalysis,
} from "../envelope";
import {
  createIntakeRegistry,
  importedRelationName,
  intakeDigest,
  MAX_IMPORT_BYTES,
} from "../intake-tickets";
import { createWorkspaceStore, type WorkspaceStore } from "../store";
import type { Envelope } from "../envelope";
import { fakeEngine, FIXED_NOW, type FakeEngine } from "./harness";

/**
 * The `importLocalFile` contract (slice 7, tickets 71–76): the human-only
 * seventh command turns a dropped CSV into the active dataset. The ceilings
 * deny pre-execution, the ticket is one-shot (zero trace on failure or
 * cancel), and the imported relation is governed exactly like a preset —
 * default `sensitive_aggregate_only`, direct identifiers in metadata but
 * never in the relation.
 */

const CSV_BYTES = new TextEncoder().encode("region,amount\neast,10.5\nwest,20.0\nnorth,30.0\n");

/** The default fake intake's described schema, as the dataset metadata pins it. */
const EXPECTED_COLUMNS: PresetColumn[] = [
  { name: "patient_id", type: "BIGINT", classification: "direct_identifier" },
  { name: "region", type: "VARCHAR", classification: "public" },
  { name: "amount", type: "DOUBLE", classification: "public" },
];

/** Narrowing helper: the test bails with the failure envelope instead of asserting against `unknown`. */
function expectOk(envelope: Envelope): Extract<Envelope, { ok: true }> {
  if (!envelope.ok) throw new Error(`expected a success envelope: ${JSON.stringify(envelope.error)}`);
  return envelope;
}

function importStore(engine: FakeEngine = fakeEngine()): {
  store: WorkspaceStore;
  intake: ReturnType<typeof createIntakeRegistry>;
  engine: FakeEngine;
} {
  const intake = createIntakeRegistry();
  const store = createWorkspaceStore({
    kernel: createCustodyKernel(() => FIXED_NOW),
    engine,
    intake,
    now: () => FIXED_NOW,
  });
  return { store, intake, engine };
}

function putTicket(
  intake: ReturnType<typeof createIntakeRegistry>,
  name: string,
  bytes: Uint8Array = CSV_BYTES,
): string {
  return intake.put(name, bytes).ticketId;
}

function dispatchImport(
  store: WorkspaceStore,
  ticketId: string,
  name: string,
  key = "import-01",
  expectedRevision = 0,
): Promise<Envelope> {
  return store.dispatch({
    kind: "importLocalFile",
    input: { ticketId, name, expectedRevision, idempotencyKey: key },
  });
}

describe("importLocalFile: the happy path", () => {
  it("commits the imported relation as the active dataset with honest metadata", async () => {
    const { store, intake, engine } = importStore();
    const ticketId = putTicket(intake, "my_sales.csv");
    const envelope = expectOk(await dispatchImport(store, ticketId, "my_sales.csv"));
    const relation = importedRelationName("my_sales.csv", intakeDigest("my_sales.csv", CSV_BYTES));
    expect(envelope.revision).toBe(1);
    expect(envelope.data).toEqual({
      datasetId: relation,
      schemaDigest: sha256Hex(canonicalSchemaJson(EXPECTED_COLUMNS)),
      rowCount: 3,
      byteSizeEstimate: CSV_BYTES.byteLength,
      policy: "sensitive_aggregate_only",
      minimumCohortSize: 10,
    });

    const ws = store.getSnapshot();
    expect(ws.activeDatasetId).toBe(relation);
    expect(ws.activeDataset?.columns).toEqual(EXPECTED_COLUMNS);
    expect(ws.operations[0]).toMatchObject({ kind: "import_local_file", status: "succeeded" });
    expect(engine.intakeFiles).toEqual([{ relation, name: "my_sales.csv", bytes: CSV_BYTES }]);

    // The event log carries the import as a first-class kind.
    const events = CompiledGetContextEvents.parse(
      await store.dispatch({ kind: "getContext", input: { scope: "events" } }),
    );
    expect(events.data.events[0]?.kind).toBe("dataset_imported");
  });

  it("discloses direct identifiers in the schema read as omitted", async () => {
    const { store, intake } = importStore();
    await dispatchImport(store, putTicket(intake, "my_sales.csv"), "my_sales.csv");

    const schema = CompiledGetContextSchema.parse(
      await store.dispatch({
        kind: "getContext",
        input: { scope: "schema", datasetId: store.getSnapshot().activeDatasetId ?? "" },
      }),
    );
    const mrnLike = schema.data.schema.find((column) => column.name === "patient_id");
    expect(mrnLike).toMatchObject({ classification: "direct_identifier", omitted: true });
  });

  it("imports are governed analyses' sources: lineage starts at the local relation", async () => {
    const { store, intake } = importStore();
    await dispatchImport(store, putTicket(intake, "my_sales.csv"), "my_sales.csv");
    const relation = store.getSnapshot().activeDatasetId ?? "";

    const analysis = CompiledRunAnalysis.parse(
      await store.dispatch({
        kind: "runAnalysis",
        input: {
          source: { kind: "dataset", id: relation },
          sql: `SELECT region, COUNT(*) AS n FROM ${relation} GROUP BY region`,
          bindings: {},
          expectedRevision: 1,
          idempotencyKey: "import-analyze-01",
        },
      }),
    );
    expect(analysis.data.artifact.lineage).toEqual([{ kind: "dataset", id: relation }]);
    expect(analysis.data.artifact.schema.some((column) => column.name === "patient_id")).toBe(false);
  });
});

describe("importLocalFile: the one-shot ticket", () => {
  it("consumes the ticket on execution — a second command with it finds nothing", async () => {
    const { store, intake } = importStore();
    const ticketId = putTicket(intake, "my_sales.csv");
    expect(await dispatchImport(store, ticketId, "my_sales.csv", "import-first")).toMatchObject({ ok: true });

    const second = await dispatchImport(store, ticketId, "my_sales.csv", "import-second", 1);
    expect(second).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(JSON.stringify(second.ok ? "" : second.error.message)).toContain("drop the file again");
  });

  it("leaves zero trace on a cancelled import: ticket consumed, no dataset, nothing dropped on a dead engine", async () => {
    // The held-op pattern (0df17de): the cancelled import's own dispatch
    // never settles — like a killed worker, the fake's held intake never
    // answers — so the assertions read the workspace after the cancel
    // command's own commit.
    const { store, intake, engine } = importStore();
    engine.onIntake(() => new Promise(() => {}));
    const ticketId = putTicket(intake, "my_sales.csv");
    void dispatchImport(store, ticketId, "my_sales.csv", "import-cancel");

    const cancel = await store.dispatch({
      kind: "cancelActiveOperation",
      input: { expectedRevision: 0, idempotencyKey: "import-cancel-op" },
    });
    expect(cancel.ok).toBe(true);

    const ws = store.getSnapshot();
    expect(ws.activeDatasetId).toBeNull();
    expect(ws.revision).toBe(1);
    expect(ws.operations[0]).toMatchObject({ kind: "import_local_file", status: "cancelled" });
    expect(engine.intakeFiles).toHaveLength(1);
    expect(engine.dropped).toEqual([]);
    expect(intake.consume(ticketId)).toBeUndefined();
  });
});

describe("importLocalFile: ceilings deny pre-execution (Amendment 3)", () => {
  it("rejects a non-CSV before the engine sees anything", async () => {
    const { store, intake, engine } = importStore();
    const envelope = await dispatchImport(store, putTicket(intake, "notes.txt"), "notes.txt");
    expect(envelope).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(engine.intakeFiles).toHaveLength(0);
    expect(store.getSnapshot().revision).toBe(0);
    expect(store.getSnapshot().operations[0]).toMatchObject({ status: "failed", errorCode: "VALIDATION_ERROR" });
  });

  it("rejects an empty file", async () => {
    const { store, intake, engine } = importStore();
    const envelope = await dispatchImport(store, putTicket(intake, "empty.csv", new Uint8Array()), "empty.csv");
    expect(envelope).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(engine.intakeFiles).toHaveLength(0);
  });

  it("rejects a file above the 200 MB ceiling", async () => {
    const { store, intake, engine } = importStore();
    const oversize = new Uint8Array(MAX_IMPORT_BYTES + 1);
    const envelope = await dispatchImport(store, putTicket(intake, "big.csv", oversize), "big.csv");
    expect(envelope).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", details: { maximumBytes: MAX_IMPORT_BYTES } },
    });
    expect(engine.intakeFiles).toHaveLength(0);
  });

  it("caches deterministic denials: an exact replay re-answers without re-running", async () => {
    const { store, intake, engine } = importStore();
    const ticketId = putTicket(intake, "notes.txt");
    const first = await dispatchImport(store, ticketId, "notes.txt", "import-deterministic");
    expect(first).toMatchObject({ ok: false });
    // Exact replay: the original input verbatim — the cache answers before
    // the (already deleted) ticket could matter.
    const replay = await dispatchImport(store, ticketId, "notes.txt", "import-deterministic");
    expect(replay).toEqual(first);
    expect(engine.intakeFiles).toHaveLength(0);
  });
});

describe("importLocalFile: engine intake failures", () => {
  it("drops the relation and settles VALIDATION_ERROR when the engine denies the schema", async () => {
    const { store, intake, engine } = importStore();
    engine.onIntake(() =>
      Promise.reject({
        code: "VALIDATION_ERROR",
        message: "That file has 5,001 columns — the import ceiling is 5,000.",
        retryable: false,
        details: { field: "columns", columns: 5_001, maximum: 5_000 },
      }),
    );
    const envelope = await dispatchImport(store, putTicket(intake, "wide.csv"), "wide.csv");
    expect(envelope).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    const relation = importedRelationName("wide.csv", intakeDigest("wide.csv", CSV_BYTES));
    expect(engine.dropped).toEqual([relation]);
    expect(store.getSnapshot().activeDatasetId).toBeNull();
  });
});

describe("importLocalFile: identity and conflicts", () => {
  it("derives the same relation for the same file and different relations for slug collisions", () => {
    const digestA = intakeDigest("my sales.csv", CSV_BYTES);
    const digestB = intakeDigest("my-sales.csv", new TextEncoder().encode("region,amount\neast,1\n"));
    expect(importedRelationName("my sales.csv", digestA)).toMatch(/^local_[a-z0-9_]{1,24}_[0-9a-f]{4}$/);
    expect(importedRelationName("my sales.csv", digestA)).toBe(importedRelationName("my sales.csv", digestA));
    expect(importedRelationName("my sales.csv", digestA)).not.toBe(importedRelationName("my-sales.csv", digestB));
  });

  it("collides with the single-flight slot like every other operation", async () => {
    const { store, intake, engine } = importStore();
    engine.onIntake(() => new Promise(() => {}));
    void dispatchImport(store, putTicket(intake, "my_sales.csv"), "my_sales.csv", "import-hold");

    const second = await dispatchImport(store, putTicket(intake, "other.csv"), "other.csv", "import-conflict");
    expect(second).toMatchObject({ ok: false, error: { code: "OPERATION_CONFLICT" } });
  });

  it("advertises the human import capability", () => {
    const { store } = importStore();
    expect(store.getSnapshot().capabilities).toContain("import_local_file");
  });
});
