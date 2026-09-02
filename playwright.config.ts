import { defineConfig } from "@playwright/test";

const PORT = 8787;
const LOCAL_BASE_URL = `http://127.0.0.1:${PORT}`;
// Opt-in: point the whole suite at the deployed origin instead of the local
// build (E2E_BASE_URL=https://<deploy>.pages.dev pnpm e2e). The local
// wrangler server — and only it — starts when the suite targets localhost.
const baseURL = process.env.E2E_BASE_URL ?? LOCAL_BASE_URL;

// Command-line form of chrome://flags/#enable-webmcp-testing (CONTRIBUTING.md):
// the e2e browser must be the flagged WebMCP surface the acceptance criteria
// target. Spelling verified against chromium's about_flags.cc registration and
// existing WebMCP Playwright setups; ticket 14's registration E2E is the live
// proof that document.modelContext actually surfaces under it.
const WEBMCP_TESTING_ARGS = [
  "--enable-features=WebMCPTesting",
  "--enable-experimental-web-platform-features",
];

export default defineConfig({
  testDir: "e2e",
  // Serial by design: every test pays a full BOOT_PLAN warm slot (DuckDB WASM
  // compile + both preset materializations, ~350k rows) in its own document.
  // Parallel boots contend for wasm compile/CPU on constrained machines and
  // destabilize warm-up; the app keeps no cross-test state, so nothing is
  // lost by running one page at a time.
  workers: 1,
  fullyParallel: false,
  // Cold boots (fresh server, cold caches) have measured past 25s before the
  // shell renders; 120s leaves headroom for slow machines without masking
  // real hangs.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    launchOptions: { args: WEBMCP_TESTING_ARGS },
  },
  // Serves the shipped origin, not a dev server: `wrangler pages dev` reads
  // public/_headers natively, so the isolation headers asserted in E2E are the
  // exact set the Cloudflare edge applies (ticket 07). Skipped when the suite
  // targets the deployed origin via E2E_BASE_URL.
  ...(baseURL === LOCAL_BASE_URL
    ? {
        webServer: {
          command: `pnpm exec wrangler pages dev dist --port ${PORT}`,
          url: LOCAL_BASE_URL,
          timeout: 120_000,
          reuseExistingServer: !process.env.CI,
          env: { WRANGLER_SEND_METRICS: "false" },
        },
      }
    : {}),
});
