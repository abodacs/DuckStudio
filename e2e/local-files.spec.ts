import { expect, test } from "@playwright/test";
import { agentSurface, assertFailureEnvelope, invokeTool, type EnvelopeSuccess, type SurfaceWindow } from "./agent-surface";
import { NO_UPLOAD_BADGE } from "../src/revisioned-workspace/projection";
import { intakeDigest, importedRelationName } from "../src/revisioned-workspace/intake-tickets";

/**
 * Slice 7: local file drop (tickets 71–76). The dropzone's hidden input is
 * the primary gesture driver — `setInputFiles` where a synthetic drag would
 * be flaky. Import never uploads: every test re-asserts the truthful badge
 * alongside the committed import.
 */

// Cohorts must clear the imported dataset's minimum cohort size of 10 so the
// canonical aggregate releases: east ×12, west ×11.
const IMPORT_ROWS = [
  ...Array.from({ length: 12 }, (_, index) => `${index + 1},east,10.5`),
  ...Array.from({ length: 11 }, (_, index) => `${index + 13},west,20`),
];
const IMPORT_CSV = ["patient_id,region,amount", ...IMPORT_ROWS, ""].join("\n");

const FILE_NAME = "my_sales.csv";
/** The deterministic relation the store derives from the file name + digest. */
const IMPORT_RELATION = importedRelationName(FILE_NAME, intakeDigest(FILE_NAME, new TextEncoder().encode(IMPORT_CSV)));

