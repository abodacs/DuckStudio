import { projectArtifact } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";
import { UnavailableArtifact } from "./artifact-states";

/**
 * Custody evidence view. The ghost is the scope of verification —
 * concentric rings, one live center — as geometry, above the rule the view
 * enforces.
 */
export function CustodyView() {
  const artifact = useWorkspace((ws) => projectArtifact(ws, ws.selectedArtifactId));
  switch (artifact.kind) {
    case "no_artifact":
      return (
        <div className="view-swap empty-state">
          <div aria-hidden className="rise relative size-20">
            <span className="absolute inset-0 rounded-full border border-edge" />
            <span className="absolute inset-3 rounded-full border border-accent/20" />
            <span className="absolute top-1/2 left-1/2 size-2 -translate-1/2 rounded-full bg-accent/45" />
          </div>
          <div className="rise" style={{ animationDelay: "140ms" }}>
            <p className="meta">No custody evidence yet — verification runs on artifacts.</p>
            <p className="meta mt-1">Run verify after your first artifact to see the evidence.</p>
          </div>
        </div>
      );
    case "unavailable":
      return <UnavailableArtifact artifactId={artifact.artifactId} reason={artifact.reason} />;
    case "artifact":
      return (
        <div className="view-swap empty-state">
          <p className="mono-value text-sm">
            {artifact.artifact.artifactId} · release {artifact.artifact.release.status}
          </p>
          <p className="meta mt-2">
            rows to tools: <span className="mono-value">{artifact.artifact.release.rawRowsToAgent}</span> · cohort
            minimum <span className="mono-value">{artifact.artifact.release.cohortMinimum}</span>
          </p>
          {artifact.artifact.release.redactedBindingKeys.length > 0 ? (
            <p className="meta mt-1">
              redacted bindings:{" "}
              <span className="mono-value">{artifact.artifact.release.redactedBindingKeys.join(", ")}</span>
            </p>
          ) : null}
        </div>
      );
  }
}
