import { workspaceStore } from "../revisioned-workspace/store";

/**
 * The one seam the canvas's human gestures dispatch through (§7.2, ticket
 * 55): artifact selection and Cancel are named workspace commands with fresh
 * idempotency keys — no private setters, no local selection state. The
 * fire-and-forget promise is the store's own envelope path; card UI reads
 * the committed state back through the projection, never the envelope.
 */

export function selectArtifact(artifactId: string, expectedRevision: number): void {
  void workspaceStore.dispatch({
    kind: "selectArtifact",
    input: { artifactId, expectedRevision, idempotencyKey: crypto.randomUUID() },
  });
}

export function cancelActiveOperation(expectedRevision: number): void {
  void workspaceStore.dispatch({
    kind: "cancelActiveOperation",
    input: { expectedRevision, idempotencyKey: crypto.randomUUID() },
  });
}