async function dropCsv(page: import("@playwright/test").Page, name: string, csv: string): Promise<void> {
  await page.setInputFiles('input[aria-label="Import a local CSV file"]', {
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
}

test.describe("slice 7: local file import", () => {
  test("a dropped CSV becomes the active dataset and takes a bounded analysis", async ({ page }) => {
    await agentSurface(page);
    await expect(page.getByText("rev 0 · no dataset")).toBeVisible();

    await dropCsv(page, FILE_NAME, IMPORT_CSV);

    // The header commits the import: the local relation is the dataset line,
    // and the badge stays truthful — import, never upload.
    await expect(page.getByText(`rev 1 · ${IMPORT_RELATION} · sensitive_aggregate_only`)).toBeVisible();
    await expect(page.getByText(NO_UPLOAD_BADGE)).toBeVisible();
    // The import pill carries the human label; the command id rides the tooltip.
    await expect(page.locator(".chip-operation").filter({ hasText: "Import file" })).toBeVisible();

    // One bounded analysis against the imported relation, through the same
    // agent surface as any preset analysis (drop-vs-preset parity).
    const analysis = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: IMPORT_RELATION },
      sql: `SELECT region, COUNT(*) AS n FROM ${IMPORT_RELATION} GROUP BY region ORDER BY n DESC`,
      bindings: {},
      expectedRevision: 1,
      idempotencyKey: "e2e-import-analysis-01",
    })) as EnvelopeSuccess;
    expect(analysis.ok).toBe(true);
    expect(analysis.revision).toBe(2);
    const artifact = (analysis.data as { artifact: { artifactId: string; lineage: { kind: string; id: string }[] } }).artifact;
    expect(artifact.artifactId).toBe("a_01");
    expect(artifact.lineage).toEqual([{ kind: "dataset", id: IMPORT_RELATION }]);

    // Zero-egress lineage names the local relation with zero bytes — and the
    // evidence snapshot names the artifact after its ancestors (§8.4).
    const evidence = (await invokeTool(page, "duckdb_verify_zero_egress", {
      scope: "artifact",
      artifactId: "a_01",
    })) as EnvelopeSuccess;
    expect(evidence.ok).toBe(true);
    expect(
      (evidence.data as { datasetBytesUploaded: number; lineage: { kind: string; id: string }[] }),
    ).toMatchObject({
      datasetBytesUploaded: 0,
      lineage: [
        { kind: "dataset", id: IMPORT_RELATION },
        { kind: "artifact", id: "a_01" },
      ],
    });

    // The artifact card shows the same commit in the left pane.
    await expect(page.getByText("a_01", { exact: true })).toBeVisible();
  });

  test("the four-tool surface is unchanged — importLocalFile stays human-only", async ({ page }) => {
    await agentSurface(page);
    const surface = await page.evaluate(
      () => (window as SurfaceWindow).__duckstudioAgentSurface as { tools: string[] },
    );
    expect(surface.tools).toEqual([
      "duckdb_get_context",
      "duckdb_activate_dataset",
      "duckdb_execute_sql_to_canvas",
      "duckdb_verify_zero_egress",
    ]);
    expect(surface.tools).not.toContain("importLocalFile");
  });

  test("a non-CSV drop earns a human sentence beside the code, and commits nothing", async ({ page }) => {
    await agentSurface(page);
    await dropCsv(page, "notes.txt", "hello, this is not a csv\n");

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("VALIDATION_ERROR");
    await expect(alert).toContainText("isn't a CSV");
    // Nothing committed: the workspace stays at rev 0 with no dataset, and
    // the badge never moved.
    await expect(page.getByText("rev 0 · no dataset")).toBeVisible();
    await expect(page.getByText(NO_UPLOAD_BADGE)).toBeVisible();
  });

  test("digest identity end to end: the same file rebuilds the same relation, different content a different one", async ({
    page,
  }) => {
    await agentSurface(page);
    await dropCsv(page, FILE_NAME, IMPORT_CSV);
    await expect(page.getByText(`rev 1 · ${IMPORT_RELATION} · sensitive_aggregate_only`)).toBeVisible();

    // A different file behind the same stem derives a different digest, so
    // the slug collision resolves to a distinct relation.
    const otherCsv = IMPORT_CSV.replace("east", "west");
    const otherRelation = importedRelationName(FILE_NAME, intakeDigest(FILE_NAME, new TextEncoder().encode(otherCsv)));
    expect(otherRelation).not.toBe(IMPORT_RELATION);
    await dropCsv(page, FILE_NAME, otherCsv);
    await expect(page.getByText(`rev 2 · ${otherRelation} · sensitive_aggregate_only`)).toBeVisible();

    // Re-importing the first file rebuilds its relation in place (CREATE OR
    // REPLACE) — digest equality, observable in the header.
    await dropCsv(page, FILE_NAME, IMPORT_CSV);
    await expect(page.getByText(`rev 3 · ${IMPORT_RELATION} · sensitive_aggregate_only`)).toBeVisible();
  });

  test("analysis before any import is refused with the real local-file next action", async ({ page }) => {
    await agentSurface(page);
    const denied = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "saas_churn" },
      sql: "SELECT COUNT(*) AS n FROM saas_churn",
      bindings: {},
      expectedRevision: 0,
      idempotencyKey: "e2e-import-refused-01",
    })) as EnvelopeFailure;
    assertFailureEnvelope(denied);
    expect(denied.error.code).toBe("DATASET_UNAVAILABLE");
    // The human action is real: the dropzone on this very page performs it.
    expect(denied.nextActions).toContainEqual({ kind: "human_action", action: "select_local_file" });
    await expect(page.getByRole("button", { name: "Drop a CSV here — it never leaves this tab." })).toBeVisible();
  });

  test("imported direct identifiers reach metadata, never the relation — the mute test holds", async ({ page }) => {
    await agentSurface(page);
    await dropCsv(page, FILE_NAME, IMPORT_CSV);
    await expect(page.getByText(`rev 1 · ${IMPORT_RELATION} · sensitive_aggregate_only`)).toBeVisible();

    // The schema digest discloses the omission instead of the values.
    const schema = (await invokeTool(page, "duckdb_get_context", {
      scope: "schema",
      datasetId: IMPORT_RELATION,
    })) as EnvelopeSuccess;
    expect(schema.ok).toBe(true);
    const columns = (schema.data as { schema: { name: string; classification: string; omitted?: boolean }[] }).schema;
    expect(columns.find((column) => column.name === "patient_id")).toMatchObject({
      classification: "direct_identifier",
      omitted: true,
    });

    // The default policy suppresses the grid: an aggregate releases, and the
    // suppression panel explains instead of painting rows.
    const analysis = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: IMPORT_RELATION },
      sql: `SELECT region, COUNT(*) AS n FROM ${IMPORT_RELATION} GROUP BY region`,
      bindings: {},
      expectedRevision: 1,
      idempotencyKey: "e2e-import-mute-01",
    })) as EnvelopeSuccess;
    expect(analysis.ok).toBe(true);
    const released = (analysis.data as { artifact: { schema: { name: string }[] } }).artifact;
    expect(released.schema.some((column) => column.name === "patient_id")).toBe(false);

    await page.getByRole("tab", { name: "Rows" }).click();
    await expect(page.getByRole("alert")).toContainText("Rows — suppressed by policy");
    await expect(page.locator("[data-grid-row]")).toHaveCount(0);
    await expect(page.getByText(NO_UPLOAD_BADGE)).toBeVisible();
  });
});
