// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CustodyView } from "../custody-view";
import { DataGridView } from "../data-grid-view";
import { InsightsView } from "../insights-view";
import { WorkspaceShell } from "../../studio-shell/shell";
import { workspaceStore } from "../../revisioned-workspace/store";
import type { WorkspaceStore } from "../../revisioned-workspace/store";
import { saasChurn } from "../../demo-presets/triples";
import type { AuthorizedDecision } from "../../dataset-custody/schemas";
import type { ExecutionResult } from "../../duck-engine/protocol";
import type { WorkspaceEngine } from "../../duck-engine/worker";
import {
  activateSaasChurn,
  CHURN_SQL,
  createStore,
  defaultFakeExecute,
  fakeEngine,
  runChurn,
} from "../../revisioned-workspace/_contract/harness";

/**
 * The canvas-side custody and a11y contracts (Slice 5, ticket 57). The views
 * and the shell read the workspace through `useWorkspace`, so the tests
 * inject a headless store at that seam and drive real commits through the
 * real kernel + fake engine. ECharts cannot init on jsdom's stub canvas, so
 * the chart module suspends forever here — which also pins the Suspense
 * fallback. The module-boundary scan below proves the real chart.tsx stays
 * the only echarts importer.
 */

// The chart is the one module this file replaces: a never-resolving
// component keeps the lazy boundary suspended so the 280px fallback is
// assertable without a canvas implementation.
vi.mock("../chart", () => ({
  default: () => {
    throw new Promise(() => {});
  },
}));

let current: WorkspaceStore = createStore(fakeEngine());

vi.mock("../../revisioned-workspace/use-workspace", () => ({
  useWorkspace: (selector: (workspace: never) => unknown) => selector(current.getSnapshot() as never),
}));

function tenThousandRowEngine(): WorkspaceEngine {
  const values = { tickets: Array.from({ length: 10_000 }, (_, index) => index) };
  return {
    ...fakeEngine(),
    execute(decision: AuthorizedDecision): Promise<ExecutionResult> {
      if (decision.positionalSql.includes("LIMIT 10000")) {
        return Promise.resolve({
          schema: [{ name: "tickets", type: "INTEGER" }],
          batches: [{ columns: [{ name: "tickets", type: "INTEGER" }], rowCount: 10_000, values }],
          metrics: { executionMs: 5, materializedRows: 10_000, chartPoints: 2000 },
        });
      }
      return defaultFakeExecute(decision);
    },
  };
}

/** An engine that never settles: the operation stays `running` for Cancel. */
function holdableEngine(): WorkspaceEngine {
  return {
    ...fakeEngine(),
    execute(): Promise<ExecutionResult> {
      return new Promise(() => {});
    },
  };
}

async function churnWorkspace(): Promise<WorkspaceStore> {
  const store = createStore(fakeEngine());
  await activateSaasChurn(store);
  const envelope = await runChurn(store, "canvas-contract-churn");
  if (!envelope.ok) throw new Error("expected the churn analysis to commit");
  return store;
}

async function healthcareWorkspace(): Promise<WorkspaceStore> {
  const store = createStore(fakeEngine());
  const activated = await store.dispatch({
    kind: "activateDataset",
    input: { datasetId: "healthcare_pii", expectedRevision: 0, idempotencyKey: "canvas-contract-health" },
  });
  if (!activated.ok) throw new Error("expected healthcare_pii to activate");
  const envelope = await store.dispatch({
    kind: "runAnalysis",
    input: {
      source: { kind: "dataset", id: "healthcare_pii" },
      sql: "SELECT diagnosis, COUNT(*) AS patients FROM healthcare_pii GROUP BY diagnosis",
      bindings: {},
      expectedRevision: 1,
      idempotencyKey: "canvas-contract-health-run",
    },
  });
  if (!envelope.ok) throw new Error(`expected the healthcare aggregate to commit: ${JSON.stringify(envelope.error)}`);
  return store;
}

beforeEach(() => {
  current = createStore(fakeEngine());
  // jsdom has no matchMedia; the shell's view-transition gate reads it.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: false, media: query }) as MediaQueryList,
  });
});

afterEach(cleanup);

