import { projectArtifact } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";
import { UnavailableArtifact } from "./artifact-states";
import { formatKpiValue } from "./kpi";
import { VirtualGrid } from "./virtual-grid";

/**
 * Data Grid evidence view (grilling 51): virtualized committed rows only
 * when an artifact exists and the policy permits; for
 * `sensitive_aggregate_only` the pinned suppression banner plus the legally
 * released data — KPI aggregates and column metadata — and zero raw rows,
 * ever. No-artifact and evicted states keep M0's honest-empty copy.
 */
export function DataGridView() {
  const artifact = useWorkspace((ws) => projectArtifact(ws, ws.selectedArtifactId));
  switch (artifact.kind) {
    case "no_artifact":
      return (
        <div className="view-swap empty-state">
          <div aria-hidden className="flex w-72 flex-col gap-1.5">
            {[56, 100, 78, 88].map((width, row) => (
              <div
                key={row}
                className="ghost-tile rise flex h-7 items-center gap-2 px-2.5"
                style={{ width: `${width}%`, animationDelay: `${row * 70}ms` }}
              >
                <span className={`size-1.5 rounded-full ${row === 0 ? "bg-accent/30" : "bg-white/12"}`} />
                <span className="h-1 flex-1 rounded-full bg-white/8" />
              </div>
            ))}
          </div>
          <div className="rise" style={{ animationDelay: "300ms" }}>
            <p className="meta">No artifact — the grid paints rows only from an approved artifact.</p>
            <p className="meta mt-1">Rows paint after your first analysis — nothing ambient, nothing preloaded.</p>
          </div>
        </div>
      );
    case "unavailable":
      return <UnavailableArtifact artifactId={artifact.artifactId} reason={artifact.reason} />;
    case "artifact":
      switch (artifact.grid.kind) {
        case "rows":
          return (
            <div className="view-swap flex min-h-0 flex-1 flex-col p-3">
              <VirtualGrid grid={artifact.grid} totalRows={artifact.artifact.rowCount} />
            </div>
          );
        case "suppressed":
          return (
            <div className="view-swap flex flex-col gap-4 p-3">
              <div role="alert" className="banner-suppressed">
                <p className="banner-suppressed-title">Data Grid — suppressed by policy</p>
                <p>
                  <span className="mono-value">{artifact.artifact.source.id}</span> is governed by{" "}
                  <span className="chip-policy-sensitive">{artifact.grid.policy}</span>.
                </p>
                <p>
                  Raw records never paint on the shared canvas. Only aggregates meeting{" "}
                  <span className="mono-value">k ≥ {artifact.grid.minimumCohortSize}</span> (
                  <span className="mono-value">minimumCohortSize</span>) are released.
                </p>
                <p>
                  Omitted direct identifiers:{" "}
                  {artifact.grid.omitted.length > 0 ? (
                    artifact.grid.omitted.map((name) => (
                      <span key={name} className="mono-value mr-1">{name}</span>
                    ))
                  ) : (
                    <span className="mono-value">none</span>
                  )}
                </p>
                <p>
                  Uploaded to network: <span className="mono-value">{artifact.grid.bytesUploaded} B</span> · Raw values
                  released: <span className="mono-value">{artifact.grid.rawValuesReleased}</span>
                </p>
              </div>
              {artifact.grid.kpis.length > 0 && (
                <section aria-label="Released aggregates" className="grid grid-cols-3 gap-2.5">
                  {artifact.grid.kpis.map((kpi) => (
                    <div key={kpi.column} className="ghost-tile flex min-w-0 flex-col gap-1 px-3 py-2.5">
                      <span className="truncate text-xs uppercase tracking-[0.08em] text-ink-secondary">{kpi.label}</span>
                      <span className="font-ui text-2xl font-semibold tabular-nums text-ink">
                        {formatKpiValue(kpi.value, kpi.format)}
                      </span>
                    </div>
                  ))}
                </section>
              )}
              <section aria-label="Column metadata" className="ghost-tile overflow-hidden">
                <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-x-3 border-b border-edge/60 px-3 py-1.5 text-xs uppercase tracking-[0.08em] text-ink-secondary">
                  <span>column</span>
                  <span>type</span>
                  <span>classification</span>
                  <span>omitted</span>
                </div>
                {artifact.grid.columns.map((column) => (
                  <div
                    key={column.name}
                    className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-x-3 border-b border-edge/40 px-3 py-1.5 text-xs last:border-b-0"
                  >
                    <span className="mono-value truncate">{column.name}</span>
                    <span className="meta">{column.type}</span>
                    <span className="meta">{column.classification}</span>
                    <span className="meta">{column.omitted ? "yes" : "—"}</span>
                  </div>
                ))}
              </section>
            </div>
          );
        case "hidden":
          return (
            <div className="view-swap empty-state">
              <p className="meta">The committed presentation withholds the grid — aggregates render in Insights.</p>
            </div>
          );
      }
  }
}
