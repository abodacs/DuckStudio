import { DuckDBInstance } from "@duckdb/node-api";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRESET_TRIPLES, presetCsv, type BoundedRead, type DuckEngineRuntime } from "./worker-handler";
import { decodeEngineCell } from "./result-decode";
import type { WarmResult } from "./protocol";

/**
 * The headless DuckDB runtime (vitest path): the same `DuckEngineRuntime`
 * seam the browser worker binds, backed by real DuckDB through
 * `@duckdb/node-api` — the repo's established real-DuckDB-in-tests surface.
 * The worker handler, budgets, and verbatim decision consumption are tested
 * through this; the browser `duckdb.worker.ts` binds duckdb-wasm to the
 * same seam and is exercised by the e2e suite.
 */
export interface NodeDuckRuntime extends DuckEngineRuntime {
  dispose(): Promise<void>;
}

export async function createNodeDuckRuntime(): Promise<NodeDuckRuntime> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  const workDir = await mkdtemp(join(tmpdir(), "duckstudio-engine-"));
  let warmResult: WarmResult | null = null;

  return {
    async warm(): Promise<WarmResult> {
      if (warmResult) return warmResult;
      const warmStart = performance.now();
      const materializationStart = performance.now();
      const materializedRelations: { relationName: string; rowCount: number }[] = [];
      for (const triple of PRESET_TRIPLES) {
        const { name, csv, columns } = presetCsv(triple);
        const csvPath = join(workDir, `${name}.csv`);
        await writeFile(csvPath, csv);
        const columnList = columns.map((column) => `${column.name} ${column.type}`).join(", ");
        const spec = columns.map((column) => `'${column.name}': '${column.type}'`).join(", ");
        await connection.run(`CREATE TABLE ${name} (${columnList})`);
        await connection.run(
          `INSERT INTO ${name} SELECT * FROM read_csv('${csvPath}', header = true, columns = {${spec}})`,
        );
        const reader = await connection.runAndReadAll(`SELECT COUNT(*) AS n FROM ${name}`);
        const [count] = reader.getRowObjectsJson();
        materializedRelations.push({ relationName: name, rowCount: Number(count?.n) });
      }
      const materializationMs = performance.now() - materializationStart;
      warmResult = {
        materializedRelations,
        warmMs: performance.now() - warmStart,
        materializationMs,
      };
      return warmResult;
    },

    async runBounded(sql, positionalBindings, maxRows): Promise<BoundedRead> {
      const started = performance.now();
      const prepared = await connection.prepare(sql);
      try {
        prepared.bind(positionalBindings as Parameters<typeof prepared.bind>[0]);
        const reader = await prepared.runAndReadUntil(maxRows);
        await reader.readUntil(maxRows);
        const schema = reader.columnNames().map((name, index) => ({
          name,
          type: reader.columnType(index).toString(),
        }));
        // Same decode boundary as the browser runtime: decimal knowledge
        // lives in one place, so both adapters return identically shaped rows.
        const rows = (reader.getRowObjectsJson() as Record<string, unknown>[]).map((row) =>
          Object.fromEntries(
            schema.map((column) => [column.name, decodeEngineCell(row[column.name], column.type)]),
          ),
        );
        return { schema, rows: rows.slice(0, maxRows), executionMs: performance.now() - started };
      } finally {
        prepared.destroySync();
      }
    },

    async materialize(relationName, result) {
      const columns = result.schema.map((column) => column.name);
      const columnList = result.schema
        .map((column) => `"${column.name}" ${column.type}`)
        .join(", ");
      await connection.run(`CREATE TABLE ${relationName} (${columnList})`);
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
      const insert = await connection.prepare(`INSERT INTO ${relationName} VALUES (${placeholders})`);
      try {
        let rowCount = 0;
        for (const batch of result.batches) {
          for (let rowIndex = 0; rowIndex < batch.rowCount; rowIndex += 1) {
            insert.bind(
              columns.map((name) => (batch.values[name]?.[rowIndex] as never) ?? null),
            );
            await insert.run();
            rowCount += 1;
          }
        }
        return { relationName, rowCount };
      } finally {
        insert.destroySync();
      }
    },

    async drop(relationName) {
      await connection.run(`DROP TABLE IF EXISTS ${relationName}`);
    },

    async dispose(): Promise<void> {
      await rm(workDir, { recursive: true, force: true });
    },
  };
}
