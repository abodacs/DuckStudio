import { workspaceStore } from "../revisioned-workspace/store";
import { intakeTickets } from "../revisioned-workspace/intake-tickets";
import type { ErrorCode } from "../revisioned-workspace/schemas";
import { type PresetId } from "../demo-presets/catalog";
import type { PresentationSpec } from "../analysis-artifacts/schemas";
import { SAAS_CHURN_CANONICAL_SQL } from "../demo-presets/canonical-sql";
import { SAAS_CHURN_ANALYSIS_PRESENTATION } from "../demo-presets/presentations";
import { captureRunIntent, type EvidenceViewId } from "./view-intent";

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
 *
 * Slice 7 adds the file-drop gesture: the bytes stay in this tab, riding an
 * out-of-band one-shot intake ticket the store consumes inside the import's
 * execution — `importLocalFile` is a human-only domain command, never a
 * WebMCP tool.
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
 * The workbench run gesture (stage 4): one `runAnalysis` with the composed
 * presentation and the store's current revision — no dataset active still
 * dispatches, and the DATASET_UNAVAILABLE strip teaches (plan: the envelope
 * teaches). Bindings are empty by construction (values belong in the
 * statement's literals for a human-run exploration; the kernel redacts what
 * it must) and budget is omitted so the workspace defaults apply.
 */
export type WorkbenchVerdict =
  | { ok: true }
  | { ok: false; code: ErrorCode; message: string; details: Record<string, string | number | boolean | null> };

export async function runWorkbenchAnalysis(input: {
  source: { kind: "dataset" | "artifact"; id: string };
  sql: string;
  presentation?: PresentationSpec;
  initialView?: EvidenceViewId;
}): Promise<WorkbenchVerdict> {
  captureRunIntent({ presentation: input.initialView ? { initialView: input.initialView } : undefined });
  const envelope = await workspaceStore.dispatch({
    kind: "runAnalysis",
    input: {
      source: input.source,
      sql: input.sql,
      bindings: {},
      ...(input.presentation === undefined ? {} : { presentation: input.presentation }),
      expectedRevision: workspaceStore.getSnapshot().revision,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  return envelope.ok
    ? { ok: true }
    : { ok: false, code: envelope.error.code, message: envelope.error.message, details: envelope.error.details };
}

/**
 * The file-drop gesture (slice 7): reads the file's bytes in this tab, puts
 * them under a one-shot intake ticket, and dispatches `importLocalFile` with
 * the handle and the store's current revision — the bytes never travel in
 * the command and never leave the browser. Always enabled, no gating; the
 * envelope verdict returns so the dropzone can render the human sentence
 * beside the code chip (grilling 61: the envelope teaches).
 */
export type ImportFileVerdict = { ok: true } | { ok: false; code: ErrorCode; message: string };

export async function importLocalFile(file: File, expectedRevision: number): Promise<ImportFileVerdict> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { ticketId } = intakeTickets.put(file.name, bytes);
  try {
    const envelope = await workspaceStore.dispatch({
      kind: "importLocalFile",
      input: { ticketId, name: file.name, expectedRevision, idempotencyKey: crypto.randomUUID() },
    });
    return envelope.ok ? { ok: true } : { ok: false, code: envelope.error.code, message: envelope.error.message };
  } finally {
    // A rejected dispatch never executed, so the ticket would leak bytes;
    // an executed one already consumed it and this delete is a no-op.
    intakeTickets.delete(ticketId);
  }
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
