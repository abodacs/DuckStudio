import { expect, test } from "@playwright/test";

// Pinned empty-state copy per tab (ticket 06 — copy is decided, not invented;
// the Insights line was re-voiced by the 2026-09-02 layout/UX pass review).
const EMPTY_STATE_COPY: readonly (readonly [label: string, copy: string])[] = [
  ["Insights", "No artifact — KPIs render only from a policy-approved artifact."],
  ["Data Grid", "No artifact — the grid paints rows only from an approved artifact."],
  ["SQL & Lineage", "No artifact — lineage appears with your first analysis."],
  ["Custody", "No custody evidence yet — verification runs on artifacts."],
];

test.describe("walking skeleton @ rev 0", () => {
  test("the document response carries the isolation headers", async ({ request }) => {
    const response = await request.get("/");
    expect(response.ok()).toBe(true);
    expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");
    expect(response.headers()["cross-origin-embedder-policy"]).toBe("require-corp");
    expect(response.headers()["cross-origin-resource-policy"]).toBe("same-origin");
  });

  test("the origin is cross-origin isolated", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
  });

  test("the shell renders at rev 0", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("ws_local_01 · rev 0 · no dataset")).toBeVisible();
    // The seeded catalog's canonical spelling in the header (ticket 13) —
    // available to activate, never shown as active.
    await expect(page.getByText("saas_churn · public_synthetic", { exact: true })).toBeVisible();
    await expect(page.getByText("0 Bytes of Dataset Uploaded")).toBeVisible();
    await expect(page.getByText("AGENT CONTROL & OPERATIONS")).toBeVisible();
    await expect(page.getByText("SELECTED ARTIFACT")).toBeVisible();
  });

  test("every evidence tab discloses its empty state", async ({ page }) => {
    await page.goto("/");
    for (const [label, copy] of EMPTY_STATE_COPY) {
      await page.getByRole("tab", { name: label }).click();
      await expect(page.getByRole("tabpanel")).toContainText(copy);
    }
  });

  test("junk search params surface as a route error, not a stripped param", async ({ page }) => {
    await page.goto("/?artifact=a_01");
    await expect(page.getByText("ws_local_01 · rev 0 · no dataset")).not.toBeVisible();
  });
});