describe("healthcare suppression contract (grilling 51 item 2)", () => {
  it("paints no rows from activation alone (acceptance 17)", async () => {
    const store = createStore(fakeEngine());
    await activateSaasChurn(store);
    current = store;
    const { container } = render(<DataGridView />);

    // The honest empty state, and not one record-shaped element.
    expect(screen.getByText("No artifact — the grid paints rows only from an approved artifact.")).toBeDefined();
    expect(container.querySelectorAll("[data-grid-row]")).toHaveLength(0);
  });

  it("renders the pinned banner plus released data and zero raw rows in the DOM", async () => {
    current = await healthcareWorkspace();
    const { container } = render(<DataGridView />);

    // The pinned banner copy, with the identifier line from the release data.
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText("Data Grid — suppressed by policy")).toBeDefined();
    expect(screen.getByText(/Raw records never paint on the shared canvas/)).toBeDefined();
    expect(screen.getByText(/k ≥ 10/)).toBeDefined();
    expect(screen.getByText("mrn")).toBeDefined();
    // The mute-test counters come from the captured evidence, not constants.
    expect(screen.getByText(/Uploaded to network:/)).toBeDefined();
    expect(screen.getByText("0 B")).toBeDefined();
    expect(screen.getByText(/Raw values released:/)).toBeDefined();

    // The legally released data: aggregates + column metadata.
    expect(screen.getByLabelText("Released aggregates")).toBeDefined();
    expect(screen.getByLabelText("Column metadata")).toBeDefined();

    // Zero raw rows, ever: no grid rows paint and no record values leak.
    expect(container.querySelectorAll("[data-grid-row]")).toHaveLength(0);
    expect(container.querySelector("[data-grid-viewport]")).toBeNull();
    expect(screen.queryByText("migraine")).toBeNull();
  });
});

describe("public grid virtualization contract (grilling 51 item 1)", () => {
  it("keeps the DOM row count at viewport + 2×overscan and scrolls by transform", async () => {
    const store = createStore(tenThousandRowEngine());
    await activateSaasChurn(store);
    const envelope = await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "dataset", id: "saas_churn" },
        sql: "SELECT tickets FROM saas_churn LIMIT 10000",
        bindings: {},
        expectedRevision: 1,
        idempotencyKey: "canvas-contract-10k",
      },
    });
    if (!envelope.ok) throw new Error("expected the 10k analysis to commit");
    current = store;

    const { container } = render(<DataGridView />);
    const windowEl = container.querySelector<HTMLElement>("[data-grid-window]");
    if (!windowEl) throw new Error("expected the grid window");
    // jsdom gives no layout, so the window is the overscan-bounded minimum:
    // well inside the viewport rows + 2×overscan bar at the 10k budget.
    const rows = container.querySelectorAll("[data-grid-row]");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(1 + 2 * 8);

    // Transform-only scroll: the canvas keeps its full height; the window
    // moves by translateY, and the DOM row count stays bounded.
    const viewport = container.querySelector<HTMLElement>("[data-grid-viewport]");
    if (!viewport) throw new Error("expected the grid viewport");
    const canvas = container.querySelector<HTMLElement>("[data-grid-canvas]");
    expect(canvas?.style.height).toBe("320000px");
    viewport.scrollTop = 3200;
    fireEvent.scroll(viewport);
    expect(windowEl.style.transform).toBe("translateY(2944px)");
    expect(container.querySelectorAll("[data-grid-row]").length).toBeLessThanOrEqual(1 + 2 * 8);
  });
});

describe("insights lazy-chart boundary (grilling 52)", () => {
  it("keeps the 280px Loading chart fallback while the chart chunk loads", async () => {
    current = await churnWorkspace();
    render(<InsightsView />);
    expect(screen.getByText("Loading chart…")).toBeDefined();
  });
});

describe("module boundary: echarts is importable only from chart.tsx (grilling 52)", () => {
  it("finds no echarts import outside live-canvas/chart.tsx", () => {
    const srcRoot = join(fileURLToPath(import.meta.url), "../../../..");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.(tsx?|css)$/.test(entry.name) && !path.endsWith("chart.tsx")) {
          if (/from\s+["']echarts|import\(\s*["']echarts/.test(readFileSync(path, "utf8"))) {
            offenders.push(path);
          }
        }
      }
    };
    walk(join(srcRoot, "src"));
    expect(offenders).toEqual([]);
  });
});

describe("badge pulse contract (grilling 53.4)", () => {
  it("pulses amber only while an operation is live, and reduces with motion", async () => {
    render(<WorkspaceShell />);
    // Rev-0 snapshot: no operations, no live pulse.
    expect(document.querySelector(".badge-dot-live")).toBeNull();

    // The reduce compliance lives in the stylesheet next to the keyframe.
    const css = readFileSync(
      join(fileURLToPath(import.meta.url), "../../../studio-shell/shell.css"),
      "utf8",
    );
    expect(css).toMatch(/\.badge-dot-live/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*badge-dot-live[\s\S]*animation: none/s);
  });
});

