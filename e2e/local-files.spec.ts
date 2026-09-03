import { expect, test } from "@playwright/test";
import { agentSurface, invokeTool, type EnvelopeSuccess, type SurfaceWindow } from "./agent-surface";
import { NO_UPLOAD_BADGE } from "../src/revisioned-workspace/projection";
import { intakeDigest, importedRelationName } from "../src/revisioned-workspace/intake-tickets";

/**
 * Slice 7: local file drop (tickets 71–76). The dropzone's hidden input is
 * the primary gesture driver — `setInputFiles` where a synthetic drag would
 * be flaky. Import never uploads: every test re-asserts the truthful badge
 * alongside the committed import.
 */

const IMPORT_CSV = [
  "patient_id,region,amount",
  "1,east,10.5",
  "2,west,20.0",
  "3,east,30.25",
  "4,north,5.0",
  "",
].join("\n");

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
    await expect(page.getByText("ws_local_01 · rev 0 · no dataset")).toBeVisible();

    await dropCsv(page, FILE_NAME, IMPORT_CSV);

    // The header commits the import: the local relation is the dataset line,
    // and the badge stays truthful — import, never upload.
    await expect(page.getByText(`ws_local_01 · rev 1 · ${IMPORT_RELATION} · sensitive_aggregate_only`)).toBeVisible();
    await expect(page.getByText(NO_UPLOAD_BADGE)).toBeVisible();
    // The import pill carries the human command label, never a tool name.
    await expect(page.locator(".chip-operation").filter({ hasText: "importLocalFile" })).toBeVisible();

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

    // Zero-egress lineage names the local relation with zero bytes.
    const evidence = (await invokeTool(page, "duckdb_verify_zero_egress", {
      scope: "artifact",
      artifactId: "a_01",
    })) as EnvelopeSuccess;
    expect(evidence.ok).toBe(true);
    expect(
      (evidence.data as { datasetBytesUploaded: number; lineage: { kind: string; id: string }[] }),
    ).toMatchObject({ datasetBytesUploaded: 0, lineage: [{ kind: "dataset", id: IMPORT_RELATION }] });

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
    await expect(page.getByText("ws_local_01 · rev 0 · no dataset")).toBeVisible();
    await expect(page.getByText(NO_UPLOAD_BADGE)).toBeVisible();
  });

  test("imported direct identifiers reach metadata, never the relation — the mute test holds", async ({ page }) => {
    await agentSurface(page);
    await dropCsv(page, FILE_NAME, IMPORT_CSV);
    await expect(page.getByText(`ws_local_01 · rev 1 · ${IMPORT_RELATION} · sensitive_aggregate_only`)).toBeVisible();

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

    await page.getByRole("tab", { name: "Data Grid" }).click();
    await expect(page.getByRole("alert")).toContainText("Rows — suppressed by policy");
    await expect(page.locator("[data-grid-row]")).toHaveCount(0);
    await expect(page.getByText(NO_UPLOAD_BADGE)).toBeVisible();
  });
});
