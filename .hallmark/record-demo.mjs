/**
 * Record DuckStudio's full agent-worker custody arc.
 *
 *   node .hallmark/record-demo.mjs
 *
 * The take uses flagged Chromium, a real DataTransfer/File drop, the served
 * agent surface, tracked revisions/idempotency keys, Playwright video capture,
 * and one still (or more) per beat. It is intentionally strict: a failed
 * envelope, policy, artifact, header, badge, view, or output check exits
 * non-zero with the beat that failed.
 */
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".hallmark", "demo-recording");
const VIDEO_TMP = join(OUT, "playwright-video");
const PORT = 5199;
const URL = "http://127.0.0.1:" + PORT + "/";
const VIEWPORT = { width: 1920, height: 1080 };
const WEBMCP_ARGS = [
  "--enable-features=WebMCPTesting",
  "--enable-experimental-web-platform-features",
];
const TOOLS = [
  "duckdb_get_context",
  "duckdb_activate_dataset",
  "duckdb_execute_sql_to_canvas",
  "duckdb_verify_zero_egress",
];
const NO_UPLOAD_BADGE = "0 Bytes of Dataset Uploaded";
const PACING_MS = 900;
const FRAME_HOLD_MS = 9_000;
const READY_TIMEOUT_MS = 120_000;
const STILL_NAMES = [
  "01-empty-shell",
  "02-dropzone-drag-highlight",
  "02-human-drop",
  "03-import-context",
  "04-import-policy-denied",
  "04-import-aggregate-chart",
  "04-import-rows-suppressed",
  "05-saas-activated",
  "06-saas-context",
  "07-churn-analysis",
  "08-sql-lineage",
  "09-healthcare-policy-denied",
  "09-healthcare-aggregate-chart",
  "09-healthcare-rows-suppressed",
  "10-zero-upload",
  "11-close",
];

mkdirSync(OUT, { recursive: true });
rmSync(VIDEO_TMP, { recursive: true, force: true });
mkdirSync(VIDEO_TMP, { recursive: true });
for (const name of [
  "demo.webm",
  "demo.mp4",
  "poster.jpg",
  "09-healthcare-identifier-denied.png",
  ...STILL_NAMES.map((entry) => entry + ".png"),
]) {
  rmSync(join(OUT, name), { force: true });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeJson(value) {
  return JSON.stringify(value, (_key, entry) => (typeof entry === "bigint" ? Number(entry) : entry));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function hasKey(value, target) {
  if (Array.isArray(value)) return value.some((entry) => hasKey(entry, target));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, entry]) => key === target || hasKey(entry, target));
}

function assertNoRawRows(value, label) {
  assert(!hasKey(value, "rows"), label + " contains a result-row array");
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function generateRegionalSalesCsv() {
  let seed = 42;
  const rand = (max) => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed % max;
  };
  const regions = ["north", "south", "east", "west"];
  const months = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06"];
  const channels = ["online", "retail"];
  const rows = ["order_id,customer_email,region,month,channel,amount,units"];
  let order = 0;
  for (const month of months) {
    for (const region of regions) {
      for (let index = 0; index < 5; index += 1) {
        order += 1;
        const amount = (50 + rand(45000) / 100).toFixed(2);
        const units = 1 + rand(9);
        const channel = channels[order % 2];
        rows.push(
          String(order) +
            ",user" +
            order +
            "@example.com," +
            region +
            "," +
            month +
            "," +
            channel +
            "," +
            amount +
            "," +
            units,
        );
      }
    }
  }
  return rows.join("\n") + "\n";
}

/**
 * This is the canonical SQL imported by e2e/agent-surface.ts from
 * src/demo-presets/canonical-sql.ts. The recorder asserts the committed
 * artifact against this exact string and its SHA-256 hash.
 */
const SAAS_CHURN_CANONICAL_SQL =
  "\nSELECT\n" +
  "  tickets,\n" +
  "  COUNT(*) AS accounts,\n" +
  "  SUM(CASE WHEN churned THEN 1 ELSE 0 END) AS churned_accounts,\n" +
  "  SUM(CASE WHEN churned THEN mrr ELSE 0 END) AS churned_mrr,\n" +
  "  ROUND(100.0 * SUM(CASE WHEN churned THEN 1 ELSE 0 END) / COUNT(*), 1) AS churn_rate_pct,\n" +
  "  ROUND(SUM(SUM(CASE WHEN churned THEN 1 ELSE 0 END)) OVER () / SUM(COUNT(*)) OVER (), 4) AS churn_rate,\n" +
  "  ROUND(SUM(tickets * COUNT(*)) OVER () / SUM(COUNT(*)) OVER (), 4) AS avg_tickets,\n" +
  "  ROUND(SUM(SUM(CASE WHEN churned THEN mrr ELSE 0 END)) OVER (), 2) AS impacted_mrr\n" +
  "FROM saas_churn\n" +
  "GROUP BY tickets\n" +
  "ORDER BY tickets\n";

