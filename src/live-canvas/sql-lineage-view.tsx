import { projectArtifact } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";
import { UnavailableArtifact } from "./artifact-states";

/**
 * SQL & Lineage evidence view (§13): the exact statement, the redacted
 * bindings, the hash, the source, the chain, the release decision, and the
 * measured metrics — all from the projection's lineage member.
 */
export function SqlLineageView() {
  const artifact = useWorkspace((ws) => projectArtifact(ws, ws.selectedArtifactId));
  switch (artifact.kind) {
    case "no_artifact":
      return (
        <div className="view-swap empty-state">
          <div aria-hidden className="flex w-72 flex-col gap-1.5">
            <div className="ghost-tile rise flex flex-col gap-2 p-3">
              <span className="h-1.5 w-3/4 rounded-full bg-white/12" />
              <span className="h-1.5 w-1/2 rounded-full bg-white/8" />
              <span className="h-1.5 w-2/3 rounded-full bg-accent/20" />
            </div>
            <div className="rise flex items-center gap-1.5 px-1" style={{ animationDelay: "140ms" }}>
              <span className="size-1.5 rounded-full bg-white/25" />
              <span className="h-px flex-1 bg-edge" />
              <span className="size-1.5 rounded-full bg-white/25" />
              <span className="h-px flex-1 bg-edge" />
              <span className="size-1.5 rounded-full bg-accent/40" />
            </div>
          </div>
          <div className="rise" style={{ animationDelay: "220ms" }}>
            <p className="meta">No artifact — lineage appears with your first analysis.</p>
            <p className="meta mt-1">Every artifact carries its exact statement and chain.</p>
          </div>
        </div>
      );
    case "unavailable":
      return <UnavailableArtifact artifactId={artifact.artifactId} reason={artifact.reason} />;
    case "artifact": {
      const { lineage } = artifact;
      return (
        <div className="view-swap flex h-full flex-col gap-3 overflow-y-auto p-3">
          <p className="meta">
            <span className="mono-value">{artifact.artifact.artifactId}</span> ·{" "}
            <span className="mono-value">{artifact.artifact.relationName}</span>
          </p>
          <pre className="ghost-tile overflow-x-auto p-3 font-mono text-xs leading-5 text-ink">{lineage.sql}</pre>
          <dl className="meta grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
            <dt>hash</dt>
            <dd className="mono-value">{lineage.sqlHash.slice(0, 16)}…</dd>
            <dt>source</dt>
            <dd className="mono-value">
              {lineage.source.kind}:{lineage.source.id}
            </dd>
            <dt>measured</dt>
            <dd className="mono-value">
              {lineage.metrics.executionMs.toFixed(1)} ms · {lineage.metrics.materializedRows} rows ·{" "}
              {lineage.metrics.chartPoints} points
            </dd>
          </dl>
          {Object.keys(lineage.bindings).length > 0 && (
            <div>
              <h3 className="card-label">BINDINGS</h3>
              <dl className="meta mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
                {Object.entries(lineage.bindings).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="truncate">{key}</dt>
                    <dd className="mono-value">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <div>
            <h3 className="card-label">LINEAGE</h3>
            <p className="mono-value mt-1 text-xs">
              {[...lineage.chain, { kind: "artifact" as const, id: artifact.artifact.artifactId }]
                .map((entry) => `${entry.kind}:${entry.id}`)
                .join(" → ")}
            </p>
          </div>
          <div>
            <h3 className="card-label">RELEASE</h3>
            <p className="meta mt-1">
              <span className="chip-policy-public">{lineage.release.status}</span> · raw rows to tools{" "}
              <span className="mono-value">{lineage.release.rawRowsToAgent}</span> · to canvas{" "}
              <span className="mono-value">{lineage.release.rawRowsToSharedCanvas}</span> · cohort minimum{" "}
              <span className="mono-value">{lineage.release.cohortMinimum}</span>
            </p>
          </div>
        </div>
      );
    }
  }
}
