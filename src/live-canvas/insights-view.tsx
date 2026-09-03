import { lazy, Suspense } from "react";
import { projectArtifact, projectWorkspace } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";
import { runCanonicalChurnAnalysis } from "./human-commands";
import { KpiTile, UnavailableArtifact } from "./artifact-states";

/**
 * The lazy ECharts boundary (ADR 0007, grilling 52): `chart.tsx` is the only
 * echarts importer, loaded on the first chart render behind Suspense with a
 * 280px "Loading chart…" fallback.
 */
const EvidenceChart = lazy(() => import("./chart"));

/**
 * The actionable empty-state copy (slice-7 plan stage 2): each state says
 * what to do next, not what is missing. The sample-analysis button exists
 * only while `saas_churn` is active — the one preset with a canonical run.
 */
export const INSIGHTS_EMPTY_STATE = {
  noDataset: "Activate a dataset on the left to begin.",
  datasetActive: "Run the sample analysis and results land here.",
} as const;

/**
 * Insights evidence view (grilling 52): KPI cards from the measured
 * projection — values are what the analysis produced, never targets — and
 * the lazy chart. A chart-only result stands alone.
 */
export function InsightsView() {
  const artifact = useWorkspace((ws) => projectArtifact(ws, ws.selectedArtifactId));
  const datasetState = useWorkspace(projectWorkspace).datasetState;
  switch (artifact.kind) {
    case "no_artifact": {
      const datasetActive = datasetState.kind === "active";
      return (
        <div className="view-swap empty-state">
          <div aria-hidden className="flex w-60 items-end gap-2">
            {[0, 1, 2].map((tile) => (
              <div
                key={tile}
                className="ghost-tile rise flex h-16 flex-1 flex-col justify-end gap-1.5 p-2"
                style={{ animationDelay: `${tile * 70}ms` }}
              >
                <span className={`h-1.5 w-2/3 rounded-full ${tile === 0 ? "bg-accent/25" : "bg-white/12"}`} />
                <span className="h-1 w-1/2 rounded-full bg-white/8" />
              </div>
            ))}
          </div>
          <svg aria-hidden viewBox="0 0 240 56" fill="none" className="rise w-60" style={{ animationDelay: "140ms" }}>
            <path
              className="ghost-draw"
              d="M4 44 C 40 40, 56 18, 88 22 S 140 46, 168 34 208 8, 236 14"
              stroke="rgb(0 242 254 / 30%)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="320"
            />
            <circle cx="236" cy="14" r="2.5" fill="rgb(0 242 254 / 55%)" />
          </svg>
          <div className="rise" style={{ animationDelay: "220ms" }}>
            <p className="meta">
              {datasetActive ? INSIGHTS_EMPTY_STATE.datasetActive : INSIGHTS_EMPTY_STATE.noDataset}
            </p>
            {datasetState.kind === "active" && datasetState.datasetId === "saas_churn" && (
              <p className="mt-2">
                <button type="button" className="button-run" onClick={() => void runCanonicalChurnAnalysis()}>
                  <span aria-hidden>⚡</span> Run the sample analysis
                </button>
              </p>
            )}
          </div>
        </div>
      );
    }
    case "unavailable":
      return <UnavailableArtifact artifactId={artifact.artifactId} reason={artifact.reason} />;
    case "artifact": {
      const { insights } = artifact;
      // The velocity line is measured, never a promised constant (prd.md §8):
      // the artifact's own executionMs, and the source row count only when
      // the source dataset is still the active one.
      const source =
        artifact.artifact.source.kind === "dataset" &&
        datasetState.kind === "active" &&
        datasetState.datasetId === artifact.artifact.source.id
          ? datasetState
          : null;
      return (
        <div className="view-swap flex h-full flex-col gap-4 overflow-y-auto p-3">
          <p className="meta" data-velocity>
            <span aria-hidden>⚡</span> measured{" "}
            <span className="mono-value">{insights.metrics.executionMs.toFixed(1)} ms</span> in-worker
            {source && (
              <>
                {" · scanned "}
                <span className="mono-value">{source.rowCount.toLocaleString("en-US")}</span> rows
              </>
            )}
          </p>
          {insights.kpis.length > 0 && (
            <div className="grid grid-cols-3 gap-2.5">
              {insights.kpis.map((kpi) => (
                <KpiTile key={kpi.column} kpi={kpi} />
              ))}
            </div>
          )}
          {insights.chart && (
            <section aria-label="Chart" className="ghost-tile flex flex-col gap-1.5 px-3 py-3">
              <header className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-[13px] font-medium text-ink">
                  {insights.chart.title ?? `${insights.chart.y} by ${insights.chart.x}`}
                </h3>
                {insights.chartDownsampled && (
                  <p className="text-xs text-amber">
                    Downsampled for the canvas: showing {insights.metrics.chartPoints} of{" "}
                    {insights.metrics.materializedRows} result rows.
                  </p>
                )}
              </header>
              <Suspense fallback={<div className="flex h-[280px] items-center justify-center"><p className="meta">Loading chart…</p></div>}>
                <EvidenceChart insights={insights} />
              </Suspense>
            </section>
          )}
        </div>
      );
    }
  }
}
