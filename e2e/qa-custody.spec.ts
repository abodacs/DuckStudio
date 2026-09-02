import { expect, test } from "@playwright/test";
import {
  agentSurface,
  HEALTHCARE_ACTIVATE,
  HEALTHCARE_CANONICAL_SQL,
  invokeTool,
  type EnvelopeFailure,
  type EnvelopeSuccess,
} from "./agent-surface";

// --- QA spec: custody and safety denials, in the live page
// (agent-system-design.md §15 scenarios 5, 6, 7, 12, 17). Every case here is
// a denial or a disclosure the product promises: unsafe SQL never reaches the
// worker, sensitive aggregates refuse small cohorts, raw rows never paint,
// and the custody evidence stays honest about what it cannot prove. ---

/** The pinned monitored transports (grilling 24). */
const MONITORED_TRANSPORTS = ["fetch", "XMLHttpRequest", "sendBeacon", "WebSocket", "WebTransport"];
const EVIDENCE_LIMITATIONS = [
  "Application shell traffic is outside dataset-upload accounting.",
  "Runtime interception is operational evidence, not a formal proof.",
];

test.describe("qa: sql isolation", () => {
  test("scenario 7: deny-listed statements are rejected before the worker, committing nothing", async ({
    page,
  }) => {
    await agentSurface(page);
    const activated = (await invokeTool(page, "duckdb_activate_dataset", {
      datasetId: "saas_churn",
      expectedRevision: 0,
      idempotencyKey: "qa-isolation-activate-01",
    })) as EnvelopeSuccess;
    expect(activated.ok).toBe(true);

    const unsafeStatements = [
      "CREATE TABLE stolen AS SELECT * FROM saas_churn",
      "INSERT INTO saas_churn VALUES (1, 1, false, 10.0)",
      "UPDATE saas_churn SET mrr = 0",
      "DELETE FROM saas_churn",
      "SELECT 1; SELECT 2",
      "ATTACH 'exfil.db' AS exfil",
      "COPY saas_churn TO 'exfil.csv'",
      "INSTALL httpfs",
      "LOAD httpfs",
      "SELECT 'https://example.com/exfil'",
    ];

    for (const [index, sql] of unsafeStatements.entries()) {
      const denied = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
        source: { kind: "dataset", id: "saas_churn" },
        sql,
        bindings: {},
        expectedRevision: 1,
        idempotencyKey: `qa-isolation-${String(index).padStart(2, "0")}`,
      })) as EnvelopeFailure;
      expect(denied.ok, `expected UNSAFE_SQL for: ${sql}`).toBe(false);
      expect(denied.error.code, `expected UNSAFE_SQL for: ${sql}`).toBe("UNSAFE_SQL");
      expect(denied.error.retryable, `expected non-retryable for: ${sql}`).toBe(false);
      expect(String(denied.error.details.blockedConstruct), `expected a named construct for: ${sql}`).toBeTruthy();
    }

    // Ten denials, zero commits: the workspace never left rev 1 and the
    // engine worker never saw a statement.
    await expect(page.getByText("ws_local_01 · rev 1 · saas_churn · public_synthetic")).toBeVisible();
    await expect(page.getByText("No artifacts — operations settle here as immutable artifacts.")).toBeVisible();
  });

  test("statements referencing unauthorized relations are rejected", async ({ page }) => {
    await agentSurface(page);
    const activated = (await invokeTool(page, "duckdb_activate_dataset", {
      datasetId: "saas_churn",
      expectedRevision: 0,
      idempotencyKey: "qa-isolation-activate-02",
    })) as EnvelopeSuccess;
    expect(activated.ok).toBe(true);
    const denied = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "saas_churn" },
      sql: "SELECT * FROM healthcare_pii",
      bindings: {},
      expectedRevision: 1,
      idempotencyKey: "qa-isolation-relation-01",
    })) as EnvelopeFailure;
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe("DATASET_UNAVAILABLE");
    expect(denied.error.details.relation).toBe("healthcare_pii");
    await expect(page.getByText("ws_local_01 · rev 1 · saas_churn · public_synthetic")).toBeVisible();
  });
});