describe("tab and dispatch contracts (§7.2, §15.16)", () => {
  it("tab clicks and keyboard roving never dispatch", () => {
    render(<WorkspaceShell />);
    const spy = vi.spyOn(workspaceStore, "dispatch");

    for (const label of ["Insights", "Data Grid", "SQL & Lineage", "Custody"]) {
      const tab = screen.getByRole("tab", { name: label });
      fireEvent.click(tab);
      expect(tab.getAttribute("aria-selected")).toBe("true");
    }
    const tablist = screen.getByRole("tablist", { name: "Evidence views" });
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("an artifact-card click dispatches selectArtifact exactly once with a fresh key", async () => {
    current = await churnWorkspace();
    render(<WorkspaceShell />);
    const spy = vi.spyOn(workspaceStore, "dispatch");
    fireEvent.click(screen.getByRole("button", { name: /a_01/ }));
    expect(spy).toHaveBeenCalledTimes(1);
    const command = spy.mock.calls[0]?.[0];
    expect(command?.kind).toBe("selectArtifact");
    if (command?.kind === "selectArtifact") {
      expect(command.input.artifactId).toBe("a_01");
      expect(command.input.idempotencyKey).not.toBe("canvas-contract-churn");
    }
    spy.mockRestore();
  });

  it("Cancel on the running card dispatches cancelActiveOperation; the badge pulses amber", async () => {
    const store = createStore(holdableEngine());
    await activateSaasChurn(store);
    void store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "dataset", id: "saas_churn" },
        sql: CHURN_SQL,
        bindings: {},
        expectedRevision: 1,
        idempotencyKey: "canvas-contract-hold",
      },
    });
    // Acceptance 16: Cancel is a named dispatch, never a private setter.
    current = store;
    render(<WorkspaceShell />);
    expect(document.querySelector(".badge-dot-live")).not.toBeNull();

    const spy = vi.spyOn(workspaceStore, "dispatch");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(spy).toHaveBeenCalledTimes(1);
    const command = spy.mock.calls[0]?.[0];
    expect(command?.kind).toBe("cancelActiveOperation");
    if (command?.kind === "cancelActiveOperation") {
      expect(command.input.expectedRevision).toBe(store.getSnapshot().revision);
    }
    spy.mockRestore();
  });

  it("a failed operation renders code + message + recovery, never a stack trace", async () => {
    const store = createStore(fakeEngine());
    await activateSaasChurn(store);
    await store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "dataset", id: "saas_churn" },
        sql: "DROP TABLE saas_churn",
        bindings: {},
        expectedRevision: 1,
        idempotencyKey: "canvas-contract-fail",
      },
    });
    current = store;
    render(<WorkspaceShell />);
    expect(screen.getByText("UNSAFE_SQL")).toBeDefined();
    expect(screen.getByText(/Recovery: apply the blocked-construct details/)).toBeDefined();
    expect(screen.queryByText(/at |stack/i)).toBeNull();
  });

  it("custody renders the captured §8.4 snapshot with both limitations", async () => {
    current = await churnWorkspace();
    render(<CustodyView />);
    expect(screen.getByText("artifact:a_01")).toBeDefined();
    expect(screen.getByText("0 B")).toBeDefined();
    expect(screen.getAllByText("Application shell traffic is outside dataset-upload accounting.")).toHaveLength(1);
    expect(screen.getAllByText("Runtime interception is operational evidence, not a formal proof.")).toHaveLength(1);
  });
});

