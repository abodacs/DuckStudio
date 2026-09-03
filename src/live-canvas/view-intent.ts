/**
 * The human evidence plane's dispatch-time captures (grilling 52 item 4).
 * The envelope carries no `initialView` and the store ignores it, so the
 * human adapter captures `presentation.initialView` from the command input
 * at dispatch; the canvas applies it on `analysis_succeeded`, else §4.5
 * inference. `POLICY_DENIED`'s `permittedPresentation` hint is captured the
 * same way, from the failure envelope at dispatch. Module-local, one shot
 * per run — never workspace state, never a second projection.
 */

export type EvidenceViewId = "insights" | "query" | "grid" | "sql_lineage" | "custody";

let capturedInitialView: EvidenceViewId | undefined;
let capturedPolicyHint: string | undefined;

/** Human-adapter seam: capture the run's `initialView` from its command input. */
export function captureRunIntent(input: {
  presentation?: { initialView?: EvidenceViewId } | undefined;
}): void {
  capturedInitialView = input.presentation?.initialView;
}

/** One-shot read: the captured view, then gone. */
export function consumeInitialView(): EvidenceViewId | undefined {
  const view = capturedInitialView;
  capturedInitialView = undefined;
  return view;
}

/** Human-adapter seam: capture the hint from a `POLICY_DENIED` failure envelope. */
export function capturePolicyHint(details: { permittedPresentation?: unknown } | undefined): void {
  if (details && typeof details.permittedPresentation === "string") {
    capturedPolicyHint = details.permittedPresentation;
  }
}

/** Read for the recovery card; the latest capture wins (one operation at a time). */
export function peekPolicyHint(): string | undefined {
  return capturedPolicyHint;
}

/**
 * The workbench prefill capture (stage 4): "Refine from this result" on a
 * saved result captures the statement and artifact source; the workbench tab
 * consumes it when it mounts. Canvas-local, one shot — never workspace state.
 */
let capturedWorkbenchPrefill: { sql: string; source: { kind: "dataset" } | { kind: "artifact"; id: string } } | undefined;

export function captureWorkbenchPrefill(prefill: {
  sql: string;
  source: { kind: "dataset" } | { kind: "artifact"; id: string };
}): void {
  capturedWorkbenchPrefill = prefill;
}

/** One-shot read: the captured prefill, then gone. */
export function consumeWorkbenchPrefill():
  | { sql: string; source: { kind: "dataset" } | { kind: "artifact"; id: string } }
  | undefined {
  const prefill = capturedWorkbenchPrefill;
  capturedWorkbenchPrefill = undefined;
  return prefill;
}

/**
 * The post-commit tab rule (grilling 52, §4.5): the captured `initialView`
 * wins unless it asks for a grid the policy forbids; otherwise inference —
 * `insights` when a KPI or chart remains, else `sql_lineage`. Never a
 * dispatch, never `grid` for `sensitive_aggregate_only`.
 */
export function resolvePostCommitView(
  requested: EvidenceViewId | undefined,
  card: { policy: string; hasChart: boolean; kpiCount: number },
): EvidenceViewId {
  if (requested && !(requested === "grid" && card.policy === "sensitive_aggregate_only")) {
    return requested;
  }
  return card.hasChart || card.kpiCount > 0 ? "insights" : "sql_lineage";
}
