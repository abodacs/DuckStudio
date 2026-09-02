import { expect, test } from "@playwright/test";
import { HEALTHCARE_PII_CANONICAL_SQL } from "../src/demo-presets/canonical-sql";

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

// --- Slice 4: the agent control plane in the live page (the registration
// e2e ticket 14 planned, widened per the slice-4 build tickets). The page
// exposes the served tool surface after boot (`registration.ts` picks native
// WebMCP under the flagged e2e browser, otherwise the simulator); these
// tests drive exactly what a browser agent would drive, one test per
// capability. ---

/** The served tool surface the page exposes once boot reaches "register". */
type AgentSurface = {
  surface: "webmcp_native" | "simulator_only";
  tools: string[];
  invoke(name: string, input: unknown): Promise<unknown>;
};

type SurfaceWindow = { __duckstudioAgentSurface?: AgentSurface };

async function agentSurface(page: import("@playwright/test").Page): Promise<AgentSurface> {
  await page.goto("/");
  await page.waitForFunction(() => (window as SurfaceWindow).__duckstudioAgentSurface !== undefined, undefined, {
    timeout: 30_000,
  });
  return page.evaluate(() => (window as SurfaceWindow).__duckstudioAgentSurface as AgentSurface);
}

function invokeTool(page: import("@playwright/test").Page, name: string, input: unknown): Promise<unknown> {
  return page.evaluate(
    ({ name, input }) => {
      const surface = (window as SurfaceWindow).__duckstudioAgentSurface;
      if (!surface) throw new Error("the agent surface never registered");
      return surface.invoke(name, input);
    },
    { name, input },
  );
}

const CHURN_SQL =
  "SELECT tickets, COUNT(*) AS accounts FROM saas_churn GROUP BY tickets ORDER BY tickets";

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
      sql: CHURN_SQL,
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
      sql: CHURN_SQL,
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
    expect(envelope.data.monitoredTransports).toEqual([
      "fetch",
      "XMLHttpRequest",
      "sendBeacon",
      "WebSocket",
      "WebTransport",
    ]);
    expect(envelope.data.lineage).toEqual([
      { kind: "dataset", id: "saas_churn" },
      { kind: "artifact", id: "a_01" },
    ]);
    expect(envelope.data.limitations).toHaveLength(2);
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
  sql: string = CHURN_SQL,
  datasetId: "saas_churn" | "healthcare_pii" = "saas_churn",
): Promise<{ artifactId: string }> {
  await page.waitForFunction(() => (window as SurfaceWindow).__duckstudioAgentSurface !== undefined, undefined, {
    timeout: 30_000,
  });
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
    await expect(page.getByText("Application shell traffic is outside dataset-upload accounting.")).toBeVisible();
  });

  test("the public grid paints bounded virtualized rows only after the artifact", async ({ page }) => {
    await page.goto("/");
    await activateAndRun(page, { activate: "e2e-grid-activate-01", run: "e2e-grid-run-01" });
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

    // Transform-only scroll: a real deep wheel jump repaints the window,
    // still bounded.
    const center = await viewport.boundingBox();
    await page.mouse.move(center!.x + center!.width / 2, center!.y + center!.height / 2);
    await page.mouse.wheel(0, 32 * 5000);
    await expect.poll(async () => page.locator("[data-grid-row]").count()).toBeLessThanOrEqual(bound);
    await expect
      .poll(async () => page.locator("[data-grid-window]").evaluate((element) => element.style.transform))
      .toContain("translateY(159");
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
    await expect(page.getByRole("alert")).toContainText("Data Grid — suppressed by policy");
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
    await expect(page.getByText("0 Bytes of Dataset Uploaded")).toBeVisible();
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

// --- Slice 6: the judge path. The same domain commands are one click away:
// preset cards, canonical-run chips, and the verify chip drive the identical
// dispatch seam a browser agent drives — no typing, no terminal, no wait. ---

test.describe("slice 6: judge-path 1-click journey", () => {
  test("a preset card activates locally and the header commits the policy", async ({ page }) => {
    await page.goto("/");
    // The agent channel names the served surface — never a pending "connecting".
    await expect(
      page.getByText("Agent Simulator Ready (Full Parity)").or(page.getByText("WebMCP Native Connected")),
    ).toBeVisible();
    await page
      .getByRole("group", { name: "Dataset presets" })
      .getByRole("button", { name: /saas_churn/ })
      .click();
    await expect(page.getByText("ws_local_01 · rev 1 · saas_churn · public_synthetic")).toBeVisible();
    await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();
    await expect(page.getByText("0 Bytes of Dataset Uploaded")).toBeVisible();
  });

  test("the churn chip runs one canonical artifact with headline KPIs and the scatter", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Run SaaS Churn Analysis/ }).click();

    // One operation, one artifact — activation and analysis chained.
    await expect(page.getByText("a_01", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("ws_local_01 · rev 2 · saas_churn · public_synthetic")).toBeVisible();

    // Headline KPIs measured from the canonical SQL's first row — the same
    // object renders in the artifact card and the Insights tiles, so scope
    // to the first.
    await expect(page.getByText("Churn Rate", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("14.2%", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("$182,400", { exact: true }).first()).toBeVisible();

    // The chart paints, and the runtime line is measured — never a promised
    // fixed query time (prd.md §8).
    await expect(page.getByRole("region", { name: "Chart" }).locator("canvas")).toBeVisible();
    await expect(page.getByText(/measured/, { exact: false })).toBeVisible();
  });

  test("the healthcare chip runs the safe aggregate and the grid suppresses rows", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Run Healthcare Aggregate/ }).click();
    await expect(page.getByText("a_01", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("ws_local_01 · rev 2 · healthcare_pii · sensitive_aggregate_only")).toBeVisible();

    await page.getByRole("tab", { name: "Data Grid" }).click();
    await expect(page.getByRole("alert")).toContainText("Data Grid — suppressed by policy");
    await expect(page.getByRole("alert")).toContainText("mrn");
    await expect(page.locator("[data-grid-row]")).toHaveCount(0);
  });

  test("the verify chip lands the canvas on Custody with zero-upload evidence", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Run SaaS Churn Analysis/ }).click();
    await expect(page.getByText("a_01", { exact: true })).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: /Verify Zero Egress/ }).click();
    await expect(page.getByRole("tab", { name: "Custody" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/scope artifact:a_01/)).toBeVisible();
    await expect(page.getByText("0 B", { exact: true })).toBeVisible();
    await expect(page.getByText("Runtime interception is operational evidence, not a formal proof.")).toBeVisible();
  });
});
