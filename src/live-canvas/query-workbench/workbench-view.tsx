import { lazy, Suspense, useEffect } from "react";
import type { ArtifactSummary } from "../../analysis-artifacts/schemas";
import { PRESET_IDS, type PresetId } from "../../demo-presets/catalog";
import { projectArtifact, projectWorkspace } from "../../revisioned-workspace/projection";
import { useWorkspace } from "../../revisioned-workspace/use-workspace";
import { formatKpiValue } from "../kpi";
import { DataGridView } from "../data-grid-view";
import { recoveryCopy } from "../recovery-copy";
import { consumeWorkbenchPrefill } from "../view-intent";
import { useWorkbench, type PriorPresentation } from "./use-workbench";
import { WbSelect } from "./wb-select";
import type { KpiFormat } from "./presentation";

/**
 * The lazy CodeMirror boundary (stage 4; mirrors the chart.tsx ECharts
 * rule): `sql-editor.tsx` is the only CodeMirror importer, loaded on the
 * first workbench render behind Suspense with a "Loading editor…" fallback.
 */
const SqlEditor = lazy(() => import("./sql-editor"));

const KPI_FORMATS: readonly KpiFormat[] = ["percent", "decimal", "currency_usd", "integer"];
const CHART_TYPES = ["bar", "line", "scatter"] as const;
/** Radix items can't carry an empty value; "none" is the "no chart" sentinel. */
const CHART_OPTIONS = [
  { value: "none", label: "no chart" },
  ...CHART_TYPES.map((type) => ({ value: type, label: type })),
];

/** The refined artifact's committed presentation, in picker shape. */
function pickersFromSummary(summary: ArtifactSummary): PriorPresentation {
  return {
    kpis: summary.kpis.map((kpi) => ({ column: kpi.column, format: kpi.format })),
    chart: summary.chart ? { type: summary.chart.type, x: summary.chart.x, y: summary.chart.y } : null,
  };
}

/** Column suggestions for the pickers: what the selected artifact produces. */
function summaryColumns(summary: ArtifactSummary | null): string[] {
  if (!summary) return [];
  const columns = new Set<string>();
  for (const kpi of summary.kpis) columns.add(kpi.column);
  if (summary.chart) {
    columns.add(summary.chart.x);
    columns.add(summary.chart.y);
  }
  return [...columns];
}

/**
 * The SQL workbench (stage 4; the plan's "lost" item 5 — the human SQL
 * entry): editor on top, results below. The pickers row requests KPIs, a
 * chart, and rows exactly as picked — deny over strip is the workspace's
 * ruling, and column suggestions come from the selected artifact. The
 * results area reuses the Rows view and KPI chips, so policy suppression is
 * inherited, never re-derived. One statement runs at a time through the same
 * domain command an agent dispatches; denials render the shared recovery
 * copy with the envelope's executable move — "Apply safe presentation" when
 * `permittedPresentation` exists, "Activate <preset>" when the dataset is
 * merely not active.
 */