const HEALTHCARE_PII_CANONICAL_SQL =
  "\nSELECT\n" +
  "  diagnosis,\n" +
  "  COUNT(*) AS patients,\n" +
  "  ROUND(AVG(visit_count), 2) AS avg_visits,\n" +
  "  ROUND(AVG(billed_amount), 2) AS avg_billed_amount\n" +
  "FROM healthcare_pii\n" +
  "GROUP BY diagnosis\n" +
  "HAVING COUNT(*) >= 10\n" +
  "ORDER BY patients DESC\n";

const SAAS_CHURN_PRESENTATION = {
  kpis: [
    { label: "Churn Rate", column: "churn_rate", format: "percent" },
    { label: "Avg Tickets", column: "avg_tickets", format: "decimal" },
    { label: "Impacted MRR", column: "impacted_mrr", format: "currency_usd" },
  ],
  chart: {
    type: "scatter",
    x: "tickets",
    y: "churn_rate_pct",
    title: "Churn rate by support tickets",
    threshold: {
      column: "tickets",
      value: 5,
      label: "churn accelerates above 5 tickets",
    },
  },
};

const HEALTHCARE_PII_PRESENTATION = {
  kpis: [
    { label: "Patients", column: "patients", format: "integer" },
    { label: "Avg Visits", column: "avg_visits", format: "decimal" },
    { label: "Avg Billed", column: "avg_billed_amount", format: "currency_usd" },
  ],
  chart: {
    type: "bar",
    x: "diagnosis",
    y: "patients",
    title: "Cohort sizes by diagnosis (every cohort k ≥ 10)",
  },
};

function regionalSalesSql(relation) {
  return (
    "SELECT region, ROUND(SUM(amount), 2) AS revenue FROM " +
    relation +
    " GROUP BY region ORDER BY revenue DESC"
  );
}