test.describe("qa: sensitive dataset custody", () => {
  test("scenario 6: an aggregate with a sub-minimum cohort returns POLICY_DENIED and no artifact", async ({
    page,
  }) => {
    await agentSurface(page);
    const activated = (await invokeTool(page, "duckdb_activate_dataset", HEALTHCARE_ACTIVATE)) as EnvelopeSuccess;
    expect(activated.ok).toBe(true);
    expect(activated.data).toMatchObject({ datasetId: "healthcare_pii", policy: "sensitive_aggregate_only", minimumCohortSize: 10 });

    // billed_amount is continuous: nearly every group is a singleton cohort.
    const denied = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "healthcare_pii" },
      sql: "SELECT billed_amount, COUNT(*) AS n FROM healthcare_pii GROUP BY billed_amount",
      bindings: {},
      expectedRevision: 1,
      idempotencyKey: "qa-cohort-01",
    })) as EnvelopeFailure;
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe("POLICY_DENIED");
    expect(denied.error.retryable).toBe(false);
    expect(denied.error.details.cohortMinimum).toBe(10);
    expect(Number(denied.error.details.observedCohort)).toBeLessThan(10);

    // The denial commits nothing.
    await expect(page.getByText("ws_local_01 · rev 1 · healthcare_pii · sensitive_aggregate_only")).toBeVisible();
    await expect(page.getByText("No artifacts — operations settle here as immutable artifacts.")).toBeVisible();
  });

  test("scenario 5: a releasable aggregate paints no raw rows — in the envelope or the DOM", async ({
    page,
  }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", HEALTHCARE_ACTIVATE);
    const analysis = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "healthcare_pii" },
      sql: HEALTHCARE_CANONICAL_SQL,
      bindings: {},
      expectedRevision: 1,
      idempotencyKey: "qa-sensitive-analysis-01",
    })) as EnvelopeSuccess;
    expect(analysis.ok).toBe(true);
    const data = analysis.data as {
      artifact: {
        artifactId: string;
        rowCount: number;
        release: { rawRowsToAgent: number; rawRowsToSharedCanvas: number; omittedDirectIdentifiers: string[] };
        schema: { name: string; omitted?: boolean }[];
      };
      summary: { kpis: { label: string; value: number | null }[] };
    };
    // Only the cohort-level aggregates release; the direct identifier is
    // disclosed as omitted in the governed schema, never materialized as a
    // result column.
    expect(data.artifact.release.rawRowsToAgent).toBe(0);
    expect(data.artifact.release.rawRowsToSharedCanvas).toBe(0);
    expect(data.artifact.release.omittedDirectIdentifiers).toEqual(["mrn"]);
    expect(data.artifact.schema.find((column) => column.name === "mrn")).toBeUndefined();
    expect(data.artifact.rowCount).toBeLessThanOrEqual(8);
    for (const kpi of data.summary.kpis) {
      if (kpi.label === "patients") expect(Number(kpi.value)).toBeGreaterThanOrEqual(10);
    }

    // The grid explains the suppression instead of painting rows: no table,
    // no row cells, anywhere in the document.
    await page.getByRole("tab", { name: "Data Grid" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel).toContainText("Data Grid — suppressed by policy");
    await expect(panel).toContainText("Raw records never paint on the shared canvas.");
    await expect(page.locator("table")).toHaveCount(0);
    await expect(page.locator("td")).toHaveCount(0);
  });

  test("the context schema digest discloses the mrn omission instead of values", async ({ page }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", HEALTHCARE_ACTIVATE);
    const schema = (await invokeTool(page, "duckdb_get_context", {
      scope: "schema",
      datasetId: "healthcare_pii",
    })) as EnvelopeSuccess;
    expect(schema.ok).toBe(true);
    const data = schema.data as {
      datasetId: string;
      policy: string;
      minimumCohortSize: number;
      schema: { name: string; classification: string; omitted?: boolean }[];
    };
    expect(data.policy).toBe("sensitive_aggregate_only");
    expect(data.minimumCohortSize).toBe(10);
    const mrn = data.schema.find((column) => column.name === "mrn");
    expect(mrn).toMatchObject({ classification: "direct_identifier", omitted: true });
    const materialized = data.schema.filter((column) => column.name !== "mrn");
    expect(materialized.length).toBeGreaterThan(0);
    for (const column of materialized) {
      expect(column.classification).not.toBe("direct_identifier");
    }
  });

  test("raw row requests against the sensitive dataset deny outright", async ({ page }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", HEALTHCARE_ACTIVATE);
    // A small bounded read: the denial must come from release policy, never
    // from an execution side effect.
    const denied = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "healthcare_pii" },
      sql: "SELECT age_band, billed_amount FROM healthcare_pii LIMIT 25",
      bindings: {},
      expectedRevision: 1,
      idempotencyKey: "qa-sensitive-raw-01",
    })) as EnvelopeFailure;
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe("POLICY_DENIED");
    expect(denied.error.message).toContain("sensitive_aggregate_only");
    await expect(page.getByText("No artifacts — operations settle here as immutable artifacts.")).toBeVisible();
  });
});

