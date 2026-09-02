import { projectArtifact } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";

/** Insights evidence view — empty state per the shell decisions (ticket 06). */
export function InsightsView() {
  const artifact = useWorkspace((ws) => projectArtifact(ws, ws.selectedArtifactId));
  switch (artifact.kind) {
    case "no_artifact":
      return (
        <p className="view-swap flex min-h-36 flex-1 items-center justify-center text-center text-xs text-ink-secondary">
          No artifact — KPIs render only from a policy-approved artifact.
        </p>
      );
  }
}
