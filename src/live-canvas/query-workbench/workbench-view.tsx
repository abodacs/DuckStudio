import { lazy, Suspense, useEffect } from "react";
import { projectArtifact, projectWorkspace } from "../../revisioned-workspace/projection";
import { useWorkspace } from "../../revisioned-workspace/use-workspace";
import { formatKpiValue } from "../kpi";
import { DataGridView } from "../data-grid-view";
import { recoveryCopy } from "../recovery-copy";
import { consumeWorkbenchPrefill } from "../view-intent";
import { useWorkbench } from "./use-workbench";

/**
 * The lazy CodeMirror boundary (stage 4; mirrors the chart.tsx ECharts
 * rule): `sql-editor.tsx` is the only CodeMirror importer, loaded on the
 * first workbench render behind Suspense with a "Loading editor…" fallback.
 */
const SqlEditor = lazy(() => import("./sql-editor"));

/**
 * The SQL workbench (stage 4; the plan's "lost" item 5 — the human SQL
 * entry): editor on top, results below. The results area reuses the Rows
 * view and KPI chips, so policy suppression is inherited, never re-derived.
 * One statement runs at a time through the same domain command an agent
 * dispatches; denials render the shared recovery copy with a one-click
 * "Apply safe presentation" when `permittedPresentation` exists.
 */
export function WorkbenchView() {
  const artifact = useWorkspace((ws) => projectArtifact(ws, ws.selectedArtifactId));
  const datasetState = useWorkspace(projectWorkspace).datasetState;
  const workbench = useWorkbench(datasetState.kind === "active" ? datasetState.datasetId : "");

  // "Refine from this result" captures a prefill at the shell; the tab
  // consumes it once on mount (canvas-local, never workspace state).
  useEffect(() => {
    const prefill = consumeWorkbenchPrefill();
    if (prefill && prefill.source.kind === "artifact") {
      workbench.prefillFromArtifact(prefill.sql, prefill.source.id);
    }
    // The workbench instance is the tab's owner; the prefill is one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  const sourceLabel = datasetState.kind === "active" ? datasetState.datasetId : "no dataset yet";

  const kpis = artifact.kind === "artifact" ? artifact.summary.kpis : [];

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
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5">
        {kpis.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Result KPIs">
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
