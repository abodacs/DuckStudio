import { projectArtifact } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";
import { UnavailableArtifact } from "./artifact-states";

/**
 * SQL & Lineage evidence view. The ghost shows the shape of the record — a
 * statement block flowing into a lineage chain — as geometry, never text,
 * above the rule the view enforces.
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
    case "artifact":
      return (
        <div className="view-swap empty-state">
          <p className="mono-value text-sm">
            {artifact.artifact.artifactId} · {artifact.artifact.relationName}
          </p>
          <pre className="meta mt-2 overflow-x-auto whitespace-pre-wrap">{artifact.artifact.sql}</pre>
          <p className="meta mt-2">
            hash <span className="mono-value">{artifact.artifact.sqlHash.slice(0, 16)}…</span> · measured{" "}
            {artifact.artifact.metrics.executionMs.toFixed(1)} ms
          </p>
          <p className="meta mt-1">
            lineage:{" "}
            {artifact.artifact.lineage.map((entry) => `${entry.kind}:${entry.id}`).join(" → ")}
          </p>
        </div>
      );
  }
}
