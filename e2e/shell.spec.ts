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
    // `rev` and `artifact` gained slice-3 readers; a param nobody reads is
    // still junk and must surface, never be stripped silently.
    await page.goto("/?view=insights");
    await expect(page.getByText("ws_local_01 · rev 0 · no dataset")).not.toBeVisible();
  });

  test("a rev pin matching the live workspace renders; a stale pin is stripped", async ({ page }) => {
    await page.goto("/?rev=0");
    await expect(page.getByText("ws_local_01 · rev 0 · no dataset")).toBeVisible();

    // The pin names revision 9; the workspace lives at rev 0 — beforeLoad
    // rejects the stale pin and lands on the live workspace (ticket 35).
    await page.goto("/?rev=9");
    await expect(page.getByText("ws_local_01 · rev 0 · no dataset")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("rev")).toBeNull();
  });
});

test.describe("slice 2: engine warm + zero egress from first paint", () => {
  test("the shell mounts only after the engine worker has warmed at boot", async ({ page }) => {
    const engineWorker = page.waitForEvent("worker", {
      predicate: (worker) => worker.url().includes("duckdb.worker"),
      timeout: 30_000,
    }).catch(() => null);
    await page.goto("/");
    await expect(page.getByText("ws_local_01 · rev 0 · no dataset")).toBeVisible();
    // The header renders after the warm step (BOOT_PLAN: gate → warm →
    // mount), so a warmed engine worker must exist by now.
    expect(await engineWorker).toBeTruthy();
    await expect(
      page
        .workers()
        .some((worker) => worker.url().includes("duckdb.worker")),
      "the engine worker is alive after warm-up",
    ).toBe(true);
  });

  test("the self-hosted DuckDB runtime is served same-origin", async ({ request }) => {
    for (const asset of ["/duckdb/duckdb-eh.wasm", "/duckdb/duckdb-browser-eh.worker.js"]) {
      const response = await request.get(asset);
      expect(response.ok()).toBe(true);
    }
  });

  test("every network request from first paint through warm-up is same-origin", async ({ page, baseURL }) => {
    const crossOrigin: string[] = [];
    page.on("request", (request) => {
      if (baseURL && request.url().startsWith(baseURL)) return;
      crossOrigin.push(request.url());
    });
    await page.goto("/");
    await expect(page.getByText("ws_local_01 · rev 0 · no dataset")).toBeVisible();
    // The header renders only after the worker warm slot, so the engine has
    // fully initialized (both presets materialized) with zero cross-origin
    // requests observed from the page.
    expect(
      page
        .workers()
        .some((worker) => worker.url().includes("duckdb.worker")),
    ).toBe(true);
    expect(crossOrigin).toEqual([]);
  });
});
