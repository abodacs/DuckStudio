import { expect, test } from "@playwright/test";
import { agentSurface, invokeTool, type EnvelopeSuccess } from "./agent-surface";
import { HEALTHCARE_PII_CANONICAL_SQL, SAAS_CHURN_CANONICAL_SQL } from "../src/demo-presets/canonical-sql";
import { sha256Hex } from "../src/analysis-artifacts/sql-hash";
import { NO_UPLOAD_BADGE } from "../src/revisioned-workspace/projection";

/**
 * Stage 4: the SQL workbench — the human's own SQL entry. The paths pin the
 * locked UX: type in the editor, Cmd/Ctrl+Enter runs the one bounded
 * statement through the same domain command an agent dispatches; a grid
 * request that crosses policy is *denied* with the one-click safe
 * presentation; the same SQL re-run lands a second artifact with the same
 * hash; and the badge never moves.
 */

const ACTIVATE_CHURN = "Activate dataset saas_churn · public_synthetic policy";
const ACTIVATE_HEALTH = "Activate dataset healthcare_pii · sensitive_aggregate_only policy";

async function typeSql(page: import("@playwright/test").Page, sql: string): Promise<void> {
  await page.locator(".wb-editor .cm-content").click();
  await page.keyboard.type(sql);
}

test.describe("stage 4: SQL workbench", () => {
  test("Cmd/Ctrl+Enter runs the statement to one artifact and a bounded grid", async ({ page }) => {
    await agentSurface(page);
    await page.getByRole("button", { name: ACTIVATE_CHURN }).click();
    await expect(page.getByText("rev 1", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "Query" }).click();
    await typeSql(page, SAAS_CHURN_CANONICAL_SQL);
    await page.keyboard.press("Control+Enter");

    // One atomic commit: artifact, revision bump, and the headline KPIs.
    await expect(page.getByText("a_01", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("rev 2 · saas_churn · public_synthetic")).toBeVisible();
    await expect(page.getByText(NO_UPLOAD_BADGE)).toBeVisible();
    // The workbench infers KPI labels from column names (no canonical
    // presentation is supplied), so the chip reads the column, not the demo label.
    await expect(page.getByText("churn_rate").first()).toBeVisible();
    // The results pane inherits the grid: bounded rows on public data.
    await expect(page.locator("[data-grid-row]").first()).toBeVisible();
  });

  test("a grid request on the sensitive dataset is denied, then one click applies the safe presentation", async ({
    page,
  }) => {
    await agentSurface(page);
    await page.getByRole("button", { name: ACTIVATE_HEALTH }).click();
    await expect(page.getByText("rev 1 · healthcare_pii · sensitive_aggregate_only")).toBeVisible();

    await page.getByRole("tab", { name: "Query" }).click();
    await typeSql(page, HEALTHCARE_PII_CANONICAL_SQL);
    // Show rows is on by default — the request goes out as picked and the
    // workspace denies it (deny over strip, §4.5).
    await page.getByRole("button", { name: /Run analysis/ }).click();
    const strip = page.getByRole("alert").filter({ hasText: "POLICY_DENIED" });
    await expect(strip).toBeVisible();
    await expect(page.getByText("No results yet. Run an analysis and it appears here.")).toBeVisible();

    // One click adopts the permitted presentation; the run commits.
    await page.getByRole("button", { name: "Apply safe presentation" }).click();
    await page.getByRole("button", { name: /Run analysis/ }).click();
    await expect(page.getByText("a_01", { exact: true })).toBeVisible({ timeout: 60_000 });

    // The sensitive artifact never paints rows — the mute test, inherited.
    await page.getByRole("tab", { name: "Rows" }).click();
    await expect(page.getByRole("alert")).toContainText("Rows — suppressed by policy");
    await expect(page.locator("[data-grid-row]")).toHaveCount(0);
    await expect(page.getByText(NO_UPLOAD_BADGE)).toBeVisible();
  });

  test("the same SQL re-run lands a second artifact with the same hash", async ({ page }) => {
    await agentSurface(page);
    await page.getByRole("button", { name: ACTIVATE_CHURN }).click();
    await expect(page.getByText("rev 1", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "Query" }).click();
    await typeSql(page, SAAS_CHURN_CANONICAL_SQL);
    await page.keyboard.press("Control+Enter");
    await expect(page.getByText("a_01", { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press("Control+Enter");
    await expect(page.getByText("a_02", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("rev 3 · saas_churn · public_synthetic")).toBeVisible();

    // The SQL & Lineage view pins the hash of the exact statement.
    await page.getByRole("tab", { name: "SQL & Lineage" }).click();
    await expect(page.getByText(`${sha256Hex(SAAS_CHURN_CANONICAL_SQL).slice(0, 16)}…`)).toBeVisible();

    const readback = (await invokeTool(page, "duckdb_get_context", {
      scope: "artifact",
      artifactId: "a_02",
    })) as EnvelopeSuccess;
    expect(readback.ok).toBe(true);
  });
});
