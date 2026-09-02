import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { healthcarePii, saasChurn, materializedColumns, type PresetTriple } from "../triples";
import { toCsv } from "../csv";
import { SAAS_CHURN_HEADLINE_SQL } from "../canonical-sql";
import { SAAS_CHURN_PINNED } from "../saas-churn";

/**
 * The preset contract test (ARCHITECTURE.md; ADR 0005 am3 names it
 * `_contract/preset-numbers.test.ts`): each preset's canonical SQL runs in
 * real DuckDB against the generated rows and must reproduce the pinned
 * prd.md §6 values. If a generator change drifts the seed, this fails — the
 * demo numbers stay load-bearing, never hardcoded chrome.
 *
 * The joins are structural, not coincidental: the CSV file, the DDL, and the
 * load spec are derived from the triple's metadata, and the materialized
 * column list is the catalog schema minus direct identifiers (the custody
 * omission rule), so a catalog edit cannot desynchronize the fixture.
 */

const triples = [saasChurn, healthcarePii] as const;

const csvPath = (triple: Pick<PresetTriple, "metadata">, workDir: string) =>
  join(workDir, `${triple.metadata.datasetId}.csv`);

let workDir: string;

const rows = new Map<string, Record<string, unknown>[]>();
for (const triple of triples) {
  rows.set(triple.metadata.datasetId, triple.generate() as unknown as Record<string, unknown>[]);
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "duckstudio-preset-contract-"));
  for (const triple of triples) {
    const columns = materializedColumns(triple).map((column) => column.name);
    const tripleRows = rows.get(triple.metadata.datasetId) as Record<string, unknown>[];
    expect(Object.keys(tripleRows[0] as object)).toEqual(columns);
    await writeFile(csvPath(triple, workDir), toCsv(columns, tripleRows));
  }
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function queryRows(
  connection: DuckDBConnection,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const result = await connection.runAndReadAll(sql);
  return result.getRowObjectsJson() as Record<string, unknown>[];
}

/** Explicit column types from the triple's metadata, so the sniffer cannot retype a column into BigInt. */
async function loadPreset(triple: Pick<PresetTriple, "metadata" | "sql">, connection: DuckDBConnection): Promise<void> {
  const columns = materializedColumns(triple);
  const columnList = columns.map((column) => `${column.name} ${column.type}`).join(", ");
  const spec = columns
    .map((column) => `'${column.name}': '${column.type}'`)
    .join(", ");
  await connection.run(`CREATE TABLE ${triple.metadata.datasetId} (${columnList})`);
  await connection.run(`
    INSERT INTO ${triple.metadata.datasetId}
    SELECT * FROM read_csv('${csvPath(triple, workDir)}', header = true, columns = {${spec}})
  `);
}

describe("preset triples (ARCHITECTURE.md: the seed→relation interface)", () => {
  it("joins metadata, generator, and canonical SQL per dataset", () => {
    expect(saasChurn.metadata.datasetId).toBe("saas_churn");
    expect(healthcarePii.metadata.datasetId).toBe("healthcare_pii");
    for (const triple of triples) {
      expect(triple.sql).toContain(`FROM ${triple.metadata.datasetId}`);
      expect(triple.generate().length).toBe(triple.metadata.rowCount);
    }
  });
});

describe("saas_churn canonical SQL (prd.md §6.1)", () => {
  it("reproduces the three pinned headline values from the seed", { timeout: 30_000 }, async () => {
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await loadPreset(saasChurn, connection);

    const [headline] = await queryRows(connection, SAAS_CHURN_HEADLINE_SQL);
    expect(Number(headline?.churn_rate_pct)).toBe(SAAS_CHURN_PINNED.churnRatePct);
    expect(Number(headline?.avg_tickets)).toBe(SAAS_CHURN_PINNED.avgTickets);
    expect(headline?.impacted_mrr).toBe(`${SAAS_CHURN_PINNED.impactedMrr.toFixed(2)}`);
  });

  it("groups by ticket count with churn rising above 5 tickets", { timeout: 30_000 }, async () => {
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await loadPreset(saasChurn, connection);
    const buckets = await queryRows(connection, saasChurn.sql);
    expect(buckets.length).toBeGreaterThan(10);

    const churnShare = (tickets: number) => {
      const bucket = buckets.find((row) => row.tickets === tickets);
      expect(bucket).toBeDefined();
      return Number(bucket?.churned_accounts) / Number(bucket?.accounts);
    };
    expect(churnShare(9)).toBeGreaterThan(churnShare(5));
    expect(churnShare(5)).toBeGreaterThan(churnShare(2));
  });
});

describe("healthcare_pii canonical SQL (prd.md §6.2)", () => {
  it("releases only aggregates of cohorts at or above ten records", { timeout: 30_000 }, async () => {
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await loadPreset(healthcarePii, connection);

    const cohorts = await queryRows(connection, healthcarePii.sql);
    expect(cohorts.length).toBe(8);
    let releasedPatients = 0;
    for (const cohort of cohorts) {
      expect(Number(cohort.patients)).toBeGreaterThanOrEqual(10);
      releasedPatients += Number(cohort.patients);
    }
    expect(releasedPatients).toBe(100_000);
    expect(Object.keys(cohorts[0] as object).sort()).toEqual([
      "avg_billed_amount",
      "avg_visits",
      "diagnosis",
      "patients",
    ]);
  });
});
