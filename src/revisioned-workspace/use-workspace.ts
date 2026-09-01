import { useSyncExternalStore } from "react";
import { createWorkspaceStore, type WorkspaceStore } from "./store";
import type { Workspace } from "./schemas";

/**
 * The React binding for the workspace store (ticket 02's resolution): one
 * tab, one workspace, so this module owns the app instance and consumers
 * import the hook — nothing outside `revisioned-workspace/` calls
 * `subscribe` / `getSnapshot` directly (ADR 0004 am4).
 */
const workspaceStore: WorkspaceStore = createWorkspaceStore();

/**
 * Reads the workspace through a selector. Selectors are one-line
 * `projectWorkspace` / `projectArtifact` calls at the use site (ticket 06);
 * both projections memoize by last input, so the selected value is stable
 * across renders and `useSyncExternalStore` never loops.
 */
export function useWorkspace<T>(selector: (workspace: Workspace) => T): T {
  return useSyncExternalStore(
    workspaceStore.subscribe,
    () => selector(workspaceStore.getSnapshot()),
    () => selector(workspaceStore.getServerSnapshot()),
  );
}
