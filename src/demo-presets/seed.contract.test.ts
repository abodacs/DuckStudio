import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { saasChurnPreset } from "./catalog";
import {
  HEALTHCARE_PII_CANONICAL_SQL,
  SAAS_CHURN_CANONICAL_SQL,
  SAAS_CHURN_HEADLINE_SQL,
} from "./canonical-sql";
import { SAAS_CHURN_PINNED, generateSaasChurnRows, type SaasChurnRow } from "./saas-churn";
import { generateHealthcarePiiRows, type HealthcarePiiRow } from "./healthcare-pii";

/**
 * The preset contract test (ARCHITECTURE.md): the canonical SQL runs in real
 * DuckDB against the generated rows and must reproduce the pinned prd.md §6
 * values. If a generator change drifts the seed, this fails — the demo
 * numbers stay load-bearing, never hardcoded chrome.
 */

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "duckstudio-preset-contract-"));
  await writeFile(
    join(workDir, "saas_churn.csv"),
    toCsv(saasChurnPreset.columns.map((column) => column.name), saasRows),
  );
  await writeFile(
    join(workDir, "healthcare_pii.csv"),
    toCsv(Object.keys(healthRows[0] as object), healthRows),
  );
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const saasRows = generateSaasChurnRows();
const healthRows = generateHealthcarePiiRows();

function csvField(value: string | number | boolean): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(
  header: readonly string[],
  rows: readonly (SaasChurnRow | HealthcarePiiRow)[],
): string {
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      header
        .map((name) =>
          csvField((row as unknown as Record<string, unknown>)[name] as string | number | boolean),
        )
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

async function queryRows(
  connection: DuckDBConnection,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const result = await connection.runAndReadAll(sql);
  return result.getRowObjectsJson() as Record<string, unknown>[];
}

/** Explicit column types, so the sniffer cannot retype a column into BigInt. */
async function loadSaasChurn(connection: DuckDBConnection): Promise<void> {
  await connection.run(`
    CREATE TABLE saas_churn (
      tenant_id VARCHAR, plan VARCHAR, seats INTEGER, mrr DECIMAL(10,2),
      tickets INTEGER, churned BOOLEAN, churn_rate DECIMAL(6,4),
      tenure_months INTEGER, last_login_days INTEGER,
      feature_adoption_score DECIMAL(4,3), nps_score INTEGER,
      industry VARCHAR, region VARCHAR, signup_channel VARCHAR
    )
  `);
  await connection.run(`
    INSERT INTO saas_churn
    SELECT * FROM read_csv('${join(workDir, "saas_churn.csv")}', header = true, columns = {
      'tenant_id': 'VARCHAR', 'plan': 'VARCHAR', 'seats': 'INTEGER',
      'mrr': 'DECIMAL(10,2)', 'tickets': 'INTEGER', 'churned': 'BOOLEAN',
      'churn_rate': 'DECIMAL(6,4)', 'tenure_months': 'INTEGER',
      'last_login_days': 'INTEGER', 'feature_adoption_score': 'DECIMAL(4,3)',
      'nps_score': 'INTEGER', 'industry': 'VARCHAR', 'region': 'VARCHAR',
      'signup_channel': 'VARCHAR'
    })
  `);
}

describe("saas_churn canonical SQL (prd.md §6.1)", () => {
  it("reproduces the three pinned headline values from the seed", { timeout: 30_000 }, async () => {
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await loadSaasChurn(connection);

    const [headline] = await queryRows(connection, SAAS_CHURN_HEADLINE_SQL);
    expect(Number(headline?.churn_rate_pct)).toBe(SAAS_CHURN_PINNED.churnRatePct);
    expect(Number(headline?.avg_tickets)).toBe(SAAS_CHURN_PINNED.avgTickets);
    expect(headline?.impacted_mrr).toBe(`${SAAS_CHURN_PINNED.impactedMrr.toFixed(2)}`);
  });

  it("groups by ticket count with churn rising above 5 tickets", { timeout: 30_000 }, async () => {
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await loadSaasChurn(connection);
    const buckets = await queryRows(connection, SAAS_CHURN_CANONICAL_SQL);
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
    await connection.run(`
      CREATE TABLE healthcare_pii (
        age_band VARCHAR, region VARCHAR, diagnosis VARCHAR,
        visit_count INTEGER, length_of_stay_days INTEGER,
        readmitted BOOLEAN, billed_amount DECIMAL(10,2)
      )
    `);
    await connection.run(`
      INSERT INTO healthcare_pii
      SELECT * FROM read_csv('${join(workDir, "healthcare_pii.csv")}', header = true, columns = {
        'age_band': 'VARCHAR', 'region': 'VARCHAR', 'diagnosis': 'VARCHAR',
        'visit_count': 'INTEGER', 'length_of_stay_days': 'INTEGER',
        'readmitted': 'BOOLEAN', 'billed_amount': 'DECIMAL(10,2)'
      })
    `);

    const cohorts = await queryRows(connection, HEALTHCARE_PII_CANONICAL_SQL);
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
