import type { PresentationSpec } from "../../analysis-artifacts/schemas";

/**
 * The workbench's presentation composer (stage 4): pure and testable without
 * React. The pickers are what the workbench UI edits — KPI columns with
 * formats, optional chart axes, grid visibility — and the composed spec is
 * what the run command submits. Deny over strip (§4.5): the request goes
 * out exactly as picked, so a request that crosses release policy (rows on a
 * sensitive dataset, an identifier axis) is *denied* by the workspace with
 * `permittedPresentation` — the composer never silently sanitizes it.
 * `priorSpec` only fills what the pickers leave open (a re-chart keeps the
 * KPIs it refined from); explicit picker choices win.
 */
export interface WorkbenchPickers {
  /** KPI columns with their display formats; labels default to the column name. */
  readonly kpis: readonly { readonly column: string; readonly format: KpiFormat }[];
  /** Chart axes; a side needs its pair, so one alone composes no chart. */
  readonly chart: { readonly type: "bar" | "line" | "scatter"; readonly x: string; readonly y: string } | null;
  /** Grid visibility request; the workspace denies it when policy forbids. */
  readonly grid: boolean;
}

export type KpiFormat = "percent" | "decimal" | "currency_usd" | "integer";

export function composePresentation(
  pickers: WorkbenchPickers,
  priorSpec?: PresentationSpec,
): PresentationSpec {
  const pickedKpis =
    pickers.kpis.length > 0
      ? pickers.kpis
      : (priorSpec?.kpis?.map((kpi) => ({ column: kpi.column, format: kpi.format })) ?? []);
  const kpis = pickedKpis.map((kpi) => ({ label: kpi.column, column: kpi.column, format: kpi.format }));

  const chartSource = pickers.chart ?? priorSpec?.chart ?? null;
  const chart =
    chartSource && chartSource.x !== "" && chartSource.y !== ""
      ? {
          type: chartSource.type,
          x: chartSource.x,
          y: chartSource.y,
          ...(priorSpec?.chart?.maxPoints === undefined ? {} : { maxPoints: priorSpec.chart.maxPoints }),
        }
      : undefined;

  return {
    ...(kpis.length > 0 ? { kpis } : {}),
    ...(chart ? { chart } : {}),
    ...(pickers.grid ? { grid: { visible: true } } : {}),
  };
}
