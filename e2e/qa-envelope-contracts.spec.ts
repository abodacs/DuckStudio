import { expect, test } from "@playwright/test";
import {
  agentSurface,
  CHURN_ACTIVATE,
  churnAnalysis,
  collectKeys,
  invokeTool,
  stableJson,
  type EnvelopeFailure,
  type EnvelopeSuccess,
} from "./agent-surface";

// --- QA spec: the envelope contract an agent codes against
// (agent-system-design.md §15 scenarios 1, 4, 8, 9; §9 recovery). Failure
// envelopes are first-class QA surface: every denial must carry a stable
// code, honest retryability, useful details, and — where the taxonomy
// promises it — an executable recovery action. ---

test.describe("qa: envelope contracts", () => {
  test("scenario 1: one summary read is actionable and under the toolSummaryBytes budget", async ({
    page,
  }) => {
    await agentSurface(page);
    const envelope = (await invokeTool(page, "duckdb_get_context", { scope: "summary" })) as EnvelopeSuccess;
    expect(envelope.ok).toBe(true);

    // The whole read rides inside the §4.6 response budget, serialized.
    const serialized = stableJson(envelope);
    expect(serialized.length).toBeLessThanOrEqual(8192);

    // The one read carries everything an agent bootstraps from: budgets,
    // capabilities, dataset state, artifact handles — with nothing stale.
    const data = envelope.data as {
      capabilities: string[];
      activeDataset: unknown;
      budgets: Record<string, number>;
      selectedArtifactId: string | null;
      recentArtifacts: { artifactId: string; evicted: boolean }[];
    };
    expect(Object.keys(data.budgets).sort()).toEqual([
      "chartPoints",
      "contextItems",
      "executionMs",
      "resultRows",
      "retainedArtifacts",
      "toolSummaryBytes",
    ]);
    expect(data.budgets.executionMs).toBe(5000);
    expect(data.budgets.resultRows).toBe(10000);
    expect(data.capabilities.length).toBeGreaterThanOrEqual(6);
    expect(data.activeDataset).toBeNull();
    expect(data.selectedArtifactId).toBeNull();
    expect(data.recentArtifacts).toEqual([]);
  });

  test("scenario 4: no tool response ever carries a raw result-row array", async ({ page }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", CHURN_ACTIVATE);
    const context = (await invokeTool(page, "duckdb_get_context", { scope: "summary" })) as EnvelopeSuccess;
    const analysis = (await invokeTool(page, "duckdb_execute_sql_to_canvas", churnAnalysis(1, "qa-rows-01"))) as EnvelopeSuccess;
    const custody = (await invokeTool(page, "duckdb_verify_zero_egress", {
      scope: "artifact",
      artifactId: "a_01",
    })) as EnvelopeSuccess;

    for (const envelope of [context, analysis, custody]) {
      const keys = collectKeys(envelope);
      // Row payloads have row-shaped names; the release counters
      // (rawRowsToAgent etc.) are numbers, not arrays, and are allowed.
      for (const banned of ["rows", "records", "batches", "values"]) {
        expect(keys.has(banned)).toBe(false);
      }
    }

    // The analysis data releases zero raw rows to the agent, structurally.
    const data = analysis.data as {
      artifact: { release: { rawRowsToAgent: number }; rowCount: number; schema: unknown[] };
      summary: { kpis: unknown[] };
      metrics: { materializedRows: number };
    };
    expect(data.artifact.release.rawRowsToAgent).toBe(0);
    expect(data.summary.kpis.length).toBeGreaterThan(0);
    expect(data.artifact.schema.length).toBeGreaterThan(0);
  });

  test("scenario 8: a stale mutation names both revisions and suggests the delta read", async ({ page }) => {
    await agentSurface(page);
    const activated = (await invokeTool(page, "duckdb_activate_dataset", CHURN_ACTIVATE)) as EnvelopeSuccess;
    expect(activated.ok).toBe(true);

    const stale = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      ...churnAnalysis(1, "qa-stale-01"),
      expectedRevision: 0,
    })) as EnvelopeFailure;
    expect(stale.ok).toBe(false);
    expect(stale.error.code).toBe("STALE_REVISION");
    expect(stale.error.retryable).toBe(true);
    expect(stale.error.details).toEqual({ expectedRevision: 0, currentRevision: 1 });

    // §12: the recovery is the delta read from the revision the caller
    // prepared against — executable verbatim, not a second full summary.
    expect(stale.nextActions).toEqual([
      { kind: "tool", tool: "duckdb_get_context", input: { scope: "events", sinceRevision: 0 } },
    ]);

    // A denial commits nothing: the workspace stays at the activated revision.
    await expect(page.getByText("ws_local_01 · rev 1 · saas_churn · public_synthetic")).toBeVisible();
    await expect(page.getByText("No artifacts — operations settle here as immutable artifacts.")).toBeVisible();
  });

  test("scenario 9: exact replay returns the original envelope; key reuse conflicts", async ({ page }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", CHURN_ACTIVATE);

    const input = churnAnalysis(1, "qa-replay-01");
    const first = (await invokeTool(page, "duckdb_execute_sql_to_canvas", input)) as EnvelopeSuccess;
    expect(first.ok).toBe(true);
    expect(first.revision).toBe(2);

    const replay = (await invokeTool(page, "duckdb_execute_sql_to_canvas", input)) as EnvelopeSuccess;
    expect(stableJson(replay)).toBe(stableJson(first));

    // One commit, one card: the replay manufactured no second artifact.
    await expect(page.getByText("a_01", { exact: true })).toHaveCount(1);

    const conflict = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      ...input,
      sql: "SELECT COUNT(*) AS n FROM saas_churn",
    })) as EnvelopeFailure;
    expect(conflict.ok).toBe(false);
    expect(conflict.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(conflict.error.retryable).toBe(false);
    expect(conflict.error.details).toEqual({ idempotencyKey: "qa-replay-01" });
    expect(conflict.nextActions).toEqual([]);
  });
});
