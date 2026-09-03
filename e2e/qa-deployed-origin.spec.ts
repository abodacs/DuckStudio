import { expect, test } from "@playwright/test";
import { agentSurface, invokeTool, type EnvelopeSuccess } from "./agent-surface";
import { NO_UPLOAD_BADGE } from "../src/revisioned-workspace/projection";

// --- Opt-in smoke for the deployed origin (PRD slice 6: deployed-origin
// verification). Runs only when the suite points at it:
//   E2E_BASE_URL=https://<deploy>.pages.dev pnpm e2e
// The local run asserts the same origin facts against the wrangler-served
// build, so these are the edge-facing double-check, not new coverage. ---

test.skip(!process.env.E2E_BASE_URL, "set E2E_BASE_URL to smoke the deployed origin");

test.describe("qa: deployed origin smoke", () => {
  test("the edge applies the isolation headers", async ({ request }) => {
    const response = await request.get("/");
    expect(response.ok()).toBe(true);
    expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");
    expect(response.headers()["cross-origin-embedder-policy"]).toBe("require-corp");
    expect(response.headers()["cross-origin-resource-policy"]).toBe("same-origin");
  });

  test("the deployed origin is cross-origin isolated and serves the shell at rev 0", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
    await expect(page.getByText("rev 0 · no dataset")).toBeVisible();
    await expect(page.getByText(NO_UPLOAD_BADGE)).toBeVisible();
  });

  test("the served agent surface registers and answers a read on the deployed origin", async ({ page }) => {
    await agentSurface(page);
    const envelope = (await invokeTool(page, "duckdb_get_context", { scope: "summary" })) as EnvelopeSuccess;
    expect(envelope.ok).toBe(true);
    expect(envelope.schemaVersion).toBe("duckstudio.webmcp/v1");
    expect(envelope.revision).toBe(0);
  });
});
