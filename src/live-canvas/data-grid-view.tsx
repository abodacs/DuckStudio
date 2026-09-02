import { projectArtifact } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";

/** Data Grid evidence view — empty state per the shell decisions (ticket 06). */
export function DataGridView() {
  const artifact = useWorkspace((ws) => projectArtifact(ws, ws.selectedArtifactId));
  switch (artifact.kind) {
    case "no_artifact":
      return (
        <p className="view-swap empty-state">
          No artifact — the grid paints rows only from an approved artifact.
        </p>
      );
  }
}
