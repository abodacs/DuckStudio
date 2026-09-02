import { workspaceStore } from "../revisioned-workspace/store";
import type { ErrorCode } from "../revisioned-workspace/schemas";
import { type PresetId } from "../demo-presets/catalog";
import { SAAS_CHURN_CANONICAL_SQL } from "../demo-presets/canonical-sql";
import { SAAS_CHURN_ANALYSIS_PRESENTATION } from "../demo-presets/presentations";
import { captureRunIntent } from "./view-intent";

/**
 * The one seam the canvas's human gestures dispatch through (§7.2, ticket
 * 55): artifact selection and Cancel are named workspace commands with fresh
 * idempotency keys — no private setters, no local selection state. The
 * fire-and-forget promise is the store's own envelope path; card UI reads
 * the committed state back through the projection, never the envelope.
 *
 * Slice 6 adds the judge-path gestures (ticket 63, grilling 61's resolution):
 * preset cards and the one canonical prompt chip dispatch the same domain
 * commands a WebMCP agent dispatches — the chip scripts the exact §12
 * playbook, `duckdb_get_context` → `duckdb_execute_sql_to_canvas`,
 * pill-for-pill with tape beats 3–4. Nothing here is a shortcut or a private
 * path.
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

/**
 * A preset card gesture (grilling 61): one `activateDataset` command with
 * the store's current `expectedRevision` and a fresh key — always enabled,
 * no gating; a click while an operation runs dispatches anyway and the
 * `OPERATION_CONFLICT` envelope teaches recovery, exactly as an agent sees.
 * The envelope promise is returned so the shell can echo a rejected
 * dispatch's recovery card — never a private path, never a second dispatch.
 */
export function activatePreset(
  datasetId: PresetId,
  expectedRevision: number,
): Promise<{ ok: true } | { ok: false; code: ErrorCode }> {
  return workspaceStore
    .dispatch({
      kind: "activateDataset",
      input: { datasetId, expectedRevision, idempotencyKey: crypto.randomUUID() },
    })
    .then((envelope) =>
      envelope.ok
        ? ({ ok: true } as const)
        : ({ ok: false, code: envelope.error.code } as const),
    );
}

/**
 * The canonical prompt chip (grilling 61): the tape's exact prompt scripts
 * the pinned two-call sequence — one `getContext` summary read, then
 * `runAnalysis` with the canonical SQL and its matched presentation at the
 * revision the read returned. Reads pulse no chrome and commit nothing, so
 * the operation stream shows exactly the two pills the tape shows.
 */
export async function runCanonicalChurnAnalysis(): Promise<void> {
  const context = await workspaceStore.dispatch({
    kind: "getContext",
    input: { scope: "summary" },
  });
  if (!context.ok) return;
  captureRunIntent({ presentation: { initialView: "insights" } });
  await workspaceStore.dispatch({
    kind: "runAnalysis",
    input: {
      source: { kind: "dataset", id: "saas_churn" },
      sql: SAAS_CHURN_CANONICAL_SQL,
      bindings: {},
      presentation: SAAS_CHURN_ANALYSIS_PRESENTATION,
      expectedRevision: context.revision,
      idempotencyKey: crypto.randomUUID(),
    },
  });
}
