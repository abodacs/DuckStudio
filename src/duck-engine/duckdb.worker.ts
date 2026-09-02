import * as duckdb from "@duckdb/duckdb-wasm";
import { createWorkerHandler, presetCsv, PRESET_TRIPLES, type BoundedRead, type DuckEngineRuntime } from "./worker-handler";
import type { EngineColumn, EngineRequest, EngineResponse, WarmResult } from "./protocol";

/**
 * The browser engine worker (ADR 0002): owns the `AsyncDuckDB`, the
 * connection, and the in-memory preset tables. DuckDB-WASM is self-hosted
 * from `/duckdb/` (same-origin — COEP `require-corp` blocks third-party
 * responses; scripts/download-duckdb-wasm.sh pins the assets). The eh build
 * runs under the shipped COOP/COEP isolation; mvp is the fallback.
 *
 * The handler consumes custody decisions verbatim; this file adds no policy.
 */

interface WorkerSelf {
  onmessage: ((event: { data: EngineRequest }) => void) | null;
  postMessage(message: EngineResponse): void;
}

const SELF_HOSTED_BUNDLES = {
  mvp: {
    mainModule: "/duckdb/duckdb-mvp.wasm",
    mainWorker: "/duckdb/duckdb-browser-mvp.worker.js",
  },
  eh: {
    mainModule: "/duckdb/duckdb-eh.wasm",
    mainWorker: "/duckdb/duckdb-browser-eh.worker.js",
  },
};

async function createBrowserRuntime(): Promise<DuckEngineRuntime> {
  const bundle = await duckdb.selectBundle(SELF_HOSTED_BUNDLES);
  if (!bundle.mainWorker) {
    throw new Error("duck-engine: the self-hosted bundle carries no main worker script");
  }
  const duckWorker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), duckWorker);
  await db.instantiate(bundle.mainModule);
  const connection = await db.connect();
  let warmResult: WarmResult | null = null;

  return {
    async warm(): Promise<WarmResult> {
      if (warmResult) return warmResult;
      const warmStart = performance.now();
      const materializedRelations: { relationName: string; rowCount: number }[] = [];
      for (const triple of PRESET_TRIPLES) {
        const { name, csv, columns } = presetCsv(triple);
        await db.registerFileBuffer(`${name}.csv`, new TextEncoder().encode(csv));
        const spec = columns.map((column) => `'${column.name}': '${column.type}'`).join(", ");
        await connection.query(
          `CREATE TABLE ${name} AS SELECT * FROM read_csv('${name}.csv', header = true, columns = {${spec}})`,
        );
        const table = await connection.query(`SELECT COUNT(*) AS n FROM ${name}`);
        const row = table.toArray()[0] as { n: unknown } | undefined;
        materializedRelations.push({ relationName: name, rowCount: Number(row?.n) });
      }
      const materializationMs = performance.now() - warmStart;
      warmResult = {
        materializedRelations,
        warmMs: materializationMs,
        materializationMs,
      };
      return warmResult;
    },

    async runBounded(sql, positionalBindings, maxRows): Promise<BoundedRead> {
      const started = performance.now();
      const prepared = await connection.prepare(sql);
      const stream = await prepared.send(...positionalBindings);
      let schema: readonly EngineColumn[] = [];
      const rows: Record<string, unknown>[] = [];
      for await (const batch of stream) {
        // Bounded cursor: stop at the resultRows budget; the for-await break
        // closes the stream (ADR 0002: streamArrow → bounded cursor).
        schema = batch.schema.fields.map((field) => ({ name: field.name, type: String(field.type) }));
        const vectors = batch.schema.fields.map((field) => batch.getChild(field.name));
        const batchLength = Math.min(batch.numRows, maxRows - rows.length);
        for (let rowIndex = 0; rowIndex < batchLength; rowIndex += 1) {
          const row: Record<string, unknown> = {};
          batch.schema.fields.forEach((field, columnIndex) => {
            row[field.name] = (vectors[columnIndex] as { get(rowIndex: number): unknown }).get(rowIndex);
          });
          rows.push(row);
        }
        if (rows.length >= maxRows) break;
      }
      return { schema, rows, executionMs: performance.now() - started };
    },
  };
}

const workerSelf = self as unknown as WorkerSelf;

// Register the message hook before instantiation finishes: the main thread
// may post the warm request while the module body is still awaiting the
// runtime, and a null `onmessage` would silently drop it.
type Handler = Awaited<ReturnType<typeof createWorkerHandler>>;
let handler: Handler | null = null;
const queued: EngineRequest[] = [];
const dispatch = (request: EngineRequest): void => {
  void handler?.(request).then((response) => {
    workerSelf.postMessage(response);
  });
};
workerSelf.onmessage = (event: { data: EngineRequest }) => {
  if (handler) dispatch(event.data);
  else queued.push(event.data);
};

void createBrowserRuntime().then((runtime) => {
  handler = createWorkerHandler(runtime);
  for (const request of queued.splice(0)) dispatch(request);
});