test.describe("qa: honest custody evidence", () => {
  test("scenario 12: workspace scope is honest before any dataset is active", async ({ page }) => {
    await agentSurface(page);
    const evidence = (await invokeTool(page, "duckdb_verify_zero_egress", {
      scope: "workspace",
    })) as EnvelopeSuccess;
    expect(evidence.ok).toBe(true);
    expect(evidence.data).toEqual({
      observedAt: expect.any(String),
      scope: { kind: "workspace", id: "ws_local_01" },
      datasetBytesUploaded: 0,
      rawSensitiveValuesReleasedToTools: 0,
      rawSensitiveValuesReleasedToSharedCanvas: 0,
      monitoredTransports: MONITORED_TRANSPORTS,
      policy: null,
      lineage: [],
      limitations: EVIDENCE_LIMITATIONS,
    });
  });

  test("scenario 12: artifact scope distinguishes dataset bytes from shell traffic and always discloses limits", async ({
    page,
  }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", {
      datasetId: "saas_churn",
      expectedRevision: 0,
      idempotencyKey: "qa-custody-activate-01",
    });
    await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "saas_churn" },
      sql: "SELECT tickets, COUNT(*) AS accounts FROM saas_churn GROUP BY tickets ORDER BY tickets",
      bindings: {},
      expectedRevision: 1,
      idempotencyKey: "qa-custody-analysis-01",
    });

    const evidence = (await invokeTool(page, "duckdb_verify_zero_egress", {
      scope: "artifact",
      artifactId: "a_01",
    })) as EnvelopeSuccess;
    expect(evidence.ok).toBe(true);
    const data = evidence.data as {
      observedAt: string;
      scope: { kind: string; id: string };
      datasetBytesUploaded: number;
      rawSensitiveValuesReleasedToTools: number;
      monitoredTransports: string[];
      policy: string | null;
      lineage: { kind: string; id: string }[];
      limitations: string[];
    };
    expect(data.observedAt).toBeTruthy();
    expect(data.scope).toEqual({ kind: "artifact", id: "a_01" });
    // Zero dataset bytes crossed, ever; the shell's own traffic is disclosed
    // as outside the accounting, not hidden.
    expect(data.datasetBytesUploaded).toBe(0);
    expect(data.rawSensitiveValuesReleasedToTools).toBe(0);
    expect(data.monitoredTransports).toEqual(MONITORED_TRANSPORTS);
    expect(data.policy).toBe("public_synthetic");
    expect(data.lineage).toEqual([
      { kind: "dataset", id: "saas_churn" },
      { kind: "artifact", id: "a_01" },
    ]);
    expect(data.limitations).toEqual(EVIDENCE_LIMITATIONS);
  });
});

test.describe("qa: no preview grid", () => {
  test("scenario 17: activating a dataset alone paints no rows", async ({ page }) => {
    await agentSurface(page);
    const activated = (await invokeTool(page, "duckdb_activate_dataset", {
      datasetId: "saas_churn",
      expectedRevision: 0,
      idempotencyKey: "qa-preview-activate-01",
    })) as EnvelopeSuccess;
    expect(activated.ok).toBe(true);

    await expect(page.getByText("ws_local_01 · rev 1 · saas_churn · public_synthetic")).toBeVisible();
    await page.getByRole("tab", { name: "Data Grid" }).click();
    await expect(page.getByRole("tabpanel")).toContainText(
      "No artifact — the grid paints rows only from an approved artifact.",
    );
    await expect(page.locator("table")).toHaveCount(0);
    await expect(page.locator("td")).toHaveCount(0);
  });
});
