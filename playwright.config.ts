import { defineConfig } from "@playwright/test";

const PORT = 8787;
const baseURL = `http://127.0.0.1:${PORT}`;

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
  // Every page load pays the wasm warm slot; more than a handful of
  // concurrent warm-ups thrash the box and turn boot into a flake.
  workers: 2,
  // Every page load pays the BOOT_PLAN warm slot (DuckDB WASM compile +
  // preset materialization) before the shell can render, so assertions race
  // engine warm-up, not app defects. 30s matches the suite's explicit
  // worker/surface waits; the test timeout leaves room for multi-assertion
  // cold starts.
  timeout: 60_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    launchOptions: { args: WEBMCP_TESTING_ARGS },
  },
  // Serves the shipped origin, not a dev server: `wrangler pages dev` reads
  // public/_headers natively, so the isolation headers asserted in E2E are the
  // exact set the Cloudflare edge applies (ticket 07).
  webServer: {
    command: `pnpm exec wrangler pages dev dist --port ${PORT}`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { WRANGLER_SEND_METRICS: "false" },
  },
});
