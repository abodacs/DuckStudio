import * as duckdb from "@duckdb/duckdb-wasm";
import { createWorkerHandler, presetCsv, PRESET_TRIPLES, type BoundedRead, type DuckEngineRuntime } from "./worker-handler";
import { decimalCellToNumber, decimalScale } from "./decimal-cells";
import type { EngineColumn, EngineRequest, EngineResponse, WarmResult } from "./protocol";

/**
 * The browser engine worker (ADR 0002): owns the `AsyncDuckDB`, the
 * connection, and the in-memory preset tables. DuckDB-WASM is self-hosted
 * from `/duckdb/` (same-origin — COEP `require-corp` blocks third-party
 * responses; scripts/download-duckdb-wasm.sh pins the assets). No coi bundle
 * is shipped, so `selectBundle` returns eh and execution stays
 * single-threaded; mvp covers engines without wasm exceptions.
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

// Lazy Bundle Resolution
let bundlePromise: Promise<duckdb.DuckDBBundle> | null = null;
function resolveBundle(): Promise<duckdb.DuckDBBundle> {
  bundlePromise ??= duckdb.selectBundle(SELF_HOSTED_BUNDLES).catch((error: unknown) => {
    // A failed selection must not poison the memo: the next request retries.
    bundlePromise = null;
    throw error;
  });
  return bundlePromise;
}

async function createBrowserRuntime(): Promise<DuckEngineRuntime> {
  const bundle = await resolveBundle();
  if (!bundle.mainWorker) {
    throw new Error("duck-engine: the self-hosted bundle carries no main worker script");
  }
  const duckWorker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), duckWorker);
  let connection: duckdb.AsyncDuckDBConnection;
  try {
    await db.instantiate(bundle.mainModule);
    connection = await db.connect();
  } catch (error) {
    // Initialization failed: this instance is unusable and the next request
    // spawns a fresh AsyncDuckDB. Terminate the nested worker so a failed
    // init cannot leak it, log the diagnostic (worker console in DevTools),
    // and fail the request — the response stays §9-shaped.
    console.error("duck-engine: engine initialization failed; terminating the engine worker", error);
    duckWorker.terminate();
    throw error;
  }
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
        schema = batch.schema.fields.map((field) => ({ name: field.name, type: duckDbType(field.type) }));
        const vectors = batch.schema.fields.map((field) => batch.getChild(field.name));
        // Decimal results (HUGEINT/DECIMAL aggregates) read as raw unscaled
        // words or numbers; decode to scaled numbers so rows, inserts, and
        // summaries stay plain numbers.
        const decimalScales = batch.schema.fields.map((field) => decimalScale(field.type));
        const batchLength = Math.min(batch.numRows, maxRows - rows.length);
        for (let rowIndex = 0; rowIndex < batchLength; rowIndex += 1) {
          const row: Record<string, unknown> = {};
          batch.schema.fields.forEach((field, columnIndex) => {
            const scale = decimalScales[columnIndex] ?? null;
            const raw = (vectors[columnIndex] as { get(rowIndex: number): unknown }).get(rowIndex);
            row[field.name] = scale === null ? raw : decimalCellToNumber(raw, scale);
          });
          rows.push(row);
        }
        if (rows.length >= maxRows) break;
      }
      return { schema, rows, executionMs: performance.now() - started };
    },

    async materialize(relationName, result) {
      const columns = result.schema.map((column) => column.name);
      const columnList = result.schema
        .map((column) => `"${column.name}" ${column.type}`)
        .join(", ");
      await connection.query(`CREATE TABLE ${relationName} (${columnList})`);
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
      const insert = await connection.prepare(`INSERT INTO ${relationName} VALUES (${placeholders})`);
      try {
        let rowCount = 0;
        for (const batch of result.batches) {
          for (let rowIndex = 0; rowIndex < batch.rowCount; rowIndex += 1) {
            await insert.query(...columns.map((name) => (batch.values[name]?.[rowIndex] as never) ?? null));
            rowCount += 1;
          }
        }
        return { relationName, rowCount };
      } finally {
        await insert.close();
      }
    },

    async drop(relationName) {
      await connection.query(`DROP TABLE IF EXISTS ${relationName}`);
    },
  };
}

/**
 * duckdb-wasm surfaces result types as Arrow type names ("Utf8", "Int64"),
 * while every DuckDB consumer of the schema — the artifact digest (§4.3),
 * the presentation inference, and this worker's own `CREATE TABLE` in
 * `materialize` — speaks DuckDB type names. The node runtime reports DuckDB
 * names natively; this map gives the browser runtime the same vocabulary.
 * Arrow decimals render as `Decimal[precision e scale]` (e.g. `Decimal[38e+2]`
 * for DECIMAL(38,2)) and must become parseable `DECIMAL(p,s)` DDL.
 */
const ARROW_TO_DUCKDB_TYPES: Readonly<Record<string, string>> = {
  Utf8: "VARCHAR",
  LargeUtf8: "VARCHAR",
  Bool: "BOOLEAN",
  Int8: "TINYINT",
  Int16: "SMALLINT",
  Int32: "INTEGER",
  Int64: "BIGINT",
  Int128: "HUGEINT",
  Uint8: "UTINYINT",
  Uint16: "USMALLINT",
  Uint32: "UINTEGER",
  Uint64: "UBIGINT",
  Float32: "FLOAT",
  Float64: "DOUBLE",
  DateDay: "DATE",
  Timestamp: "TIMESTAMP",
  TimeMicrosecond: "TIME",
  Binary: "BLOB",
};

function duckDbType(fieldType: { toString(): string }): string {
  const name = String(fieldType);
  const decimal = /^Decimal\((\d+),\s*(\d+)\)$/.exec(name) ?? /^Decimal\[(\d+)e\+?(-?\d+)\]$/.exec(name);
  if (decimal) return `DECIMAL(${decimal[1]},${decimal[2]})`;
  return ARROW_TO_DUCKDB_TYPES[name] ?? name;
}

const workerSelf = self as unknown as WorkerSelf;

type Handler = Awaited<ReturnType<typeof createWorkerHandler>>;
let handlerPromise: Promise<Handler> | null = null;

function getHandler(): Promise<Handler> {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      try {
        const runtime = await createBrowserRuntime();
        return createWorkerHandler(runtime);
      } catch (error) {
        handlerPromise = null;
        throw error;
      }
    })();
  }
  return handlerPromise;
}

// Batched Pending Requests: queue requests and drain them sequentially
const queued: EngineRequest[] = [];
let isProcessing = false;

async function drainPendingRequests(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  try {
    while (queued.length > 0) {
      const batch = queued.splice(0, queued.length);
      for (const request of batch) {
        try {
          const handler = await getHandler();
          const response = await handler(request);
          workerSelf.postMessage(response);
        } catch (error) {
          // The §9-shaped response below fails the request; the diagnostic
          // itself stays in the worker console (DevTools) — it may quote
          // engine internals and never crosses custody.
          console.error("duck-engine: request failed", request.kind, error);
          workerSelf.postMessage({
            id: request.id,
            kind: request.kind === "materialize" ? "materialize" : request.kind === "drop" ? "drop" : request.kind,
            ok: false,
            failure: {
              code: "INTERNAL_ERROR",
              message: "The engine worker failed to execute the authorized statement; read context and retry.",
              retryable: true,
              details: { phase: "worker" },
            },
          } as EngineResponse);
        }
      }
    }
  } finally {
    isProcessing = false;
  }
}

workerSelf.onmessage = (event: { data: EngineRequest }) => {
  queued.push(event.data);
  void drainPendingRequests();
};