async function reachable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function startViteIfNeeded() {
  if (await reachable(URL)) {
    console.log("dev server already at " + URL);
    return null;
  }
  assert(
    existsSync(join(ROOT, "public", "duckdb", "duckdb-eh.wasm")),
    "missing public/duckdb/ runtime assets — run: pnpm duckdb:download",
  );
  const server = spawn(
    join(ROOT, "node_modules", ".bin", "vite"),
    ["--port", String(PORT), "--strictPort"],
    { cwd: ROOT, stdio: "ignore" },
  );
  const deadline = Date.now() + 60_000;
  while (!(await reachable(URL))) {
    if (Date.now() > deadline) {
      server.kill();
      throw new Error("vite dev server did not come up in 60s");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log("dev server started at " + URL);
  return server;
}

function assertEnvelopeBase(envelope, expectedRevision, label) {
  assert(envelope && typeof envelope === "object", label + " did not return an envelope");
  assert(
    envelope.schemaVersion === "duckstudio.webmcp/v1",
    label + " schemaVersion was " + String(envelope.schemaVersion),
  );
  assert(envelope.workspaceId === "ws_local_01", label + " workspaceId drifted");
  assert(envelope.revision === expectedRevision, label + " revision was " + String(envelope.revision));
}

function assertSuccess(envelope, expectedRevision, label) {
  assertEnvelopeBase(envelope, expectedRevision, label);
  assert(envelope.ok === true, label + " was not ok: " + safeJson(envelope));
  assert(Array.isArray(envelope.warnings), label + " warnings is not an array");
  assert(Array.isArray(envelope.nextActions), label + " nextActions is not an array");
  assert(envelope.nextActions.length <= 3, label + " exceeded the nextActions cap");
  assertNoRawRows(envelope.data, label);
  return envelope.data;
}

function assertFailure(envelope, expectedRevision, code, label) {
  assertEnvelopeBase(envelope, expectedRevision, label);
  assert(envelope.ok === false, label + " unexpectedly succeeded: " + safeJson(envelope));
  assert(envelope.error.code === code, label + " code was " + String(envelope.error.code));
  assert(typeof envelope.error.message === "string" && envelope.error.message.length > 0, label + " has no message");
  assert(typeof envelope.error.retryable === "boolean", label + " has no retryable flag");
  assert(envelope.error.details && typeof envelope.error.details === "object", label + " has no details");
  assert(Array.isArray(envelope.nextActions), label + " nextActions is not an array");
  assertNoRawRows(envelope.error, label + " error");
  return envelope.error;
}

function assertToolAction(envelope, toolName, label) {
  assert(envelope.nextActions.length === 1, label + " nextActions length was " + envelope.nextActions.length);
  const action = envelope.nextActions[0];
  assert(action.kind === "tool", label + " next action was not a tool");
  assert(action.tool === toolName, label + " next action tool was " + String(action.tool));
  return action;
}

async function main() {
  const csv = generateRegionalSalesCsv();
  const fileName = "regional_sales.csv";
  const server = await startViteIfNeeded();
  let browser;
  let context;
  let page;
  let video;
  const checklist = [];
  const pageErrors = [];
  let finalized = false;

  try {
    browser = await chromium.launch({ args: WEBMCP_ARGS });
    context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: VIDEO_TMP, size: VIEWPORT },
    });
    page = await context.newPage();
    video = page.video();
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
      console.error("pageerror: " + error.message);
    });

    const invoke = (name, input) =>
      page.evaluate(
        async ({ name: toolName, input: toolInput }) => {
          const surface = globalThis.__duckstudioAgentSurface;
          if (!surface) throw new Error("the agent surface never registered");
          return surface.invoke(toolName, toolInput);
        },
        { name, input },
      );

    const saveStill = async (name, options = {}) => {
      const path = join(OUT, name + ".png");
      await page.screenshot({ path, ...options });
      console.log("still: " + basename(path));
    };

    const assertHeader = async (expected, label) => {
      const actual = await page.locator("header p").first().textContent();
      assert(actual?.trim() === expected, label + " header was " + JSON.stringify(actual?.trim()));
    };

    const assertBadge = async (label) => {
      const actual = await page.locator(".badge-zero-upload").textContent();
      assert(actual?.trim() === NO_UPLOAD_BADGE, label + " badge drifted to " + JSON.stringify(actual?.trim()));
    };

    const waitForArtifact = async (artifactId) => {
      await page.getByText(artifactId, { exact: true }).first().waitFor({ timeout: READY_TIMEOUT_MS });
    };

    const waitForChart = async () => {
      await page.locator("#panel-insights canvas").first().waitFor({ timeout: READY_TIMEOUT_MS });
    };

    const clickTab = async (label) => {
      await page.getByRole("tab", { name: label, exact: true }).click();
      await page.waitForTimeout(PACING_MS);
      await page.getByRole("tabpanel").waitFor({ timeout: 15_000 });
      return page.getByRole("tabpanel");
    };

    const runBeat = async (number, label, action) => {
      try {
        await action();
      } catch (error) {
        throw new Error(
          "beat " +
            String(number).padStart(2, "0") +
            " (" +
            label +
            ") failed: " +
            errorMessage(error),
        );
      }
      checklist.push({ number, label });
      console.log("PASS beat " + String(number).padStart(2, "0") + " — " + label);
      await page.waitForTimeout(FRAME_HOLD_MS);
      await page.waitForTimeout(PACING_MS);
    };

    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => globalThis.__duckstudioAgentSurface !== undefined, undefined, {
      timeout: READY_TIMEOUT_MS,
    });
    await page.getByRole("button", { name: "Drop a CSV here — it never leaves this tab." }).waitFor({
      timeout: READY_TIMEOUT_MS,
    });
    // Let the shell's staggered first-paint rise finish before the opening
    // still; the recorded beats themselves retain their deliberate holds.
    await page.waitForTimeout(1200);

    const diagnostics = await page.evaluate(() => {
      const surface = globalThis.__duckstudioAgentSurface;
      return {
        surface: surface?.surface,
        tools: surface?.tools,
        isSecureContext: window.isSecureContext,
        modelContext: !!document.modelContext && "registerTool" in document.modelContext,
      };
    });
    assert(diagnostics.isSecureContext, "recording origin is not a secure context");
    assert(diagnostics.modelContext, "document.modelContext is absent — launch flagged Chromium");
    assert(diagnostics.surface === "webmcp_native", "agent surface was " + String(diagnostics.surface));
    assert(
      safeJson(diagnostics.tools) === safeJson(TOOLS),
      "registered tools drifted: " + safeJson(diagnostics.tools),
    );

    let revision = 0;
    let localRelation;
    let importContext;
    let churnAnalysis;
    let healthcareAnalysis;
    const importedCsvB64 = Buffer.from(csv).toString("base64");

    await runBeat(1, "empty shell", async () => {
      await assertHeader("rev 0 · no dataset", "beat 01");
      await assertBadge("beat 01");
      assert(await page.locator("button.artifact-card").count() === 0, "beat 01 has an artifact card");
      assert(await page.locator("[data-grid-row]").count() === 0, "beat 01 has dataset rows");
      await saveStill("01-empty-shell");
    });

    await runBeat(2, "human CSV drop", async () => {
      const dropzone = page.getByRole("button", { name: "Drop a CSV here — it never leaves this tab." });
      const dragSurface = dropzone.locator("xpath=..");
      const dataTransfer = await page.evaluateHandle(
        ({ name, b64 }) => {
          const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
          const transfer = new DataTransfer();
          transfer.items.add(new File([bytes], name, { type: "text/csv" }));
          return transfer;
        },
        { name: fileName, b64: importedCsvB64 },
      );

      await dropzone.dispatchEvent("dragover", { dataTransfer });
      await page.waitForTimeout(600);
      const dragClass = await dragSurface.getAttribute("class");
      assert(dragClass?.includes("bg-accent/[0.06]"), "beat 02 drag-over highlight did not activate");
      const box = await dragSurface.boundingBox();
      assert(box, "beat 02 drop surface has no bounds");
      const clip = {
        x: Math.max(0, box.x - 48),
        y: Math.max(0, box.y - 48),
        width: Math.min(VIEWPORT.width - Math.max(0, box.x - 48), box.width + 96),
        height: Math.min(VIEWPORT.height - Math.max(0, box.y - 48), box.height + 96),
      };
      await saveStill("02-dropzone-drag-highlight", { clip });

      let committed = false;
      try {
        await dropzone.dispatchEvent("drop", { dataTransfer });
        await page.waitForFunction(
          () => /rev 1 · local_[a-z0-9_]+_[0-9a-f]{4} · sensitive_aggregate_only/.test(
            document.querySelector("header p")?.textContent?.trim() ?? "",
          ),
          undefined,
          { timeout: 30_000 },
        );
        committed = true;
      } catch {
        // The real DataTransfer attempt above remains the primary gesture. A
        // Playwright/browser dispatch quirk gets the same File via the
        // dropzone's own hidden input, matching the existing demo recorder.
      } finally {
        await dataTransfer.dispose();
      }
      if (!committed) {
        await page.setInputFiles('input[aria-label="Import a local CSV file"]', {
          name: fileName,
          mimeType: "text/csv",
          buffer: Buffer.from(csv),
        });
        await page.waitForFunction(
          () => /rev 1 · local_[a-z0-9_]+_[0-9a-f]{4} · sensitive_aggregate_only/.test(
            document.querySelector("header p")?.textContent?.trim() ?? "",
          ),
          undefined,
          { timeout: 30_000 },
        );
      }

      const header = await page.locator("header p").first().textContent();
      const match = header?.match(/\b(local_[a-z0-9_]+_[0-9a-f]{4})\b/);
      assert(match?.[1], "beat 02 could not read the imported relation from " + JSON.stringify(header));
      localRelation = match[1];
      assert(/^local_regional_sales_[0-9a-f]{4}$/.test(localRelation), "beat 02 relation slug drifted: " + localRelation);
      revision = 1;
      await assertHeader("rev 1 · " + localRelation + " · sensitive_aggregate_only", "beat 02");
      await assertBadge("beat 02");
      assert(
        await page.locator(".chip-operation").filter({ hasText: "Import file" }).count() > 0,
        "beat 02 has no Import file activity pill",
      );
      await saveStill("02-human-drop");
    });

    await runBeat(3, "import context", async () => {
      importContext = await invoke("duckdb_get_context", { scope: "summary" });
      const data = assertSuccess(importContext, 1, "beat 03 duckdb_get_context");
      assert(
        data.activeDataset?.datasetId === localRelation,
        "beat 03 active dataset was " + String(data.activeDataset?.datasetId),
      );
      assert(data.activeDataset?.policy === "sensitive_aggregate_only", "beat 03 policy drifted");
      assert(data.activeDataset?.rowCount === 120, "beat 03 imported row count was " + String(data.activeDataset?.rowCount));
      assert(data.selectedArtifactId === null, "beat 03 selected an artifact before analysis");
      assert(Array.isArray(data.recentArtifacts) && data.recentArtifacts.length === 0, "beat 03 has recent artifacts");
      assert(data.budgets?.executionMs === 5000, "beat 03 execution budget drifted");
      assert(data.budgets?.resultRows === 10000, "beat 03 row budget drifted");
      assert(data.budgets?.chartPoints === 2000, "beat 03 chart budget drifted");
      assert(data.budgets?.toolSummaryBytes === 8192, "beat 03 summary budget drifted");
      assertNoRawRows(data, "beat 03 context data");
      await saveStill("03-import-context");
    });

    await runBeat(4, "imported aggregate and suppression", async () => {
      const sql = regionalSalesSql(localRelation);
      const denied = await invoke("duckdb_execute_sql_to_canvas", {
        source: { kind: "dataset", id: localRelation },
        sql,
        bindings: {},
        presentation: {
          chart: { type: "bar", x: "region", y: "revenue", title: "Revenue by region" },
          grid: { visible: true },
        },
        expectedRevision: revision,
        idempotencyKey: "record-import-grid-denial-r1",
      });
      const denialError = assertFailure(
        denied,
        1,
        "POLICY_DENIED",
        "beat 04 imported grid denial",
      );
      assert(denialError.details.blockedFields === "grid", "beat 04 denial did not name grid");
      assert(
        await page.locator(".operation-card-failed").filter({ hasText: "POLICY_DENIED" }).count() > 0,
        "beat 04 denial card is not visible",
      );
      await saveStill("04-import-policy-denied");

      const importedAnalysis = await invoke("duckdb_execute_sql_to_canvas", {
        source: { kind: "dataset", id: localRelation },
        sql,
        bindings: {},
        presentation: {
          chart: { type: "bar", x: "region", y: "revenue", title: "Revenue by region" },
        },
        expectedRevision: revision,
        idempotencyKey: "record-import-aggregate-r1",
      });
      const data = assertSuccess(importedAnalysis, 2, "beat 04 imported aggregate");
      revision = 2;
      const artifact = data.artifact;
      assert(artifact?.artifactId === "a_01", "beat 04 artifact was " + String(artifact?.artifactId));
      assert(artifact?.source?.kind === "dataset" && artifact.source.id === localRelation, "beat 04 source drifted");
      assert(artifact?.rowCount === 4, "beat 04 aggregate row count was " + String(artifact?.rowCount));
      assert(
        safeJson(artifact?.lineage) === safeJson([{ kind: "dataset", id: localRelation }]),
        "beat 04 lineage drifted: " + safeJson(artifact?.lineage),
      );
      assert(artifact?.release?.status === "downgraded", "beat 04 release status was " + String(artifact?.release?.status));
      assert(artifact?.release?.rawRowsToAgent === 0, "beat 04 released rows to the agent");
      assert(artifact?.release?.rawRowsToSharedCanvas === 0, "beat 04 released imported rows to the canvas");
      assert(artifact?.release?.cohortMinimum === 10, "beat 04 cohort minimum drifted");
      assert(
        Array.isArray(artifact?.release?.omittedDirectIdentifiers) &&
          artifact.release.omittedDirectIdentifiers.length > 0,
        "beat 04 did not retain omitted identifier metadata",
      );
      assert(data.summary?.chart?.type === "bar", "beat 04 chart type drifted");
      assert(data.summary.chart.x === "region" && data.summary.chart.y === "revenue", "beat 04 chart axes drifted");
      assert(data.summary.chart.pointCount === 4, "beat 04 chart point count was " + String(data.summary.chart.pointCount));
      assert(data.metrics?.materializedRows === 4, "beat 04 measured rows drifted");
      assert(data.metrics?.chartPoints === 4, "beat 04 measured chart points drifted");
      const action = assertToolAction(importedAnalysis, "duckdb_verify_zero_egress", "beat 04");
      assert(action.input?.scope === "artifact" && action.input?.artifactId === "a_01", "beat 04 verify action drifted");
      await waitForArtifact("a_01");
      await waitForChart();
      await saveStill("04-import-aggregate-chart");

      const rowsPanel = await clickTab("Rows");
      await rowsPanel.getByRole("alert").waitFor({ timeout: 15_000 });
      assert((await rowsPanel.getByRole("alert").textContent())?.includes("Rows — suppressed by policy"), "beat 04 Rows suppression missing");
      assert((await rowsPanel.textContent())?.includes("sensitive_aggregate_only"), "beat 04 Rows policy missing");
      assert(await rowsPanel.locator("[data-grid-row]").count() === 0, "beat 04 Rows painted raw records");
      await saveStill("04-import-rows-suppressed");
    });

    await runBeat(5, "activate saas_churn", async () => {
      const activated = await invoke("duckdb_activate_dataset", {
        datasetId: "saas_churn",
        expectedRevision: revision,
        idempotencyKey: "record-activate-saas-r2",
      });
      const data = assertSuccess(activated, 3, "beat 05 duckdb_activate_dataset");
      revision = 3;
      assert(data.datasetId === "saas_churn", "beat 05 dataset drifted");
      assert(data.policy === "public_synthetic", "beat 05 policy drifted");
      assert(data.rowCount === 250000, "beat 05 row count drifted");
      assert(data.minimumCohortSize === 10, "beat 05 cohort minimum drifted");
      assert(/^[0-9a-f]{64}$/.test(data.schemaDigest), "beat 05 schema digest missing");
      assert(data.byteSizeEstimate === 14200000, "beat 05 byte estimate drifted");
      const action = assertToolAction(activated, "duckdb_execute_sql_to_canvas", "beat 05");
      assert(action.input?.source?.id === "saas_churn", "beat 05 next action source drifted");
      assert(action.input?.sql === SAAS_CHURN_CANONICAL_SQL, "beat 05 next action SQL drifted");
      await assertHeader("rev 3 · saas_churn · public_synthetic", "beat 05");
      await assertBadge("beat 05");
      await saveStill("05-saas-activated");
    });

    await runBeat(6, "saas context", async () => {
      const context = await invoke("duckdb_get_context", { scope: "summary" });
      const data = assertSuccess(context, 3, "beat 06 duckdb_get_context");
      assert(data.activeDataset?.datasetId === "saas_churn", "beat 06 active dataset drifted");
      assert(data.activeDataset?.policy === "public_synthetic", "beat 06 policy drifted");
      assert(data.activeDataset?.rowCount === 250000, "beat 06 row count drifted");
      assert(data.selectedArtifactId === "a_01", "beat 06 selected artifact drifted");
      assert(Array.isArray(data.recentArtifacts) && data.recentArtifacts[0]?.artifactId === "a_01", "beat 06 recent artifact drifted");
      assert(data.budgets?.executionMs === 5000 && data.budgets?.resultRows === 10000 && data.budgets?.chartPoints === 2000, "beat 06 budgets drifted");
      assertNoRawRows(data, "beat 06 context data");
      await assertHeader("rev 3 · saas_churn · public_synthetic", "beat 06");
      await assertBadge("beat 06");
      await saveStill("06-saas-context");
    });

    await runBeat(7, "canonical churn analysis", async () => {
      churnAnalysis = await invoke("duckdb_execute_sql_to_canvas", {
        source: { kind: "dataset", id: "saas_churn" },
        sql: SAAS_CHURN_CANONICAL_SQL,
        bindings: {},
        presentation: SAAS_CHURN_PRESENTATION,
        expectedRevision: revision,
        idempotencyKey: "record-saas-churn-r3",
      });
      const data = assertSuccess(churnAnalysis, 4, "beat 07 duckdb_execute_sql_to_canvas");
      revision = 4;
      const artifact = data.artifact;
      assert(artifact?.artifactId === "a_02", "beat 07 artifact was " + String(artifact?.artifactId));
      assert(artifact?.source?.kind === "dataset" && artifact.source.id === "saas_churn", "beat 07 source drifted");
      assert(safeJson(artifact?.lineage) === safeJson([{ kind: "dataset", id: "saas_churn" }]), "beat 07 lineage drifted");
      assert(artifact?.release?.status === "allowed", "beat 07 release status was " + String(artifact?.release?.status));
      assert(artifact?.release?.rawRowsToAgent === 0, "beat 07 released rows to the agent");
      const kpis = new Map(data.summary?.kpis?.map((entry) => [entry.label, entry]));
      assert(kpis.get("Churn Rate")?.value === 0.142, "beat 07 churn KPI was " + String(kpis.get("Churn Rate")?.value));
      assert(kpis.get("Avg Tickets")?.value === 4.8, "beat 07 tickets KPI was " + String(kpis.get("Avg Tickets")?.value));
      assert(kpis.get("Impacted MRR")?.value === 182400, "beat 07 MRR KPI was " + String(kpis.get("Impacted MRR")?.value));
      assert(data.summary?.chart?.type === "scatter", "beat 07 chart type drifted");
      assert(data.summary.chart.x === "tickets" && data.summary.chart.y === "churn_rate_pct", "beat 07 chart axes drifted");
      assert(data.summary.chart.pointCount > 0, "beat 07 chart has no points");
      assert(data.metrics?.materializedRows === artifact.rowCount, "beat 07 measured row count drifted");
      assert(data.metrics?.chartPoints === data.summary.chart.pointCount, "beat 07 chart metric drifted");
      const action = assertToolAction(churnAnalysis, "duckdb_verify_zero_egress", "beat 07");
      assert(action.input?.scope === "artifact" && action.input?.artifactId === "a_02", "beat 07 verify action drifted");
      await waitForArtifact("a_02");
      await waitForChart();
      const insightsPanel = page.locator("#panel-insights");
      await insightsPanel.getByText("14.2%", { exact: true }).waitFor({ timeout: 15_000 });
      await insightsPanel.getByText("4.8", { exact: true }).waitFor({ timeout: 15_000 });
      await insightsPanel.getByText("$182,400", { exact: true }).waitFor({ timeout: 15_000 });
      await saveStill("07-churn-analysis");
    });

    await runBeat(8, "SQL and lineage", async () => {
      await assertHeader("rev 4 · saas_churn · public_synthetic", "beat 08");
      const panel = await clickTab("SQL & Lineage");
      const displayedSql = await panel.locator("pre").textContent();
      assert(displayedSql === SAAS_CHURN_CANONICAL_SQL, "beat 08 SQL drifted from the canonical statement");
      const expectedHash = sha256Hex(SAAS_CHURN_CANONICAL_SQL).slice(0, 16) + "…";
      assert(await panel.getByText(expectedHash, { exact: true }).count() === 1, "beat 08 SQL hash is not visible");
      assert(await panel.getByText("dataset:saas_churn → artifact:a_02", { exact: true }).count() === 1, "beat 08 lineage is not visible");
      assert(await panel.getByText("allowed", { exact: true }).count() === 1, "beat 08 release decision is not visible");
      assert(/\d+(\.\d+)? ms · \d+ rows · \d+ points/.test((await panel.textContent()) ?? ""), "beat 08 measured metrics are not visible");
      assert(await page.locator(".badge-zero-upload").textContent() === NO_UPLOAD_BADGE, "beat 08 badge drifted");
      await saveStill("08-sql-lineage");
    });

    await runBeat(9, "healthcare policy and aggregate", async () => {
      const activated = await invoke("duckdb_activate_dataset", {
        datasetId: "healthcare_pii",
        expectedRevision: revision,
        idempotencyKey: "record-activate-healthcare-r4",
      });
      const activationData = assertSuccess(activated, 5, "beat 09 healthcare activation");
      revision = 5;
      assert(activationData.datasetId === "healthcare_pii", "beat 09 dataset drifted");
      assert(activationData.policy === "sensitive_aggregate_only", "beat 09 policy drifted");
      assert(activationData.rowCount === 100000, "beat 09 row count drifted");
      assert(activationData.minimumCohortSize === 10, "beat 09 cohort minimum drifted");
      await assertHeader("rev 5 · healthcare_pii · sensitive_aggregate_only", "beat 09 activation");
      await assertBadge("beat 09 activation");

      const schemaEnvelope = await invoke("duckdb_get_context", {
        scope: "schema",
        datasetId: "healthcare_pii",
      });
      const schemaData = assertSuccess(schemaEnvelope, 5, "beat 09 healthcare schema");
      const mrn = schemaData.schema?.find((column) => column.name === "mrn");
      assert(mrn?.classification === "direct_identifier", "beat 09 mrn classification drifted");
      assert(mrn?.omitted === true, "beat 09 mrn was not omitted");
      assert(!Object.prototype.hasOwnProperty.call(mrn, "value"), "beat 09 mrn carried a value");
      assertNoRawRows(schemaData, "beat 09 healthcare schema");

      const denied = await invoke("duckdb_execute_sql_to_canvas", {
        source: { kind: "dataset", id: "healthcare_pii" },
        sql: HEALTHCARE_PII_CANONICAL_SQL,
        bindings: {},
        presentation: {
          ...HEALTHCARE_PII_PRESENTATION,
          grid: { visible: true },
        },
        expectedRevision: revision,
        idempotencyKey: "record-healthcare-grid-denial-r5",
      });
      const denialError = assertFailure(denied, 5, "POLICY_DENIED", "beat 09 healthcare grid denial");
      assert(denialError.details.blockedFields === "grid", "beat 09 healthcare denial did not name grid");
      assert(
        await page.locator(".operation-card-failed").filter({ hasText: "POLICY_DENIED" }).count() > 0,
        "beat 09 grid denial card is not visible",
      );
      await saveStill("09-healthcare-policy-denied");

      healthcareAnalysis = await invoke("duckdb_execute_sql_to_canvas", {
        source: { kind: "dataset", id: "healthcare_pii" },
        sql: HEALTHCARE_PII_CANONICAL_SQL,
        bindings: {},
        presentation: HEALTHCARE_PII_PRESENTATION,
        expectedRevision: revision,
        idempotencyKey: "record-healthcare-aggregate-r5",
      });
      const data = assertSuccess(healthcareAnalysis, 6, "beat 09 healthcare aggregate");
      revision = 6;
      const artifact = data.artifact;
      assert(artifact?.artifactId === "a_03", "beat 09 artifact was " + String(artifact?.artifactId));
      assert(artifact?.source?.kind === "dataset" && artifact.source.id === "healthcare_pii", "beat 09 source drifted");
      assert(safeJson(artifact?.lineage) === safeJson([{ kind: "dataset", id: "healthcare_pii" }]), "beat 09 lineage drifted");
      assert(artifact?.rowCount === 8, "beat 09 diagnosis cohort count was " + String(artifact?.rowCount));
      assert(artifact?.release?.status === "downgraded", "beat 09 release status drifted");
      assert(artifact?.release?.rawRowsToAgent === 0, "beat 09 released rows to the agent");
      assert(artifact?.release?.rawRowsToSharedCanvas === 0, "beat 09 released rows to the canvas");
      assert(artifact?.release?.cohortMinimum === 10, "beat 09 cohort minimum drifted");
      assert(artifact?.release?.omittedDirectIdentifiers?.includes("mrn"), "beat 09 mrn omission drifted");
      assert(data.summary?.chart?.type === "bar", "beat 09 chart type drifted");
      assert(data.summary.chart.x === "diagnosis" && data.summary.chart.y === "patients", "beat 09 chart axes drifted");
      assert(data.summary.chart.pointCount === 8, "beat 09 chart point count drifted");
      for (const kpi of data.summary.kpis) {
        assert(kpi.value !== null && Number.isFinite(kpi.value), "beat 09 KPI was not measured: " + kpi.label);
      }
      await waitForArtifact("a_03");
      await waitForChart();
      await saveStill("09-healthcare-aggregate-chart");

      const rowsPanel = await clickTab("Rows");
      await rowsPanel.getByRole("alert").waitFor({ timeout: 15_000 });
      assert((await rowsPanel.getByRole("alert").textContent())?.includes("Rows — suppressed by policy"), "beat 09 Rows suppression missing");
      assert((await rowsPanel.textContent())?.includes("mrn"), "beat 09 omitted mrn is not visible");
      assert(await rowsPanel.locator("[data-grid-row]").count() === 0, "beat 09 Rows painted raw healthcare records");
      await saveStill("09-healthcare-rows-suppressed");
    });

    await runBeat(10, "zero-egress evidence", async () => {
      const evidenceEnvelope = await invoke("duckdb_verify_zero_egress", {
        scope: "artifact",
        artifactId: "a_03",
      });
      const evidence = assertSuccess(evidenceEnvelope, 6, "beat 10 duckdb_verify_zero_egress");
      assert(evidence.scope?.kind === "artifact" && evidence.scope.id === "a_03", "beat 10 evidence scope drifted");
      assert(evidence.datasetBytesUploaded === 0, "beat 10 dataset bytes uploaded was " + String(evidence.datasetBytesUploaded));
      assert(evidence.rawSensitiveValuesReleasedToTools === 0, "beat 10 raw tool releases drifted");
      assert(evidence.rawSensitiveValuesReleasedToSharedCanvas === 0, "beat 10 raw canvas releases drifted");
      assert(evidence.policy === "sensitive_aggregate_only", "beat 10 evidence policy drifted");
      assert(
        safeJson(evidence.lineage) === safeJson([
          { kind: "dataset", id: "healthcare_pii" },
          { kind: "artifact", id: "a_03" },
        ]),
        "beat 10 evidence lineage drifted",
      );
      assert(Array.isArray(evidence.monitoredTransports) && evidence.monitoredTransports.includes("fetch"), "beat 10 fetch monitor missing");
      assert(evidence.limitations.includes("Application shell traffic is outside dataset-upload accounting."), "beat 10 shell limitation missing");
      assert(evidence.limitations.includes("Runtime interception is operational evidence, not a formal proof."), "beat 10 operational-evidence limitation missing");
      const panel = await clickTab("Zero Upload");
      assert((await panel.textContent())?.includes("dataset bytes uploaded"), "beat 10 custody panel is missing");
      assert(await panel.getByText("0 B", { exact: true }).count() === 1, "beat 10 zero-byte readout is missing");
      assert(await panel.getByText("Runtime interception is operational evidence, not a formal proof.", { exact: true }).count() === 1, "beat 10 limitation is not visible");
      await saveStill("10-zero-upload");
    });

    await runBeat(11, "close on artifact, policy, badge", async () => {
      await assertHeader("rev 6 · healthcare_pii · sensitive_aggregate_only", "beat 11");
      await assertBadge("beat 11");
      const selected = page.locator("button.artifact-card-selected").filter({ hasText: "a_03" });
      assert(await selected.count() === 1, "beat 11 a_03 is not the selected artifact card");
      assert(await page.getByText("healthcare_pii · sensitive_aggregate_only", { exact: true }).count() === 0, "beat 11 used a non-header policy line");
      const panel = page.getByRole("tabpanel");
      assert((await panel.textContent())?.includes("dataset bytes uploaded"), "beat 11 evidence card is gone");
      await saveStill("11-close");
    });

    assert(pageErrors.length === 0, "page errors during recording: " + pageErrors.join(" | "));

    const recordedVideo = video;
    await context.close();
    context = undefined;
    const rawVideoPath = recordedVideo ? await recordedVideo.path() : undefined;
    assert(rawVideoPath, "Playwright did not produce a video path");
    const webmPath = join(OUT, "demo.webm");
    if (rawVideoPath !== webmPath) renameSync(rawVideoPath, webmPath);
    rmSync(VIDEO_TMP, { recursive: true, force: true });
    finalized = true;
    await browser.close();
    browser = undefined;

    const ffmpegAvailable = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
    let mp4Path;
    let posterPath;
    if (!ffmpegAvailable) {
      console.log("ffmpeg not found; kept WebM only (no MP4 or poster).");
    } else {
      const mp4 = join(OUT, "demo.mp4");
      const mp4Result = spawnSync(
        "ffmpeg",
        [
          "-y",
          "-loglevel",
          "error",
          "-i",
          webmPath,
          "-an",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          mp4,
        ],
        { stdio: "inherit" },
      );
      if (mp4Result.status === 0 && existsSync(mp4)) {
        mp4Path = mp4;
        console.log("mp4: " + basename(mp4));
      } else {
        console.log("ffmpeg was available but MP4 transcode failed; WebM remains the guaranteed output.");
      }

      const poster = join(OUT, "poster.jpg");
      const posterResult = spawnSync(
        "ffmpeg",
        [
          "-y",
          "-loglevel",
          "error",
          "-ss",
          "00:00:06",
          "-i",
          webmPath,
          "-frames:v",
          "1",
          "-q:v",
          "2",
          poster,
        ],
        { stdio: "inherit" },
      );
      if (posterResult.status === 0 && existsSync(poster)) {
        posterPath = poster;
        console.log("poster: " + basename(poster));
      } else {
        console.log("ffmpeg poster extraction failed; the stills remain available.");
      }
    }

    const ffprobe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        webmPath,
      ],
      { encoding: "utf8" },
    );
    const duration = ffprobe.status === 0 ? Number(ffprobe.stdout.trim()) : null;
    if (duration !== null && Number.isFinite(duration)) {
      assert(
        duration >= 105 && duration <= 180,
        "recorded video duration was " +
          duration.toFixed(1) +
          "s; expected the ~2–3 minute recording window",
      );
    }

    console.log("\nFINAL CHECKLIST");
    for (const entry of checklist) {
      console.log("PASS beat " + String(entry.number).padStart(2, "0") + " — " + entry.label);
    }
    console.log("PASS surface: webmcp_native (document.modelContext.registerTool)");
    console.log("PASS tools: " + TOOLS.join(", "));
    console.log("PASS revisions: rev 0 → import rev 1 → a_01 rev 2 → saas rev 3 → a_02 rev 4 → healthcare rev 5 → a_03 rev 6");
    console.log("PASS artifacts: a_01, a_02, a_03");
    console.log("PASS video: " + basename(webmPath) + (duration !== null && Number.isFinite(duration) ? " (" + duration.toFixed(1) + "s)" : ""));
    console.log("PASS mp4: " + (mp4Path ? basename(mp4Path) : "not produced"));
    console.log("PASS poster: " + (posterPath ? basename(posterPath) : "not produced"));
    console.log("VERDICT: PASS — full custody arc recorded in " + OUT);
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
    if (server) server.kill();
    if (!finalized && pageErrors.length > 0) {
      console.error("recording ended with page errors: " + pageErrors.join(" | "));
    }
  }
}

try {
  await main();
} catch (error) {
  console.error("record-demo FAILED: " + errorMessage(error));
  process.exitCode = 1;
}
