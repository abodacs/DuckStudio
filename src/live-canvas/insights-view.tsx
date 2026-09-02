import { projectArtifact } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";
import { UnavailableArtifact } from "./artifact-states";

/**
 * Insights evidence view. The empty state is onboarding: an abstract ghost
 * of the KPI readout (geometry only — never fabricated values) above the
 * custody rule the view enforces, and the move that unlocks it.
 */
export function InsightsView() {
  const artifact = useWorkspace((ws) => projectArtifact(ws, ws.selectedArtifactId));
  switch (artifact.kind) {
    case "no_artifact":
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
            <p className="meta">No artifact — KPIs render only from a policy-approved artifact.</p>
            <p className="meta mt-1">Run a governed query and its readouts land here.</p>
          </div>
        </div>
      );
    case "unavailable":
      return <UnavailableArtifact artifactId={artifact.artifactId} reason={artifact.reason} />;
    case "artifact":
      return (
        <div className="view-swap empty-state">
          <p className="mono-value text-sm">
            {artifact.artifact.artifactId} · source {artifact.artifact.source.id} · {artifact.artifact.rowCount} rows
          </p>
          <dl className="meta mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4">
            {artifact.summary.kpis.map((kpi) => (
              <div key={kpi.column} className="contents">
                <dt>{kpi.label}</dt>
                <dd className="mono-value">{kpi.value === null ? "—" : kpi.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
  }
}
