import { expect, test } from "@playwright/test";
import { formatKpiValue } from "../src/live-canvas/kpi";
import {
  agentSurface,
  CHURN_ACTIVATE,
  churnAnalysis,
  invokeTool,
  waitForSurface,
  type EnvelopeFailure,
  type EnvelopeSuccess,
} from "./agent-surface";

// --- QA spec: the analysis lifecycle an agent actually drives
// (agent-system-design.md §15 scenarios 2, 3, 10, 14, 15). Happy paths with
// teeth: the two-call analysis, refinement through artifact lineage, budget
// enforcement with no partial commits, one projection everywhere, and
// re-registration that never duplicates. ---

test.describe("qa: analysis lifecycle", () => {
  test("scenario 2: two calls go from empty workspace to selected artifact with inferred presentation", async ({
    page,
  }) => {
    await agentSurface(page);
    const activated = (await invokeTool(page, "duckdb_activate_dataset", CHURN_ACTIVATE)) as EnvelopeSuccess;
    expect(activated.ok).toBe(true);
    expect(activated.revision).toBe(1);
    expect(activated.nextActions).toHaveLength(1);
    expect(activated.nextActions[0]).toMatchObject({ kind: "tool", tool: "duckdb_execute_sql_to_canvas" });

    // Presentation omitted on purpose: inference is part of the contract.
    const analysis = (await invokeTool(page, "duckdb_execute_sql_to_canvas", churnAnalysis(1, "qa-lowcall-01"))) as EnvelopeSuccess;
    expect(analysis.ok).toBe(true);
    expect(analysis.revision).toBe(2);
    const data = analysis.data as {
      operationId: string;
      artifact: { artifactId: string; source: { kind: string; id: string }; rowCount: number; lineage: { kind: string; id: string }[] };
      summary: {
        kpis: { label: string; column: string; format: string; value: number | null }[];
        chart?: { type: string; x: string; y: string; pointCount: number };
      };
      metrics: { executionMs: number; materializedRows: number };
    };
    expect(data.artifact.artifactId).toBe("a_01");
    expect(data.artifact.source).toEqual({ kind: "dataset", id: "saas_churn" });
    expect(data.artifact.lineage).toEqual([{ kind: "dataset", id: "saas_churn" }]);
    expect(data.metrics.executionMs).toBeLessThanOrEqual(5000);

    // Inference, not echo: KPIs ride every numeric result column in result
    // order, the chart scatters the first two — nothing we supplied.
    const kpiColumns = data.summary.kpis.map((kpi) => kpi.column);
    expect(kpiColumns).toEqual([
      "tickets",
      "accounts",
      "churned_accounts",
      "churned_mrr",
      "churn_rate_pct",
      "churn_rate",
    ]);
    expect(data.summary.chart).toMatchObject({ type: "scatter", x: "tickets", y: "accounts" });
    expect(data.summary.chart?.pointCount).toBeGreaterThan(0);

    // The custody story closes: the mutation suggests verifying its artifact.
    expect(analysis.nextActions).toHaveLength(1);
    expect(analysis.nextActions[0]).toMatchObject({
      kind: "tool",
      tool: "duckdb_verify_zero_egress",
      input: { scope: "artifact", artifactId: "a_01" },
    });

    // The human header and artifact stream show the same two commits.
    await expect(page.getByText("rev 2 · saas_churn · public_synthetic")).toBeVisible();
    await expect(page.getByText("a_01", { exact: true })).toBeVisible();
  });

  test("scenario 3: refinement sources the prior artifact and extends its lineage", async ({ page }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", CHURN_ACTIVATE);
    const first = (await invokeTool(page, "duckdb_execute_sql_to_canvas", churnAnalysis(1, "qa-refine-01"))) as EnvelopeSuccess;
    expect(first.ok).toBe(true);
    const firstData = first.data as { artifact: { artifactId: string; relationName: string } };

    // The refinement reads the prior artifact's generated relation — the
    // source query never recomputes.
    const refined = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "artifact", id: firstData.artifact.artifactId },
      sql: `SELECT SUM(churned_accounts) AS total_churned FROM ${firstData.artifact.relationName}`,
      bindings: {},
      expectedRevision: 2,
      idempotencyKey: "qa-refine-02",
    })) as EnvelopeSuccess;
    expect(refined.ok).toBe(true);
    expect(refined.revision).toBe(3);
    const refinedData = refined.data as {
      artifact: { artifactId: string; source: { kind: string; id: string }; lineage: { kind: string; id: string }[] };
    };
    expect(refinedData.artifact.artifactId).toBe("a_02");
    expect(refinedData.artifact.source).toEqual({ kind: "artifact", id: "a_01" });
    expect(refinedData.artifact.lineage).toEqual([
      { kind: "dataset", id: "saas_churn" },
      { kind: "artifact", id: "a_01" },
    ]);

    // The lineage view renders the exact chain, dataset first, never self.
    await page.getByRole("tab", { name: "SQL & Lineage" }).click();
    await expect(page.getByRole("tabpanel")).toContainText(
      "dataset:saas_churn → artifact:a_01",
    );
  });

  test("scenario 10: an over-budget execution denies with no partial artifact", async ({ page }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", CHURN_ACTIVATE);

    // A 62.5-billion-row cross join against a 100 ms deadline: the engine
    // deadline fires long before any result could materialize.
    const denied = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "saas_churn" },
      sql: "SELECT COUNT(*) AS n FROM saas_churn a, saas_churn b",
      bindings: {},
      budget: { executionMs: 100, resultRows: 10, chartPoints: 10 },
      expectedRevision: 1,
      idempotencyKey: "qa-budget-01",
    })) as EnvelopeFailure;
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe("BUDGET_EXCEEDED");
    expect(denied.error.retryable).toBe(true);
    expect(denied.error.details.axis).toBe("executionMs");
    expect(Number(denied.error.details.limit)).toBe(100);

    // No partial commit: revision and canvas are untouched.
    await expect(page.getByText("rev 1 · saas_churn · public_synthetic")).toBeVisible();
    await expect(page.getByText("No results yet. Run an analysis and it appears here.")).toBeVisible();
  });

  test("scenario 15: the envelope summary, the artifact card, and Insights render one object", async ({
    page,
  }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", CHURN_ACTIVATE);
    const analysis = (await invokeTool(page, "duckdb_execute_sql_to_canvas", churnAnalysis(1, "qa-projection-01"))) as EnvelopeSuccess;
    expect(analysis.ok).toBe(true);
    const summary = (analysis.data as {
      summary: { kpis: { label: string; value: number | null; format: "percent" | "decimal" | "currency_usd" | "integer" }[] };
    }).summary;
    expect(summary.kpis.length).toBeGreaterThan(0);

    // The right pane's Insights tiles carry the same label→value pairs the
    // envelope measured at commit — one object, rendered through the pinned
    // format table (§15.15).
    await page.getByRole("tab", { name: "Charts" }).click();
    const panel = page.getByRole("tabpanel");
    const rendered = await panel.evaluate((panelElement) => {
      const pairs = new Map<string, string>();
      for (const tile of panelElement.querySelectorAll(".ghost-tile")) {
        const spans = tile.querySelectorAll<HTMLElement>(":scope > span");
        if (spans.length < 2) continue;
        const label = spans[0]?.textContent?.trim();
        const value = spans[1]?.textContent?.trim();
        if (label && value) pairs.set(label, value);
      }
      return Object.fromEntries(pairs);
    });
    for (const kpi of summary.kpis) {
      expect(
        rendered[kpi.label],
        `KPI ${kpi.label} should render its measured value`,
      ).toBe(formatKpiValue(kpi.value, kpi.format));
    }
    await expect(page.getByText("a_01", { exact: true })).toBeVisible();
  });

  test("scenario 14: a fresh document re-registers exactly the served tools, never duplicated", async ({
    page,
  }) => {
    const surface = await agentSurface(page);
    expect(surface.tools).toEqual([
      "duckdb_get_context",
      "duckdb_activate_dataset",
      "duckdb_execute_sql_to_canvas",
      "duckdb_verify_zero_egress",
    ]);

    // A reload rebuilds the document from scratch; registration must land on
    // the same four tools with exactly one surface capability.
    await page.reload();
    await waitForSurface(page);
    const reloaded = (await page.evaluate(
      () => (window as { __duckstudioAgentSurface?: { tools: string[] } }).__duckstudioAgentSurface,
    )) as { tools: string[] };
    expect(reloaded.tools).toEqual(surface.tools);

    const envelope = (await invokeTool(page, "duckdb_get_context", { scope: "summary" })) as EnvelopeSuccess;
    expect(envelope.ok).toBe(true);
    const capabilities = (envelope.data as { capabilities: string[] }).capabilities;
    expect(capabilities.filter((c) => c === "webmcp_native" || c === "simulator_only")).toHaveLength(1);
  });
});