export function WorkbenchView() {
  const vm = useWorkspace(projectWorkspace);
  const datasetState = vm.datasetState;
  const revision = vm.revision;
  const artifact = useWorkspace((ws) => projectArtifact(ws, ws.selectedArtifactId));
  const workbench = useWorkbench(datasetState.kind === "active" ? datasetState.datasetId : "");

  const selectedSummary = artifact.kind === "artifact" ? artifact.summary : null;
  const columns = summaryColumns(selectedSummary);

  // "Refine from this result" captures a prefill at the shell; the tab
  // consumes it once on mount (canvas-local, never workspace state), seeding
  // the pickers with the refined artifact's committed presentation.
  useEffect(() => {
    const prefill = consumeWorkbenchPrefill();
    if (prefill && prefill.source.kind === "artifact") {
      const prior = artifact.kind === "artifact" ? pickersFromSummary(artifact.summary) : undefined;
      workbench.prefillFromArtifact(prefill.sql, prefill.source.id, prior);
    }
    // The workbench instance is the tab's owner; the prefill is one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  const sourceLabel = datasetState.kind === "active" ? datasetState.datasetId : "no dataset yet";

  const kpis = artifact.kind === "artifact" ? artifact.summary.kpis : [];

  const updateKpi = (index: number, patch: Partial<{ column: string; format: KpiFormat }>): void => {
    workbench.setPickers({
      ...workbench.pickers,
      kpis: workbench.pickers.kpis.map((kpi, i) => (i === index ? { ...kpi, ...patch } : kpi)),
    });
  };
  const updateChart = (patch: Partial<{ type: "bar" | "line" | "scatter"; x: string; y: string }>): void => {
    if (!workbench.pickers.chart) return;
    workbench.setPickers({
      ...workbench.pickers,
      chart: { ...workbench.pickers.chart, ...patch },
    });
  };

  // The executable recovery target: the failed run's dataset, when it names
  // an available preset. Any other DATASET_UNAVAILABLE stays copy-only.
  const recoveryDatasetId =
    workbench.failure?.code === "DATASET_UNAVAILABLE" &&
    typeof workbench.failure.details.datasetId === "string" &&
    (PRESET_IDS as readonly string[]).includes(workbench.failure.details.datasetId)
      ? (workbench.failure.details.datasetId as PresetId)
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-medium text-ink">SQL workbench</h3>
          <p className="meta mt-0.5">
            source <span className="mono-value">{sourceLabel}</span> · read-only, one bounded statement
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="meta flex cursor-pointer items-center gap-1.5" title="Requests the committed rows below; the policy has the final word">
            <input
              type="checkbox"
              className="size-3.5 accent-accent"
              checked={workbench.pickers.grid}
              onChange={(event) => workbench.setPickers({ ...workbench.pickers, grid: event.target.checked })}
            />
            Show rows
          </label>
          <button type="button" className="button-run" onClick={() => void workbench.run()} disabled={workbench.running}>
            <span aria-hidden>⚡</span> {workbench.running ? "Running…" : "Run analysis"}
            <kbd className="meta ml-1.5" title="Command or Control plus Enter">⌘↵</kbd>
          </button>
        </div>
      </div>
      <div role="group" aria-label="Presentation pickers" className="flex flex-wrap items-center gap-1.5">
        <span className="card-label">KPIs</span>
        {workbench.pickers.kpis.map((kpi, index) => (
          <span key={index} className="flex items-center gap-1">
            <input
              className="wb-field"
              list="wb-picker-columns"
              aria-label={`KPI ${index + 1} column`}
              placeholder="kpi column"
              value={kpi.column}
              onChange={(event) => updateKpi(index, { column: event.target.value })}
            />
            <WbSelect
              label={`KPI ${index + 1} format`}
              value={kpi.format}
              options={KPI_FORMATS.map((format) => ({ value: format, label: format }))}
              onValueChange={(format) => updateKpi(index, { format: format as KpiFormat })}
            />
            <button
              type="button"
              className="wb-add"
              aria-label={`Remove KPI ${index + 1}${kpi.column ? ` (${kpi.column})` : ""}`}
              onClick={() =>
                workbench.setPickers({
                  ...workbench.pickers,
                  kpis: workbench.pickers.kpis.filter((_, i) => i !== index),
                })
              }
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          className="wb-add"
          aria-label="Add KPI row"
          onClick={() =>
            workbench.setPickers({
              ...workbench.pickers,
              kpis: [...workbench.pickers.kpis, { column: "", format: "integer" }],
            })
          }
        >
          + KPI
        </button>
        <span aria-hidden className="mx-1 h-5 w-px bg-edge" />
        <span className="card-label">Chart</span>
        <WbSelect
          label="Chart type"
          value={workbench.pickers.chart?.type ?? "none"}
          options={CHART_OPTIONS}
          onValueChange={(value) => {
            workbench.setPickers({
              ...workbench.pickers,
              chart:
                value === "none"
                  ? null
                  : {
                      type: value as "bar" | "line" | "scatter",
                      x: workbench.pickers.chart?.x ?? "",
                      y: workbench.pickers.chart?.y ?? "",
                    },
            });
          }}
        />
        {workbench.pickers.chart && (
          <>
            <input
              className="wb-field"
              list="wb-picker-columns"
              aria-label="Chart x axis"
              placeholder="x"
              value={workbench.pickers.chart.x}
              onChange={(event) => updateChart({ x: event.target.value })}
            />
            <input
              className="wb-field"
              list="wb-picker-columns"
              aria-label="Chart y axis"
              placeholder="y"
              value={workbench.pickers.chart.y}
              onChange={(event) => updateChart({ y: event.target.value })}
            />
          </>
        )}
        <datalist id="wb-picker-columns">
          {columns.map((column) => (
            <option key={column} value={column} />
          ))}
        </datalist>
      </div>
      <Suspense
        fallback={
          <div className="ghost-tile flex h-28 items-center justify-center">
            <p className="meta">Loading editor…</p>
          </div>
        }
      >
        <SqlEditor
          value={workbench.sql}
          onChange={workbench.setSql}
          onRun={() => void workbench.run()}
          placeholder="SELECT region, COUNT(*) AS n FROM saas_churn GROUP BY region"
        />
      </Suspense>
      {workbench.failure && (
        <div role="alert" className="operation-card operation-card-failed">
          <p className="mt-1 flex items-center gap-2">
            <span className="chip-error">{workbench.failure.code}</span>
            <span className="meta">{workbench.failure.message}</span>
          </p>
          <p className="meta mt-1">{recoveryCopy(workbench.failure.code).move}</p>
          {workbench.failure.permitted && (
            <p className="mt-1.5">
              <button type="button" className="button-recovery" onClick={workbench.applyPermitted}>
                Apply safe presentation
              </button>
            </p>
          )}
          {recoveryDatasetId && (
            <p className="mt-1.5">
              <button
                type="button"
                className="button-recovery"
                onClick={() => void workbench.activateDataset(recoveryDatasetId, revision)}
              >
                Activate {recoveryDatasetId}
              </button>
            </p>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5">
        {kpis.length > 0 && (
          <div role="group" aria-label="Result KPIs" className="flex flex-wrap gap-1.5">
            {kpis.map((kpi) => (
              <span key={kpi.column} className="chip-kpi">
                {kpi.label} <span className="mono-value">{formatKpiValue(kpi.value, kpi.format)}</span>
              </span>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">
          <DataGridView />
        </div>
      </div>
    </div>
  );
}