describe("judge-path gestures (slice 6: preset cards, the canonical prompt chip, capability chip)", () => {
  /**
   * The gestures dispatch through the human seam's real store singleton, so
   * these tests pin the seam's behavior at that seam: `getSnapshot` reads the
   * injected view's state and `dispatch` resolves the activation envelope,
   * making the chain deterministic without polluting the singleton.
   */
  function sealSeam() {
    const snapshot = vi
      .spyOn(workspaceStore, "getSnapshot")
      .mockReturnValue(current.getSnapshot() as ReturnType<typeof workspaceStore.getSnapshot>);
    const dispatch = vi
      .spyOn(workspaceStore, "dispatch")
      .mockImplementation(() => Promise.resolve({ ok: true, revision: 1 } as never));
    return { snapshot, dispatch };
  }

  const presetCard = (name: string | RegExp) =>
    within(screen.getByRole("group", { name: "Dataset presets" })).getByRole("button", { name });

  it("a preset-card click dispatches activateDataset once with a fresh key", () => {
    render(<WorkspaceShell />);
    const seam = sealSeam();
    fireEvent.click(presetCard(/saas_churn/));
    expect(seam.dispatch).toHaveBeenCalledTimes(1);
    const command = seam.dispatch.mock.calls[0]?.[0];
    expect(command?.kind).toBe("activateDataset");
    if (command?.kind === "activateDataset") {
      expect(command.input.datasetId).toBe("saas_churn");
      expect(command.input.expectedRevision).toBe(current.getSnapshot().revision);
      expect(command.input.idempotencyKey).not.toBe("");
    }
    seam.snapshot.mockRestore();
    seam.dispatch.mockRestore();
  });

  it("the active preset card paints the ACTIVE chip and stays enabled — the envelope teaches", async () => {
    current = await churnWorkspace();
    render(<WorkspaceShell />);
    const seam = sealSeam();
    const card = presetCard(/saas_churn/);
    expect(card).toHaveProperty("disabled", false);
    expect(screen.getByText("ACTIVE")).toBeDefined();
    // Grilling 61: no disabled state, no local gating — a second click is a
    // second dispatch whose envelope (OPERATION_CONFLICT or replay) teaches.
    fireEvent.click(card);
    expect(seam.dispatch).toHaveBeenCalledTimes(1);
    expect(seam.dispatch.mock.calls[0]?.[0]?.kind).toBe("activateDataset");
    seam.snapshot.mockRestore();
    seam.dispatch.mockRestore();
  });

  it("the canonical prompt chip scripts getContext then runAnalysis at the read's revision", async () => {
    render(<WorkspaceShell />);
    const seam = sealSeam();
    fireEvent.click(screen.getByRole("button", { name: /Analyze churn against support tickets\./ }));
    await waitFor(() => expect(seam.dispatch).toHaveBeenCalledTimes(2));
    const [context, run] = seam.dispatch.mock.calls.map((call) => call[0]);
    // Grilling 61: the exact two-call sequence, pill-for-pill with tape
    // beats 3–4 — a summary read, then the canonical analysis at the
    // revision the read returned.
    expect(context?.kind).toBe("getContext");
    if (context?.kind === "getContext") {
      expect(context.input.scope).toBe("summary");
    }
    expect(run?.kind).toBe("runAnalysis");
    if (run?.kind === "runAnalysis") {
      expect(run.input.source).toEqual({ kind: "dataset", id: "saas_churn" });
      expect(run.input.sql).toBe(saasChurn.sql);
      expect(run.input.expectedRevision).toBe(1);
      expect(run.input.presentation?.kpis?.map((kpi: { label: string }) => kpi.label)).toEqual([
        "Churn Rate",
        "Avg Tickets",
        "Impacted MRR",
      ]);
      expect(run.input.presentation?.chart?.threshold).toEqual({
        column: "tickets",
        value: 5,
        label: "churn accelerates above 5 tickets",
      });
    }
    seam.snapshot.mockRestore();
    seam.dispatch.mockRestore();
  });

  it("a preset click during a running operation renders the OPERATION_CONFLICT recovery card", async () => {
    // A live operation (never-settling engine) holds the slot; the envelope
    // verdict of the second dispatch echoes as the standard recovery card.
    const store = createStore(holdableEngine());
    await activateSaasChurn(store);
    void store.dispatch({
      kind: "runAnalysis",
      input: {
        source: { kind: "dataset", id: "saas_churn" },
        sql: CHURN_SQL,
        bindings: {},
        expectedRevision: 1,
        idempotencyKey: "canvas-contract-conflict-hold",
      },
    });
    current = store;
    render(<WorkspaceShell />);
    const seam = sealSeam();
    seam.dispatch.mockImplementation(
      () => Promise.resolve({ ok: false, error: { code: "OPERATION_CONFLICT" } }) as never,
    );
    fireEvent.click(presetCard(/healthcare_pii/));
    await waitFor(() => expect(screen.getByText("OPERATION_CONFLICT")).toBeDefined());
    expect(screen.getByText("Another operation is running; wait for it or cancel it.")).toBeDefined();
    expect(screen.getByText("Recovery: wait for the running operation or cancel it.")).toBeDefined();
    seam.snapshot.mockRestore();
    seam.dispatch.mockRestore();
  });

  it("the capability chip names the served surface from the projection, next to the badge", async () => {
    current = await churnWorkspace();
    current.appendCapability("simulator_only");
    render(<WorkspaceShell />);
    expect(screen.getByText("simulator_only · same workspace")).toBeDefined();
    expect(screen.queryByText(/connecting/)).toBeNull();
    cleanup();

    current = await churnWorkspace();
    current.appendCapability("webmcp_native");
    render(<WorkspaceShell />);
    expect(screen.getByText("webmcp_native")).toBeDefined();
  });
});
