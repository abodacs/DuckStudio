import { expect, test } from "@playwright/test";
import { agentSurface, invokeTool, waitForSurface, type AgentSurface, type SurfaceWindow } from "./agent-surface";
import { HEALTHCARE_PII_CANONICAL_SQL, SAAS_CHURN_CANONICAL_SQL } from "../src/demo-presets/canonical-sql";
import { NO_UPLOAD_BADGE } from "../src/revisioned-workspace/projection";
import { EVIDENCE_LIMITATIONS, MONITORED_TRANSPORTS } from "../src/dataset-custody/schemas";
import { INSIGHTS_EMPTY_STATE } from "../src/live-canvas/insights-view";
import { GRID_EMPTY_STATE } from "../src/live-canvas/data-grid-view";
import { LINEAGE_EMPTY_STATE } from "../src/live-canvas/sql-lineage-view";
import { CUSTODY_EMPTY_STATE } from "../src/live-canvas/custody-view";

// Pinned empty-state copy per tab (ticket 06; stage-2 made it actionable) —
// the lines the views render at rev 0, imported from them so the browser
// proof is the assertion, not the typing.
const EMPTY_STATE_COPY: readonly (readonly [label: string, copy: string])[] = [
  ["Insights", INSIGHTS_EMPTY_STATE.noDataset],
  ["Data Grid", GRID_EMPTY_STATE],
  ["SQL & Lineage", LINEAGE_EMPTY_STATE],
  ["Custody", CUSTODY_EMPTY_STATE],
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
    await expect(page.getByText(NO_UPLOAD_BADGE)).toBeVisible();
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

// --- Slice 4: the agent control plane in the live page (the registration
// e2e ticket 14 planned, widened per the slice-4 build tickets). The page
// exposes the served tool surface after boot (`registration.ts` picks native
// WebMCP under the flagged e2e browser, otherwise the simulator); these
// tests drive exactly what a browser agent would drive, one test per
// capability. ---

test.describe("slice 4: agent control plane", () => {
  test("duckdb_get_context returns the compact summary an agent bootstraps from", async ({ page }) => {
    await agentSurface(page);
    const envelope = (await invokeTool(page, "duckdb_get_context", { scope: "summary" })) as {
      ok: boolean;
      revision: number;
      data: { capabilities: string[]; budgets: Record<string, number> };
      warnings: unknown[];
      nextActions: unknown[];
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.revision).toBe(0);
    expect(envelope.data.budgets.toolSummaryBytes).toBe(8192);
    expect(envelope.warnings).toEqual([]);
    expect(envelope.nextActions).toEqual([]);
  });

  test("duckdb_activate_dataset activates a preset and the human header shows the same commit", async ({ page }) => {
    await agentSurface(page);
    const envelope = (await invokeTool(page, "duckdb_activate_dataset", {
      datasetId: "saas_churn",
      expectedRevision: 0,
      idempotencyKey: "e2e-activate-01",
    })) as {
      ok: boolean;
      revision: number;
      data: { datasetId: string; policy: string; rowCount: number };
      contextDelta?: Record<string, unknown>;
      nextActions: { kind: string; tool?: string }[];
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.revision).toBe(1);
    expect(envelope.data).toMatchObject({ datasetId: "saas_churn", policy: "public_synthetic", rowCount: 250000 });
    // The custody story starts: the mutation suggests its forward action.
    expect(envelope.nextActions).toHaveLength(1);
    expect(envelope.nextActions[0]).toMatchObject({ kind: "tool", tool: "duckdb_execute_sql_to_canvas" });
    // Operator parity: the human header reads the same committed workspace.
    await expect(page.getByText("rev 1", { exact: true })).toBeVisible();
    await expect(page.getByText("ws_local_01 · rev 1 · saas_churn · public_synthetic")).toBeVisible();
  });

  test("duckdb_execute_sql_to_canvas creates and selects an artifact atomically", async ({ page }) => {
    await agentSurface(page);
    const activated = (await invokeTool(page, "duckdb_activate_dataset", {
      datasetId: "saas_churn",
      expectedRevision: 0,
      idempotencyKey: "e2e-sql-activate-01",
    })) as { ok: boolean };
    expect(activated.ok).toBe(true);

    const envelope = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "saas_churn" },
      sql: SAAS_CHURN_CANONICAL_SQL,
      bindings: {},
      expectedRevision: 1,
      idempotencyKey: "e2e-sql-01",
    })) as {
      ok: boolean;
      revision: number;
      data: {
        artifact: { artifactId: string; release: { rawRowsToAgent: number } };
        summary: { kpis: unknown[]; chart?: { pointCount: number } };
        metrics: { materializedRows: number };
      };
      nextActions: { kind: string; tool?: string }[];
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.revision).toBe(2);
    expect(envelope.data.artifact.artifactId).toBe("a_01");
    expect(envelope.data.artifact.release.rawRowsToAgent).toBe(0);
    expect(envelope.data.summary.kpis.length).toBeGreaterThan(0);
    // The custody story completes: the artifact suggests its verification.
    expect(envelope.nextActions).toHaveLength(1);
    expect(envelope.nextActions[0]).toMatchObject({ kind: "tool", tool: "duckdb_verify_zero_egress" });
    // The left pane's artifact stream shows the same commit.
    await expect(page.getByText("a_01", { exact: true })).toBeVisible();
  });

  test("duckdb_verify_zero_egress returns honest scoped evidence with limitations", async ({ page }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", {
      datasetId: "saas_churn",
      expectedRevision: 0,
      idempotencyKey: "e2e-verify-activate-01",
    });
    await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "saas_churn" },
      sql: SAAS_CHURN_CANONICAL_SQL,
      bindings: {},
      expectedRevision: 1,
      idempotencyKey: "e2e-verify-sql-01",
    });

    const envelope = (await invokeTool(page, "duckdb_verify_zero_egress", {
      scope: "artifact",
      artifactId: "a_01",
    })) as {
      ok: boolean;
      data: {
        scope: { kind: string; id: string };
        datasetBytesUploaded: number;
        monitoredTransports: string[];
        lineage: { kind: string; id: string }[];
        limitations: string[];
      };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.scope).toEqual({ kind: "artifact", id: "a_01" });
    expect(envelope.data.datasetBytesUploaded).toBe(0);
    expect(envelope.data.monitoredTransports).toEqual([...MONITORED_TRANSPORTS]);
    expect(envelope.data.lineage).toEqual([
      { kind: "dataset", id: "saas_churn" },
      { kind: "artifact", id: "a_01" },
    ]);
    expect(envelope.data.limitations).toHaveLength(EVIDENCE_LIMITATIONS.length);
  });

  test("capability negotiation appends exactly one surface enum at boot", async ({ page }) => {
    await agentSurface(page);
    const envelope = (await invokeTool(page, "duckdb_get_context", { scope: "summary" })) as {
      ok: boolean;
      data: { capabilities: string[] };
    };
    expect(envelope.ok).toBe(true);
    const capabilities = envelope.data.capabilities;
    for (const base of [
      "activate_local_preset",
      "run_readonly_sql",
      "present_artifact",
      "verify_custody",
      "cancel_active_operation",
      "select_artifact",
    ]) {
      expect(capabilities).toContain(base);
    }
    // Exactly one surface capability, appended once (grilling 41: fixed at boot).
    expect(capabilities.filter((c) => c === "webmcp_native" || c === "simulator_only")).toHaveLength(1);
  });

  test("human-only commands are never on the tool surface", async ({ page }) => {
    await agentSurface(page);
    const surface = await page.evaluate(
      () => (window as SurfaceWindow).__duckstudioAgentSurface as AgentSurface,
    );
    expect(surface.tools).toEqual([
      "duckdb_get_context",
      "duckdb_activate_dataset",
      "duckdb_execute_sql_to_canvas",
      "duckdb_verify_zero_egress",
    ]);
    expect(surface.tools).not.toContain("selectArtifact");
    expect(surface.tools).not.toContain("cancelActiveOperation");
  });
});

