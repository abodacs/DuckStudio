import { expect, test } from "@playwright/test";
import { sha256Hex } from "../src/analysis-artifacts/sql-hash";
import { SAAS_CHURN_CANONICAL_SQL } from "../src/demo-presets/canonical-sql";
import {
  agentSurface,
  assertFailureEnvelope,
  CHURN_ACTIVATE,
  churnAnalysis,
  invokeTool,
  stableJson,
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
    expect(Number(denied.error.details.elapsed)).toBeGreaterThanOrEqual(100);

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
      // The rendered form is the kpi.ts formatter's output (pinned by
      // kpi.test.ts); here the projection contract is what matters: the
      // envelope's measured value is what paints, label for label.
      const expected =
        kpi.format === "percent"
          ? (kpi.value === null ? null : (kpi.value * 100).toFixed(1) + "%")
          : kpi.format === "currency_usd"
            ? (kpi.value === null ? null : "$" + kpi.value.toLocaleString("en-US"))
            : kpi.format === "decimal"
              ? (kpi.value === null ? null : kpi.value.toFixed(1))
              : kpi.value === null
                ? null
                : kpi.value.toLocaleString("en-US");
      expect(rendered[kpi.label], `KPI ${kpi.label} should render its measured value`).toBe(expected);
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

// --- QA spec: acceptance-scenario coverage, stage 5 (slice-7 plan). The
// gaps the earlier slices left: analysis before activation, cancel on a
// running operation, chart downsampling, over-max budgets, delta reads,
// redacted bindings, the hash/runtime disclosure, and the three-way parity
// leg the BDD feature promises. ---

const ACTIVATE_CHURN = "Activate dataset saas_churn · public_synthetic policy";
const CHIP_LABEL = "Analyze churn against support tickets.";

test.describe("qa: stage-5 acceptance scenarios", () => {
  test("analysis before activation is recoverably refused with both legal next actions", async ({ page }) => {
    await agentSurface(page);
    const denied = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "saas_churn" },
      sql: "SELECT COUNT(*) AS n FROM saas_churn",
      bindings: {},
      expectedRevision: 0,
      idempotencyKey: "qa5-before-activate-01",
    })) as EnvelopeFailure;
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe("DATASET_UNAVAILABLE");
    expect(denied.revision).toBe(0);
    assertFailureEnvelope(denied, ["tickets", "churn_rate"]);
    // §9's recovery: activate a preset, or hand the gesture to the person —
    // whose dropzone is real since slice 7.
    expect(denied.nextActions).toEqual([
      {
        kind: "tool",
        tool: "duckdb_activate_dataset",
        input: { datasetId: "saas_churn", expectedRevision: 0, idempotencyKey: "recover-activate-r0" },
      },
      { kind: "human_action", action: "select_local_file" },
    ]);
  });

  test("a budget request above the hard maximum is a validation failure, not a clamp", async ({ page }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", CHURN_ACTIVATE);
    const denied = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "saas_churn" },
      sql: "SELECT COUNT(*) AS n FROM saas_churn",
      bindings: {},
      budget: { executionMs: 15_001 },
      expectedRevision: 1,
      idempotencyKey: "qa5-over-max-01",
    })) as EnvelopeFailure;
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe("VALIDATION_ERROR");
    // The input schema rejects the over-max axis before the kernel sees it:
    // the offending field is named, no execution starts.
    expect(Object.keys(denied.error.details)).toContain("input.budget.executionMs");
    assertFailureEnvelope(denied);
    // Pre-execution: the workspace never left the activated revision.
    await expect(page.getByText("rev 1 · saas_churn · public_synthetic")).toBeVisible();
  });

  test("cancelling the running operation restores the prior selection (§15.11)", async ({ page }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", CHURN_ACTIVATE);
    const first = (await invokeTool(page, "duckdb_execute_sql_to_canvas", churnAnalysis(1, "qa5-cancel-first"))) as EnvelopeSuccess;
    expect(first.ok).toBe(true);

    // The budget-held operation (0df17de pattern): a five-second hold keeps
    // the slot busy so the cancel lands mid-flight, deterministically.
    const held = invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "saas_churn" },
      sql: "SELECT COUNT(*) AS n FROM saas_churn a, saas_churn b",
      bindings: {},
      expectedRevision: 2,
      idempotencyKey: "qa5-cancel-held",
    });
    await expect(page.locator(".chip-operation.op-running").first()).toBeVisible();

    // Cancel is the human's affordance on the running card.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("rev 3", { exact: true })).toBeVisible();

    const heldEnvelope = (await held) as EnvelopeFailure;
    expect(heldEnvelope.ok).toBe(false);
    expect(heldEnvelope.error.code).toBe("OPERATION_CANCELLED");
    assertFailureEnvelope(heldEnvelope);

    // The prior artifact stays selected; the cancelled op committed nothing.
    const summary = (await invokeTool(page, "duckdb_get_context", { scope: "summary" })) as EnvelopeSuccess;
    expect((summary.data as { selectedArtifactId: string | null }).selectedArtifactId).toBe("a_01");
    const events = (await invokeTool(page, "duckdb_get_context", { scope: "events" })) as EnvelopeSuccess;
    const kinds = (events.data as { events: { kind: string }[] }).events.map((event) => event.kind);
    expect(kinds).toContain("operation_cancelled");
    // Exactly one success — the first run's; the cancelled op committed none.
    expect(kinds.filter((kind) => kind === "analysis_succeeded")).toHaveLength(1);
  });

  test("chart downsampling commits the budgeted points and discloses the warning", async ({ page }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", CHURN_ACTIVATE);
    const envelope = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "saas_churn" },
      // ~36 buckets: more materialized points than the 10-point budget.
      sql: "SELECT region, tickets, COUNT(*) AS n FROM saas_churn GROUP BY region, tickets ORDER BY n DESC",
      bindings: {},
      presentation: {
        chart: { type: "scatter", x: "tickets", y: "n", maxPoints: 10 },
      },
      expectedRevision: 1,
      idempotencyKey: "qa5-downsample-01",
    })) as EnvelopeSuccess;
    expect(envelope.ok).toBe(true);
    const downsampled = envelope.warnings.find((warning) => warning.code === "CHART_DOWNSAMPLED");
    expect(downsampled).toBeDefined();
    expect(Number(downsampled?.details.requested)).toBeGreaterThan(10);
    expect(downsampled?.details.emitted).toBe(10);
    // The measured metrics carry the emitted count; the spec is unchanged.
    expect((envelope.data as { metrics: { chartPoints: number } }).metrics.chartPoints).toBe(10);
    expect((envelope.data as { summary: { chart?: { pointCount: number } } }).summary.chart?.pointCount).toBe(10);
  });

  test("a delta context read returns exactly the events after the requested revision", async ({ page }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", CHURN_ACTIVATE);
    const analysis = (await invokeTool(page, "duckdb_execute_sql_to_canvas", churnAnalysis(1, "qa5-delta-run"))) as EnvelopeSuccess;
    expect(analysis.ok).toBe(true);

    const delta = (await invokeTool(page, "duckdb_get_context", {
      scope: "events",
      sinceRevision: 1,
    })) as EnvelopeSuccess;
    expect(delta.ok).toBe(true);
    const data = delta.data as { events: { revision: number; kind: string }[]; oldestRetainedRevision: number };
    expect(data.events.map((event) => event.revision)).toEqual([2, 2]);
    expect(data.events.map((event) => event.kind)).toEqual(["analysis_succeeded", "artifact_selected"]);
    expect(data.oldestRetainedRevision).toBeLessThanOrEqual(1);
  });

  test("values travel as named bindings and are redacted in the projected lineage", async ({ page }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", { ...CHURN_ACTIVATE, datasetId: "healthcare_pii" });
    const analysis = (await invokeTool(page, "duckdb_execute_sql_to_canvas", {
      source: { kind: "dataset", id: "healthcare_pii" },
      sql: "SELECT diagnosis, COUNT(*) AS patients FROM healthcare_pii WHERE diagnosis = $diagnosis GROUP BY diagnosis",
      bindings: { diagnosis: "hypertension" },
      expectedRevision: 1,
      idempotencyKey: "qa5-bindings-01",
    })) as EnvelopeSuccess;
    expect(analysis.ok).toBe(true);
    expect(analysis.ok).toBe(true);
    // The §8.3 response carries no bindings; the artifact read-back does,
    // redacted everywhere downstream of the kernel.
    const readback = (await invokeTool(page, "duckdb_get_context", {
      scope: "artifact",
      artifactId: "a_01",
    })) as EnvelopeSuccess;
    const artifact = (readback.data as { artifact: { bindings: Record<string, string>; release: { redactedBindingKeys: string[] } } }).artifact;
    expect(artifact.release.redactedBindingKeys).toEqual(["diagnosis"]);
    expect(artifact.bindings.diagnosis).toBe("[redacted]");
  });

  test("the SQL & Lineage view discloses the exact hash and measured runtime", async ({ page }) => {
    await agentSurface(page);
    await invokeTool(page, "duckdb_activate_dataset", CHURN_ACTIVATE);
    await invokeTool(page, "duckdb_execute_sql_to_canvas", churnAnalysis(1, "qa5-lineage"));

    await page.getByRole("tab", { name: "SQL & Lineage" }).click();
    const panel = page.getByRole("tabpanel");
    const expectedHash = sha256Hex(SAAS_CHURN_CANONICAL_SQL).slice(0, 16);
    await expect(panel.getByText(expectedHash + "…")).toBeVisible();
    await expect(panel.getByText(/\d+(\.\d+)? ms · \d+ rows · \d+ points/)).toBeVisible();
    await expect(panel.getByText("allowed", { exact: true })).toBeVisible();
  });

  test("the human chip and the served surface produce identical domain effects", async ({ page }) => {
    // Leg one: the human gesture (preset card, then the canonical chip).
    await agentSurface(page);
    await page.getByRole("button", { name: ACTIVATE_CHURN }).click();
    await expect(page.getByText("rev 1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: CHIP_LABEL }).click();
    await expect(page.getByText("a_01", { exact: true })).toBeVisible({ timeout: 60_000 });
    const human = (await invokeTool(page, "duckdb_get_context", { scope: "summary" })) as EnvelopeSuccess;
    const humanEvents = (await invokeTool(page, "duckdb_get_context", { scope: "events" })) as EnvelopeSuccess;
    const humanArtifact = (await invokeTool(page, "duckdb_get_context", { scope: "artifact", artifactId: "a_01" })) as EnvelopeSuccess;

    // Leg two: the served surface (native WebMCP or the simulator — this leg
    // is surface-agnostic by construction) drives the same legal sequence
    // on a fresh workspace.
    await page.reload();
    await agentSurface(page);
    const surfaceActivate = (await invokeTool(page, "duckdb_activate_dataset", CHURN_ACTIVATE)) as EnvelopeSuccess;
    expect(surfaceActivate.ok).toBe(true);
    const surfaceRun = (await invokeTool(page, "duckdb_execute_sql_to_canvas", churnAnalysis(1, "parity-surface-run"))) as EnvelopeSuccess;
    expect(surfaceRun.ok).toBe(true);

    const surface = (await invokeTool(page, "duckdb_get_context", { scope: "summary" })) as EnvelopeSuccess;
    const surfaceEvents = (await invokeTool(page, "duckdb_get_context", { scope: "events" })) as EnvelopeSuccess;

    // Identical revisions, artifact ids, and domain events — operation ids
    // are transport-local, so events compare by kind and revision.
    expect(surface.revision).toBe(human.revision);
    const stripIds = (envelope: EnvelopeSuccess) =>
      (envelope.data as { recentArtifacts: { artifactId: string }[] }).recentArtifacts.map((entry) => entry.artifactId);
    expect(stripIds(surface)).toEqual(stripIds(human));
    const stripEvents = (envelope: EnvelopeSuccess) =>
      (envelope.data as { events: { kind: string; revision: number }[] }).events.map(
        (event) => event.kind + "@" + event.revision,
      );
    expect(stripEvents(surfaceEvents)).toEqual(stripEvents(humanEvents));

    // Same artifact facts from both legs. Timestamps and measured runtime
    // are inherently per-run, so the identity compare covers the durable
    // facts: identity, statement, hash, schema, lineage, counts, release.
    const durable = (envelope: EnvelopeSuccess) => {
      const a = (envelope.data as { artifact: Record<string, unknown> }).artifact;
      return stableJson({
        artifactId: a.artifactId,
        relationName: a.relationName,
        source: a.source,
        sql: a.sql,
        sqlHash: a.sqlHash,
        bindings: a.bindings,
        schema: a.schema,
        rowCount: a.rowCount,
        lineage: a.lineage,
        policy: a.policy,
        release: a.release,
      });
    };
    const surfaceReadback = (await invokeTool(page, "duckdb_get_context", {
      scope: "artifact",
      artifactId: "a_01",
    })) as EnvelopeSuccess;
    expect(durable(surfaceReadback)).toBe(durable(humanArtifact));
  });
});
