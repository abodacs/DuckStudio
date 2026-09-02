import { projectArtifact } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";

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
  }
}
