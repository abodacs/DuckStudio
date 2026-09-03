// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchView } from "./workbench-view";
import { activatePreset, runWorkbenchAnalysis } from "../human-commands";
import { captureWorkbenchPrefill } from "../view-intent";
import { projectArtifact } from "../../revisioned-workspace/projection";
import type { WorkspaceStore } from "../../revisioned-workspace/store";
import {
  activateSaasChurn,
  CHURN_SQL,
  createStore,
  fakeEngine,
  runChurn,
} from "../../revisioned-workspace/_contract/harness";

let current: WorkspaceStore = createStore(fakeEngine());

vi.mock("../../revisioned-workspace/use-workspace", () => ({
  useWorkspace: (selector: (workspace: never) => unknown) => selector(current.getSnapshot() as never),
}));

// The editor ships as its own chunk behind the lazy boundary; the contract
// under test is the workbench's wiring, not CodeMirror's DOM.
vi.mock("./sql-editor", () => ({
  default: () => <div aria-label="SQL editor stub" />,
}));

vi.mock("../human-commands", () => ({
  runWorkbenchAnalysis: vi.fn(),
  activatePreset: vi.fn(),
}));

const runMock = vi.mocked(runWorkbenchAnalysis);
const activateMock = vi.mocked(activatePreset);

/**
 * The workbench view's contract (stage 4; the usability gaps): the pickers
 * row composes what the run submits (kpis, chart, grid — exactly as picked),
 * a `DATASET_UNAVAILABLE` denial offers the executable "Activate <preset>"
 * through the same `activateDataset` command a preset card dispatches, and a
 * refine prefill seeds the pickers from the refined artifact's committed
 * presentation.
 */

beforeEach(async () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: false, media: query }) as MediaQueryList,
  });
  // jsdom lacks the pointer/observer surface the Radix select reads.
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  runMock.mockReset().mockResolvedValue({ ok: true });
  activateMock.mockReset().mockResolvedValue({ ok: true });
  current = createStore(fakeEngine());
  await activateSaasChurn(current);
});

afterEach(cleanup);

function renderWorkbench() {
  render(<WorkbenchView />);
  return screen.findByLabelText("Presentation pickers");
}

describe("WorkbenchView", () => {
  it("composes the picked kpis, chart, and grid into the run command", async () => {
    await renderWorkbench();

    fireEvent.click(screen.getByText("+ KPI"));
    fireEvent.change(screen.getByLabelText("KPI 1 column"), { target: { value: "tickets" } });
    // The pickers are Radix selects: open the trigger, then click the option.
    fireEvent.keyDown(screen.getByLabelText("Chart type"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "bar" }));
    fireEvent.change(screen.getByLabelText("Chart x axis"), { target: { value: "tickets" } });
    fireEvent.change(screen.getByLabelText("Chart y axis"), { target: { value: "accounts" } });
    fireEvent.click(screen.getByRole("button", { name: /Run analysis/ }));

    await vi.waitFor(() => expect(runMock).toHaveBeenCalledTimes(1));
    expect(runMock.mock.calls[0]?.[0].presentation).toEqual({
      kpis: [{ label: "tickets", column: "tickets", format: "integer" }],
      chart: { type: "bar", x: "tickets", y: "accounts" },
      grid: { visible: true },
    });
  });

  it("offers the executable activate action on DATASET_UNAVAILABLE", async () => {
    runMock.mockResolvedValue({
      ok: false,
      code: "DATASET_UNAVAILABLE",
      message: "No dataset is active; activate an available preset first.",
      details: { datasetId: "saas_churn", activeDatasetId: null },
    });
    await renderWorkbench();

    fireEvent.click(screen.getByRole("button", { name: /Run analysis/ }));
    const activate = await screen.findByRole("button", { name: "Activate saas_churn" });
    fireEvent.click(activate);

    expect(activateMock).toHaveBeenCalledWith("saas_churn", 1);
  });

  it("seeds the pickers from the refined artifact's committed presentation", async () => {
    const envelope = await runChurn(current, "workbench-refine-churn");
    if (!envelope.ok) throw new Error("expected the churn analysis to commit");
    const workspace = current.getSnapshot();
    const artifactId = workspace.selectedArtifactId;
    if (!artifactId) throw new Error("expected a selected artifact");
    const projected = projectArtifact(workspace, artifactId);
    if (projected.kind !== "artifact") throw new Error("expected the committed artifact");
    const summary = projected.summary;

    captureWorkbenchPrefill({ sql: CHURN_SQL, source: { kind: "artifact", id: artifactId } });
    await renderWorkbench();

    expect(screen.getByLabelText("KPI 1 column")).toHaveValue(summary.kpis[0]?.column);
    // Radix triggers are buttons: the picked value is their visible text.
    expect(screen.getByLabelText(`KPI 1 format`)).toHaveTextContent(summary.kpis[0]?.format ?? "");
    expect(screen.getByLabelText("Chart type")).toHaveTextContent(summary.chart?.type ?? "no chart");
    expect(screen.getByLabelText("Chart x axis")).toHaveValue(summary.chart?.x ?? "");
    expect(screen.getByLabelText("Chart y axis")).toHaveValue(summary.chart?.y ?? "");
  });

  it("a denied activation echoes its envelope in the workbench strip", async () => {
    runMock.mockResolvedValue({
      ok: false,
      code: "DATASET_UNAVAILABLE",
      message: "No dataset is active; activate an available preset first.",
      details: { datasetId: "saas_churn", activeDatasetId: null },
    });
    activateMock.mockResolvedValue({
      ok: false,
      code: "OPERATION_CONFLICT",
      message: "Another operation is running; wait for it or cancel it.",
    });
    await renderWorkbench();

    fireEvent.click(screen.getByText("+ KPI"));
    fireEvent.change(screen.getByLabelText("KPI 1 column"), { target: { value: "tickets" } });
    fireEvent.click(screen.getByRole("button", { name: /Run analysis/ }));
    const activate = await screen.findByRole("button", { name: "Activate saas_churn" });
    fireEvent.click(activate);

    expect(await screen.findByText("OPERATION_CONFLICT")).toBeInTheDocument();
  });
});
