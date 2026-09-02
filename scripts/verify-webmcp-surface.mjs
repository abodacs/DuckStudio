// Standing check for the served WebMCP surface on a deployed origin: the
// flagged-Chromium facts of e2e/qa-deployed-origin.spec.ts plus the one pin no
// spec makes — that the surface is webmcp_native, not the simulator fallback
// (specs accept either). Exits non-zero unless document.modelContext serves
// exactly the four canonical tools and duckdb_get_context answers a success
// envelope on the live origin.
//
// Usage: pnpm verify:webmcp [https://origin] (default: the production origin).
import { chromium } from "@playwright/test";

const target = process.argv[2] ?? "https://duckstudio.pages.dev/";
const fail = (message) => {
  console.error("FAIL " + message);
  process.exit(1);
};
// Canonical names, exact (CONTEXT.md: no aliases, ever —
// src/agent-control-plane/registration.ts is the source of this list).
const CANONICAL_TOOLS = [
  "duckdb_get_context",
  "duckdb_activate_dataset",
  "duckdb_execute_sql_to_canvas",
  "duckdb_verify_zero_egress",
];

const browser = await chromium.launch({
  args: ["--enable-features=WebMCPTesting", "--enable-experimental-web-platform-features"],
});
try {
  const page = await browser.newPage();
  await page.goto(target, { timeout: 60000 });
  // Cold boots (wasm compile + preset materialization) measured past 25s;
  // 120s absorbs the worst observed start, same as e2e/agent-surface.ts.
  await page.waitForFunction(() => globalThis.__duckstudioAgentSurface !== undefined, undefined, {
    timeout: 120_000,
  });
  const diag = await page.evaluate(() => {
    const surface = globalThis.__duckstudioAgentSurface;
    return {
      surface: surface?.surface,
      tools: surface?.tools,
      modelContext: !!document.modelContext && "registerTool" in document.modelContext,
      isSecureContext: window.isSecureContext,
      crossOriginIsolated: window.crossOriginIsolated,
    };
  });
  if (!diag.isSecureContext || !diag.crossOriginIsolated) {
    fail(`${target} is not a cross-origin-isolated secure context: ${JSON.stringify(diag)}`);
  }
  if (!diag.modelContext) {
    fail("document.modelContext is absent — the WebMCP flag is not in effect in this browser");
  }
  if (diag.surface !== "webmcp_native") {
    fail(`surface is "${diag.surface}", expected "webmcp_native"`);
  }
  if (JSON.stringify(diag.tools) !== JSON.stringify(CANONICAL_TOOLS)) {
    fail(`tool surface ${JSON.stringify(diag.tools)} !== ${JSON.stringify(CANONICAL_TOOLS)}`);
  }

  const context = await page.evaluate(() =>
    globalThis.__duckstudioAgentSurface.invoke("duckdb_get_context", { scope: "summary" }),
  );
  if (context?.ok !== true || context.schemaVersion !== "duckstudio.webmcp/v1") {
    fail(`duckdb_get_context did not answer a success envelope: ${JSON.stringify(context)?.slice(0, 300)}`);
  }
  // Workspace scope is honest before any dataset is active (§15 scenario 12),
  // so this read must succeed on a fresh document.
  const custody = await page.evaluate(() =>
    globalThis.__duckstudioAgentSurface.invoke("duckdb_verify_zero_egress", { scope: "workspace" }),
  );
  if (custody?.ok !== true || custody.schemaVersion !== "duckstudio.webmcp/v1") {
    fail(`duckdb_verify_zero_egress did not answer a success envelope: ${JSON.stringify(custody)?.slice(0, 300)}`);
  }

  console.log(`PASS ${target}`);
  console.log("  surface: webmcp_native (document.modelContext.registerTool)");
  console.log(`  tools:   ${diag.tools.join(", ")}`);
  console.log(`  reads:   duckdb_get_context ok (rev ${context.revision}); duckdb_verify_zero_egress ok`);
  console.log(`  browser: chromium ${browser.version()} with --enable-features=WebMCPTesting`);
} catch (error) {
  fail(`${target} — ${String(error?.message ?? error).split("\n")[0]}`);
} finally {
  await browser.close();
}
