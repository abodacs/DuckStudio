import { describe, expect, it } from "vitest";
import { composePresentation, type WorkbenchPickers } from "./presentation";

/**
 * The workbench presentation composer's contract (stage 4). Deny over strip
 * (§4.5): the composed spec submits the pickers as picked — a grid request on
 * a sensitive dataset travels to the workspace and is *denied* there with
 * `permittedPresentation`, never silently sanitized here.
 */

const PICKERS: WorkbenchPickers = {
  kpis: [],
  chart: null,
  grid: false,
};

describe("composePresentation", () => {
  it("composes nothing from empty pickers", () => {
    expect(composePresentation(PICKERS)).toEqual({});
  });

  it("labels KPIs by column and keeps the picked format", () => {
    const spec = composePresentation({
      ...PICKERS,
      kpis: [
        { column: "churn_rate", format: "percent" },
        { column: "mrr", format: "currency_usd" },
      ],
    });
    expect(spec.kpis).toEqual([
      { label: "churn_rate", column: "churn_rate", format: "percent" },
      { label: "mrr", column: "mrr", format: "currency_usd" },
    ]);
  });

  it("composes a chart only when both axes are picked", () => {
    const half = composePresentation({ ...PICKERS, chart: { type: "bar", x: "region", y: "" } });
    expect(half.chart).toBeUndefined();
    const full = composePresentation({ ...PICKERS, chart: { type: "scatter", x: "tickets", y: "churn_rate" } });
    expect(full.chart).toEqual({ type: "scatter", x: "tickets", y: "churn_rate" });
  });

  it("submits the grid request as picked — the workspace denies, not the composer", () => {
    expect(composePresentation({ ...PICKERS, grid: true }).grid).toEqual({ visible: true });
  });

  it("fills what the pickers leave open from the prior spec — explicit picks win", () => {
    const prior = {
      kpis: [{ label: "n", column: "n", format: "integer" as const }],
      chart: { type: "scatter" as const, x: "tickets", y: "churn_rate" },
    };
    // Re-chart: no new KPI picks, the prior KPIs ride along.
    const rechart = composePresentation(
      { ...PICKERS, grid: false, chart: { type: "bar", x: "tickets", y: "n" } },
      prior,
    );
    expect(rechart.kpis).toEqual([{ label: "n", column: "n", format: "integer" }]);
    expect(rechart.chart).toEqual({ type: "bar", x: "tickets", y: "n" });

    const picked = composePresentation(
      { ...PICKERS, grid: false, kpis: [{ column: "mrr", format: "currency_usd" }] },
      prior,
    );
    expect(picked.kpis).toEqual([{ label: "mrr", column: "mrr", format: "currency_usd" }]);
  });
});
