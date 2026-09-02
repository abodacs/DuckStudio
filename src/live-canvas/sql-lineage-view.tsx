import { projectArtifact } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";

/** SQL & Lineage evidence view — empty state per the shell decisions (ticket 06). */
export function SqlLineageView() {
  const artifact = useWorkspace((ws) => projectArtifact(ws, ws.selectedArtifactId));
  switch (artifact.kind) {
    case "no_artifact":
      return (
        <p className="view-swap empty-state">
          No artifact — lineage appears with your first analysis.
        </p>
      );
  }
}
