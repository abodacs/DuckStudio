import { projectArtifact } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";

/** Custody evidence view — empty state per the shell decisions (ticket 06). */
export function CustodyView() {
  const artifact = useWorkspace((ws) => projectArtifact(ws, ws.selectedArtifactId));
  switch (artifact.kind) {
    case "no_artifact":
      return (
        <p className="view-swap flex min-h-36 flex-1 items-center justify-center text-center text-xs text-ink-secondary">
          No custody evidence yet — verification runs on artifacts.
        </p>
      );
  }
}
