import type { ArtifactSummary } from "../analysis-artifacts/schemas";
import { formatKpiValue } from "./kpi";

/**
 * Shared fallback state for the evidence views (grilling 32): an artifact
 * whose relation retention evicted — or an id nothing points at — discloses
 * the eviction instead of rendering a dead reference. The full evidence
 * views bind to the same `projectArtifact` view.
 */
export function UnavailableArtifact({
  artifactId,
  reason,
}: {
  artifactId: string;
  reason: "not_found" | "relation_evicted";
}) {
  return (
    <div className="view-swap empty-state">
      <p className="mono-value text-sm">{artifactId}</p>
      <p className="meta mt-2">
        {reason === "relation_evicted"
          ? "Its materialized relation was evicted by retention — the metadata and lineage remain, the rows do not."
          : "No artifact with that id exists in this tab."}
      </p>
    </div>
  );
}

/**
 * One measured KPI tile (grilling 52): 12px uppercase label, Geist 24px
 * semibold tabular-nums value through the pinned format→renderer table.
 * Insights and the suppression panel's released aggregates share it.
 */
export function KpiTile({ kpi }: { kpi: ArtifactSummary["kpis"][number] }) {
  return (
    <div className="ghost-tile flex min-w-0 flex-col gap-1 px-3 py-2.5">
      <span className="truncate text-xs uppercase tracking-[0.08em] text-ink-secondary">{kpi.label}</span>
      <span className="font-ui text-2xl font-semibold tabular-nums text-ink">
        {formatKpiValue(kpi.value, kpi.format)}
      </span>
    </div>
  );
}
