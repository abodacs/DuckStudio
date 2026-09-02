import { projectArtifact } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";

/**
 * Data Grid evidence view. The empty-state ghost previews the grid's
 * geometry — rows as glass bars, never painted values — above the custody
 * rule the view enforces.
 */
export function DataGridView() {
  const artifact = useWorkspace((ws) => projectArtifact(ws, ws.selectedArtifactId));
  switch (artifact.kind) {
    case "no_artifact":
      return (
        <div className="view-swap empty-state">
          <div aria-hidden className="flex w-72 flex-col gap-1.5">
            {[56, 100, 78, 88].map((width, row) => (
              <div
                key={row}
                className="ghost-tile rise flex h-7 items-center gap-2 px-2.5"
                style={{ width: `${width}%`, animationDelay: `${row * 70}ms` }}
              >
                <span className={`size-1.5 rounded-full ${row === 0 ? "bg-accent/30" : "bg-white/12"}`} />
                <span className="h-1 flex-1 rounded-full bg-white/8" />
              </div>
            ))}
          </div>
          <div className="rise" style={{ animationDelay: "300ms" }}>
            <p className="meta">No artifact — the grid paints rows only from an approved artifact.</p>
            <p className="meta mt-1">Rows paint after your first analysis — nothing ambient, nothing preloaded.</p>
          </div>
        </div>
      );
  }
}
