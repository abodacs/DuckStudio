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