// --- Slice 5: the evidence canvas (build tickets 55/56). The same served
// tool surface commits real analyses; the two-pane chrome must paint the
// committed projection and nothing else — one test per user-visible
// behavior, with the custody story legible on a muted screen. ---

async function activateAndRun(
  page: import("@playwright/test").Page,
  keys: { activate: string; run: string },
  sql: string = SAAS_CHURN_CANONICAL_SQL,
  datasetId: "saas_churn" | "healthcare_pii" = "saas_churn",
): Promise<{ artifactId: string }> {
  await waitForSurface(page);
  const activated = (await invokeTool(page, "duckdb_activate_dataset", {
    datasetId,
    expectedRevision: 0,
    idempotencyKey: keys.activate,
  })) as { ok: boolean };
  expect(activated.ok).toBe(true);
  const envelope = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
    source: { kind: "dataset", id: datasetId },
    sql,
    bindings: {},
    expectedRevision: 1,
    idempotencyKey: keys.run,
  })) as {
    ok: boolean;
    data: { artifact: { artifactId: string } };
    error?: { code: string; message: string };
  };
  expect(envelope.ok, `analysis failed: ${JSON.stringify(envelope.error ?? null)}`).toBe(true);
  return envelope.data.artifact;
}

test.describe("slice 5: evidence canvas", () => {
  test("the committed artifact paints Insights, SQL & Lineage, and Custody", async ({ page }) => {
    await page.goto("/");
    await activateAndRun(page, { activate: "e2e-canvas-activate-01", run: "e2e-canvas-run-01" });

    // The left pane carries the same commit: artifact card with source and policy.
    await expect(page.getByRole("button", { name: /a_01/ })).toBeVisible();
    await expect(page.getByText("source saas_churn", { exact: false })).toBeVisible();

    // Insights: measured KPI cards + the lazy chart's canvas.
    await expect(page.getByRole("tabpanel").getByText("accounts", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Chart" }).locator("canvas")).toBeVisible();

    // SQL & Lineage: exact statement, hash, chain, release decision.
    await page.getByRole("tab", { name: "SQL & Lineage" }).click();
    await expect(page.getByText(/GROUP BY tickets/)).toBeVisible();
    await expect(page.getByText(/dataset:saas_churn → artifact:a_01/)).toBeVisible();
    await expect(page.getByRole("tabpanel").getByText("allowed", { exact: true })).toBeVisible();

    // Custody: the captured §8.4 snapshot with its limitations.
    await page.getByRole("tab", { name: "Custody" }).click();
    await expect(page.getByText(/scope artifact:a_01/)).toBeVisible();
    await expect(page.getByText("0 B", { exact: true })).toBeVisible();
    await expect(page.getByText(EVIDENCE_LIMITATIONS[0])).toBeVisible();
  });

  test("the public grid paints bounded virtualized rows only after the artifact", async ({ page }) => {
    await page.goto("/");
    // A 2,000-row artifact gives the virtual window real depth to scroll.
    await activateAndRun(
      page,
      { activate: "e2e-grid-activate-01", run: "e2e-grid-run-01" },
      "SELECT * FROM saas_churn LIMIT 2000",
    );
    await page.getByRole("tab", { name: "Data Grid" }).click();

    // Acceptance 17 in reverse: rows exist — but only from the artifact.
    await expect(page.locator("[data-grid-row]").first()).toBeVisible();

    // The virtualization bar: DOM rows ≤ viewport rows + 2×overscan.
    const viewport = page.locator("[data-grid-viewport]");
    const box = await viewport.boundingBox();
    expect(box).not.toBeNull();
    const bound = Math.ceil(box!.height / 32) + 2 * 8;
    const painted = await page.locator("[data-grid-row]").count();
    expect(painted).toBeLessThanOrEqual(bound);

    // Transform-only scroll: a deep jump repaints the window, still bounded —
    // the scroll position leaves the top and the painted count holds.
    await viewport.evaluate((element) => {
      element.scrollTop = 32 * 5000;
    });
    await expect.poll(async () => page.locator("[data-grid-row]").count()).toBeLessThanOrEqual(bound);
    await expect
      .poll(async () => page.locator("[data-grid-window]").evaluate((element) => element.style.transform))
      .not.toContain("translateY(0px)");
  });

  test("the healthcare grid refuses to paint rows — the mute test", async ({ page }) => {
    await page.goto("/");
    await activateAndRun(
      page,
      { activate: "e2e-mute-activate-01", run: "e2e-mute-run-01" },
      HEALTHCARE_PII_CANONICAL_SQL,
      "healthcare_pii",
    );
    await page.getByRole("tab", { name: "Data Grid" }).click();

    // The pinned suppression banner, with the identifier line and counters
    // rendered from the projection's release/custody data.
    await expect(page.getByRole("alert")).toContainText("Rows — suppressed by policy");
    await expect(page.getByRole("alert")).toContainText("mrn");
    await expect(page.getByText("Uploaded to network:", { exact: false })).toBeVisible();
    await expect(page.getByText("0 B", { exact: true })).toBeVisible();
    await expect(page.getByText("Raw values released:", { exact: false })).toBeVisible();

    // Zero raw records anywhere in the shared DOM; the released aggregates
    // and column metadata render instead.
    await expect(page.locator("[data-grid-row]")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Released aggregates" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Column metadata" })).toBeVisible();

    // The custody story on a muted screen: handle + policy label + badge.
    await expect(page.getByText("a_01", { exact: true })).toBeVisible();
    await expect(page.getByText("sensitive_aggregate_only", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(NO_UPLOAD_BADGE)).toBeVisible();
  });

  test("artifact selection dispatches once and tab clicks never dispatch", async ({ page }) => {
    await page.goto("/");
    const { artifactId } = await activateAndRun(page, {
      activate: "e2e-select-activate-01",
      run: "e2e-select-run-01",
    });
    expect(artifactId).toBe("a_01");
    const revision = page.getByText("rev 2", { exact: true });

    // Tabs are canvas-local: four clicks, zero dispatches, revision unmoved.
    for (const label of ["Data Grid", "SQL & Lineage", "Custody", "Insights"]) {
      await page.getByRole("tab", { name: label }).click();
      await expect(revision).toBeVisible();
    }

    // One card click = one selectArtifact dispatch: rev 2 → rev 3, exactly.
    await page.getByRole("button", { name: /a_01/ }).click();
    await expect(page.getByText("rev 3", { exact: true })).toBeVisible();
    for (const label of ["Data Grid", "Custody"]) {
      await page.getByRole("tab", { name: label }).click();
      await expect(page.getByText("rev 3", { exact: true })).toBeVisible();
    }
  });
});

// --- Slice 6: demo proof (tickets 63/64, grilling 61's resolution). Preset
// cards and the one canonical prompt chip dispatch the exact domain commands
// an agent dispatches through the store seam — the envelope teaches recovery,
// and simulator mode drives the same commands to the same projections. ---

/** The canonical prompt chip: the tape's exact prompt (video-script beat 3). */
const CHIP_LABEL = "Analyze churn against support tickets.";
const ACTIVATE_CHURN = "Activate dataset saas_churn · public_synthetic policy";
const ACTIVATE_HEALTH = "Activate dataset healthcare_pii · sensitive_aggregate_only policy";

test.describe("slice 6: demo wiring and parity", () => {
  test("a preset card dispatches one activation; the header commits and the grid stays empty", async ({ page }) => {
    await agentSurface(page);
    // The capability chip names the served surface from first paint (§7.3).
    await expect(
      page.getByText("webmcp_native", { exact: true }).or(page.getByText("simulator_only · same workspace", { exact: true })),
    ).toBeVisible();

    // The card's pinned aria label comes from catalog metadata (grilling 61).
    await page.getByRole("button", { name: ACTIVATE_CHURN }).click();
    await expect(page.getByText("ws_local_01 · rev 1 · saas_churn · public_synthetic")).toBeVisible();
    await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();
    await expect(page.getByText(NO_UPLOAD_BADGE)).toBeVisible();

    // Acceptance 17: activation paints no rows — the honest empty state.
    await page.getByRole("tab", { name: "Data Grid" }).click();
    await expect(page.getByText(GRID_EMPTY_STATE)).toBeVisible();
    await expect(page.locator("[data-grid-row]")).toHaveCount(0);
  });

  test("the canonical prompt chip runs the two-call playbook to one artifact with headline KPIs", async ({ page }) => {
    await agentSurface(page);
    await page.getByRole("button", { name: ACTIVATE_CHURN }).click();
    await expect(page.getByText("rev 1", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: CHIP_LABEL }).click();

    // The analysis pill is the operation stream's evidence (the chip's read
    // pulses no chrome, §3.2); the two-call sequence itself is pinned by the
    // canvas contract test.
    await expect(
      page.locator(".chip-operation").filter({ hasText: "duckdb_execute_sql_to_canvas" }).first(),
    ).toBeVisible();
    await expect(page.getByText("a_01", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("ws_local_01 · rev 2 · saas_churn · public_synthetic")).toBeVisible();

    // Headline KPIs measured from the canonical SQL's first row (prd.md §6.1).
    await expect(page.getByText("Churn Rate", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("14.2%", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Avg Tickets", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("4.8", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Impacted MRR", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("$182,400", { exact: true }).first()).toBeVisible();

    // The chart paints, and the runtime line is measured — never a promised
    // fixed query time (prd.md §8).
    await expect(page.getByRole("region", { name: "Chart" }).locator("canvas")).toBeVisible();
    await expect(page.locator("[data-velocity]")).toContainText("measured");
  });

  test("a preset click while an operation runs earns the OPERATION_CONFLICT recovery card", async ({ page }) => {
    await agentSurface(page);
    await page.getByRole("button", { name: ACTIVATE_CHURN }).click();
    await expect(page.getByText("rev 1", { exact: true })).toBeVisible();

    // A five-second default budget holds the operation slot open long enough
    // to make the collision deterministic — the canonical analysis can
    // settle faster than a click on a fast runner. The served surface (the
    // same seam the chip dispatches through) starts the hold.
    await page.evaluate(() => {
      const surface = (window as SurfaceWindow).__duckstudioAgentSurface;
      if (!surface) throw new Error("the agent surface never registered");
      void surface.invoke("duckdb_execute_sql_to_canvas", {
        source: { kind: "dataset", id: "saas_churn" },
        sql: "SELECT COUNT(*) AS n FROM saas_churn a, saas_churn b",
        bindings: {},
        expectedRevision: 1,
        idempotencyKey: "e2e-conflict-hold-01",
      });
    });
    // The card never disables (grilling 61): while the analysis runs, the
    // second dispatch happens and the envelope teaches recovery.
    await expect(page.locator(".chip-operation.op-running").first()).toBeVisible();
    await page.getByRole("button", { name: ACTIVATE_HEALTH }).click();

    await expect(page.getByText("OPERATION_CONFLICT", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Another operation is running; wait for it or cancel it.")).toBeVisible();
    // The card is transient by design — it lives only while the colliding
    // operation does — so the recovery move's exact copy is pinned by the
    // canvas contract test rather than raced here.

    // The conflict committed nothing: the workspace stays at rev 1 with churn
    // active even after the held operation pays its budget denial.
    await expect(page.getByText("ws_local_01 · rev 1 · saas_churn · public_synthetic")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("rev 2", { exact: true })).not.toBeVisible();
  });

  test("simulator mode drives the same commands to the same revisions and KPIs", async ({ page }) => {
    // Native registration absent → the simulator serves the identical surface
    // (§14): same dispatches, same artifacts, same revisions, same DOM.
    await page.addInitScript(() => {
      Object.defineProperty(document, "modelContext", { value: undefined, configurable: true });
    });
    await agentSurface(page);
    await expect(page.getByText("simulator_only · same workspace", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: ACTIVATE_CHURN }).click();
    await expect(page.getByText("ws_local_01 · rev 1 · saas_churn · public_synthetic")).toBeVisible();
    await page.getByRole("button", { name: CHIP_LABEL }).click();
    await expect(page.getByText("a_01", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("ws_local_01 · rev 2 · saas_churn · public_synthetic")).toBeVisible();
    await expect(page.getByText("14.2%", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("$182,400", { exact: true }).first()).toBeVisible();

    // The served surface really is the simulator's.
    const surface = await page.evaluate(
      () => (window as { __duckstudioAgentSurface?: { surface: string } }).__duckstudioAgentSurface,
    );
    expect(surface?.surface).toBe("simulator_only");
  });

  test("no third-party requests on the tool path; the origin stays cross-origin isolated", async ({ page, baseURL }) => {
    const crossOrigin: string[] = [];
    page.on("request", (request) => {
      if (baseURL && request.url().startsWith(baseURL)) return;
      crossOrigin.push(request.url());
    });
    await agentSurface(page);
    await expect(page.getByText("ws_local_01 · rev 0 · no dataset")).toBeVisible();
    expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);

    // The full tool path — activation through the two-call chip — stays
    // same-origin: fonts, wasm, and workers included.
    await page.getByRole("button", { name: ACTIVATE_CHURN }).click();
    await page.getByRole("button", { name: CHIP_LABEL }).click();
    await expect(page.getByText("a_01", { exact: true })).toBeVisible({ timeout: 60_000 });
    expect(crossOrigin).toEqual([]);
  });

  test("the served origin applies the isolation headers to / and a font asset", async ({ request }) => {
    for (const path of ["/", "/fonts/geist-latin-var.woff2"]) {
      const response = await request.get(path);
      expect(response.ok(), `${path} should serve`).toBe(true);
      expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");
      expect(response.headers()["cross-origin-embedder-policy"]).toBe("require-corp");
      expect(response.headers()["cross-origin-resource-policy"]).toBe("same-origin");
    }
  });
});
