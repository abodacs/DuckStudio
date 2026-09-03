// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbench } from "./use-workbench";
import { activatePreset, runWorkbenchAnalysis } from "../human-commands";

vi.mock("../human-commands", () => ({
  runWorkbenchAnalysis: vi.fn(),
  activatePreset: vi.fn(),
}));

const runMock = vi.mocked(runWorkbenchAnalysis);
const activateMock = vi.mocked(activatePreset);

/**
 * The workbench state machine's contract (stage 4; issue #82's sibling gaps):
 * the run submits the pickers exactly as picked — deny over strip happens in
 * the workspace, never here — the failure carries the envelope's details so
 * the strip can offer the executable recovery, refining from a result seeds
 * the pickers with its committed presentation, and a rejected activation
 * echoes its envelope in the same strip.
 */

beforeEach(() => {
  runMock.mockReset();
  activateMock.mockReset();
});

describe("useWorkbench", () => {
  it("submits the pickers exactly as picked and keeps the failure details", async () => {
    runMock.mockResolvedValue({
      ok: false,
      code: "DATASET_UNAVAILABLE",
      message: "No dataset is active; activate an available preset first.",
      details: { datasetId: "", activeDatasetId: null },
    });
    const { result } = renderHook(() => useWorkbench("saas_churn"));
    act(() => {
      result.current.setSql("SELECT tickets FROM saas_churn");
      result.current.setPickers({
        kpis: [{ column: "tickets", format: "integer" }],
        chart: { type: "bar", x: "tickets", y: "accounts" },
        grid: true,
      });
    });

    await act(() => result.current.run());

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { kind: "dataset", id: "saas_churn" },
        presentation: {
          kpis: [{ label: "tickets", column: "tickets", format: "integer" }],
          chart: { type: "bar", x: "tickets", y: "accounts" },
          grid: { visible: true },
        },
      }),
    );
    expect(result.current.failure?.code).toBe("DATASET_UNAVAILABLE");
    expect(result.current.failure?.details.datasetId).toBe("");
  });

  it("seeds the pickers from the refined artifact's presentation and pins the artifact source", async () => {
    runMock.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useWorkbench(""));
    act(() => {
      result.current.prefillFromArtifact("SELECT * FROM a_01", "a_01", {
        kpis: [{ column: "accounts", format: "currency_usd" }],
        chart: { type: "scatter", x: "tickets", y: "accounts" },
      });
    });

    expect(result.current.pickers).toEqual({
      kpis: [{ column: "accounts", format: "currency_usd" }],
      chart: { type: "scatter", x: "tickets", y: "accounts" },
      grid: true,
    });

    await act(() => result.current.run());

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { kind: "artifact", id: "a_01" },
        presentation: expect.objectContaining({
          kpis: [{ label: "accounts", column: "accounts", format: "currency_usd" }],
          chart: { type: "scatter", x: "tickets", y: "accounts" },
        }),
      }),
    );
  });

  it("applyPermitted adopts the permitted spec and clears the strip", async () => {
    const permitted = {
      kpis: [{ label: "patients", column: "patients", format: "integer" as const }],
      grid: { visible: false },
    };
    runMock.mockResolvedValue({
      ok: false,
      code: "POLICY_DENIED",
      message: "The supplied presentation would cross release policy; no element is silently stripped.",
      details: { permittedPresentation: JSON.stringify(permitted) },
    });
    const { result } = renderHook(() => useWorkbench("healthcare_pii"));
    await act(() => result.current.run());
    expect(result.current.failure?.permitted).toEqual(permitted);

    act(() => result.current.applyPermitted());

    expect(result.current.failure).toBeNull();
    expect(result.current.pickers.grid).toBe(false);
  });

  it("echoes a rejected activation in the strip; a success leaves it clear", async () => {
    const { result } = renderHook(() => useWorkbench(""));

    activateMock.mockResolvedValue({
      ok: false,
      code: "OPERATION_CONFLICT",
      message: "Another operation is running; wait for it or cancel it.",
    });
    await act(() => result.current.activateDataset("saas_churn", 0));
    expect(result.current.failure?.code).toBe("OPERATION_CONFLICT");
    expect(result.current.failure?.details).toEqual({ datasetId: "saas_churn" });

    activateMock.mockResolvedValue({ ok: true });
    await act(() => result.current.activateDataset("saas_churn", 0));
    expect(result.current.failure).toBeNull();
  });
});
