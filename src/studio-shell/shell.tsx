import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { PRESET_CARD_SOURCES, type PresetId } from "../demo-presets/catalog";
import { ToolNameSchema } from "../agent-control-plane/envelope";
import type { ErrorCode, OperationSummary } from "../revisioned-workspace/schemas";
import { ERROR_RECOVERY_MESSAGE, ERROR_RECOVERY_MOVE } from "../revisioned-workspace/schemas";
import { projectWorkspace } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";
import {
  cancelActiveOperation,
  selectArtifact,
  activatePreset,
  runCanonicalChurnAnalysis,
  importLocalFile,
} from "../live-canvas/human-commands";
import { formatKpiValue } from "../live-canvas/kpi";
import { ImportPanel } from "../live-canvas/import-panel";
import { captureRunIntent, captureWorkbenchPrefill, consumeInitialView, resolvePostCommitView } from "../live-canvas/view-intent";
import { CustodyView } from "../live-canvas/custody-view";
import { DataGridView } from "../live-canvas/data-grid-view";
import { InsightsView } from "../live-canvas/insights-view";
import { SqlLineageView } from "../live-canvas/sql-lineage-view";
import { WorkbenchView } from "../live-canvas/query-workbench/workbench-view";
import "./shell.css";

/**
 * The production shell (stage 4): two panes — Controls and Results — with
 * the locked card set (Datasets · Run an analysis · Saved results ·
 * Activity) and the plain-language layer. Every card interaction is a named
 * dispatch; tab clicks never dispatch. The v0 chrome (FIRST ANALYSIS /
 * CONTEXT / CUSTODY cards, the workspace-id and available-preset lines) is
 * gone: the header keeps title · rev · dataset · the 0-Bytes badge, with the
 * served agent surface moved into the capability chip's tooltip.
 */

const VIEWS = {
  insights: { label: "Charts", View: InsightsView },
  query: { label: "Query", View: WorkbenchView },
  grid: { label: "Rows", View: DataGridView },
  sql_lineage: { label: "SQL & Lineage", View: SqlLineageView },
  custody: { label: "Zero Upload", View: CustodyView },
};

type ViewId = keyof typeof VIEWS;

const VIEW_ORDER: readonly ViewId[] = ["insights", "query", "grid", "sql_lineage", "custody"];

/** The preset chips in display order — read from the catalog, ids and policies one spelling. */
const PRESETS = PRESET_CARD_SOURCES;

/** Chip display line, composed from the catalog's own size facts. */
function presetMeta(entry: (typeof PRESETS)[number]): string {
  const { preset } = entry;
  return `${Math.round(preset.rowCount / 1000)}k rows · ~${(preset.byteSizeEstimate / 1_000_000).toFixed(1)} MB`;
}

/** Operation kind → the pill's human label; the exact command/tool name rides the tooltip. */
const LABEL_FOR_KIND: Record<OperationSummary["kind"], { label: string; title: string }> = {
  activate_dataset: {
    label: "Activate dataset",
    title: ToolNameSchema.enum.duckdb_activate_dataset,
  },
  run_analysis: {
    label: "Run analysis",
    title: ToolNameSchema.enum.duckdb_execute_sql_to_canvas,
  },
  import_local_file: { label: "Import file", title: "importLocalFile" },
};

/** The plain-language policy labels; the header dataset line stays verbatim (BDD pins it). */
const POLICY_LABEL: Record<string, string> = {
  public_synthetic: "Public data",
  sensitive_aggregate_only: "Sensitive — totals only",
};

function policyChip(policy: string): string {
  return policy === "sensitive_aggregate_only" ? "chip-policy-sensitive" : "chip-policy-public";
}

/** Hairline arrow for the preset CTAs — 1.5px strokes, no icon library. */
function ArrowGlyph() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden className="size-3">
      <path d="M3.5 8.5 8.5 3.5M8.5 3.5H4.5M8.5 3.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Rise-in delay helper: reading order drives the first-paint stagger. */
const rise = (delayMs: number): CSSProperties => ({ "--rise-delay": `${delayMs}ms` }) as CSSProperties;

/**
 * View switches morph the panel island where the platform supports it;
 * reduced motion and missing support fall back to the remount keyframe.
 */
function switchView(setView: (next: ViewId) => void): (next: ViewId) => void {
  const canTransition =
    typeof document !== "undefined" &&
    "startViewTransition" in document &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (next) => {
    if (!canTransition) {
      setView(next);
      return;
    }
    document.startViewTransition(() => {
      flushSync(() => setView(next));
    });
  };
}

/** Measured runtime for a settled operation, read from its own timestamps. */
function measuredRuntime(operation: OperationSummary): string | null {
  if (operation.finishedAt === undefined) return null;
  const ms = new Date(operation.finishedAt).getTime() - new Date(operation.startedAt).getTime();
  return `${ms} ms`;
}

/**
 * The two-pane evidence chrome (prd §7) rendered by the single projection
 * owner (ADR 0005 am3): the header and left-pane cards read
 * `projectWorkspace`, the right pane's views read `projectArtifact` — no
 * second projection. Every card interaction is a named dispatch.
 */
export function WorkspaceShell() {
  const [activeView, setActiveView] = useState<ViewId>("insights");
  const vm = useWorkspace(projectWorkspace);
  const { View } = VIEWS[activeView];
  const tabRefs = useRef<Map<ViewId, HTMLButtonElement | null>>(new Map());
  const appliedRuns = useRef<Set<string>>(new Set());
  const switchTo = switchView(setActiveView);
  /**
   * The human dispatches' rejected envelopes (grilling 61: "the envelope
   * teaches"). Canvas-local echo only — the strip renders in Activity
   * whenever a dispatch is rejected and clears when the workspace next
   * succeeds.
   */
  const [dispatchFailure, setDispatchFailure] = useState<{ code: ErrorCode } | null>(null);

  // The post-commit tab (grilling 52): the human adapter's captured
  // `initialView` applies once per succeeded analysis, else §4.5 inference.
  // Tab state stays canvas-local — this never dispatches.
  useEffect(() => {
    const latest = vm.operations[0];
    if (
      !latest ||
      latest.kind !== "run_analysis" ||
      latest.status !== "succeeded" ||
      latest.artifactId === undefined ||
      appliedRuns.current.has(latest.operationId)
    ) {
      return;
    }
    appliedRuns.current.add(latest.operationId);
    const card = vm.artifactCards.find((entry) => entry.artifactId === latest.artifactId);
    setActiveView(
      resolvePostCommitView(consumeInitialView(), {
        policy: card?.policy ?? "",
        hasChart: card?.hasChart ?? false,
        kpiCount: card?.kpis.length ?? 0,
      }),
    );
  }, [vm.operations, vm.artifactCards]);

  const onTablistKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = VIEW_ORDER.indexOf(activeView);
    const next =
      event.key === "ArrowRight"
        ? VIEW_ORDER[(current + 1) % VIEW_ORDER.length]
        : event.key === "ArrowLeft"
          ? VIEW_ORDER[(current - 1 + VIEW_ORDER.length) % VIEW_ORDER.length]
          : event.key === "Home"
            ? VIEW_ORDER[0]
            : event.key === "End"
              ? VIEW_ORDER[VIEW_ORDER.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    switchTo(next);
    tabRefs.current.get(next)?.focus();
  };

  // Grilling 53.4: the amber pulse is painted from the operation stream
  // alone — `verifyCustody` and every read leave it untouched.
  const operationsLive = vm.operations.some(
    (operation) => operation.status === "queued" || operation.status === "running",
  );
  /** The newest running-or-failed operation auto-expands (grilling 53). */
  const expandedOperation = vm.operations.find(
    (operation) => operation.status === "running" || operation.status === "failed",
  );
  const runtime = expandedOperation ? measuredRuntime(expandedOperation) : null;

  /**
   * The newest settled operation, phrased for the status live region beside
   * the operation stream: the visible pill carries the outcome as a color
   * dot alone, so the settlement is announced, never only painted.
   */
  const settledOperation =
    vm.operations[0]?.status === "succeeded" || vm.operations[0]?.status === "failed"
      ? vm.operations[0]
      : null;
  const settledAnnouncement = settledOperation
    ? [
        LABEL_FOR_KIND[settledOperation.kind].label,
        settledOperation.status,
        settledOperation.artifactId ? `— result ${settledOperation.artifactId}` : null,
        settledOperation.status === "failed" ? `— ${settledOperation.errorCode ?? "failed"}` : null,
        runtime,
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  /**
   * The projection facts: the active dataset highlights its preset card.
   * Neither gates a dispatch — grilling 61 keeps every gesture enabled so
   * the envelope teaches recovery.
   */
  const activeDatasetId = vm.datasetState.kind === "active" ? vm.datasetState.datasetId : null;
  const nativeSurface = vm.capabilities.includes("webmcp_native");
  const surfaceTitle = nativeSurface
    ? "The served agent surface: webmcp_native — the page's tools are registered with the browser"
    : "The served agent surface: simulator_only — the built-in simulator drives the same workspace";

  /** One dispatch per click; the envelope's verdict echoes in the canvas. */
  const activate = (datasetId: PresetId) => {
    const pending = activatePreset(datasetId, vm.revision);
    void pending.then((verdict) => {
      setDispatchFailure(verdict.ok ? null : { code: verdict.code });
    });
  };

  /** Refinement hands the statement and the artifact source to the Query tab. */
  const refineFrom = (artifactId: string, relationName: string) => {
    captureWorkbenchPrefill({
      sql: `SELECT * FROM ${relationName}`,
      source: { kind: "artifact", id: artifactId },
    });
    captureRunIntent({ presentation: { initialView: "query" } });
    switchTo("query");
  };

  return (
    <div className="relative flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <div aria-hidden className="lamp-field" />
      <header className="relative z-30 px-5 pt-4">
        <div className="glass-island rise flex flex-wrap items-center gap-4 px-4 py-2.5">
          <h1 className="title shrink-0">DuckStudio</h1>
          <p aria-live="polite" className="meta whitespace-nowrap">
            <span className="mono-value">rev {vm.revision}</span>
            <span aria-hidden> · </span>
            {vm.datasetLine}
          </p>
          <span className="badge-zero-upload">
            <span aria-hidden className={`badge-dot ${operationsLive ? "badge-dot-live" : ""}`} />
            {vm.badge}
          </span>
          <span
            role="group"
            aria-label="Agent capability"
            title={surfaceTitle}
            className="chip-capability"
          >
            <span aria-hidden className={`agent-dot ${nativeSurface ? "agent-dot-native" : "agent-dot-simulator"}`} />
            <span className="meta">{nativeSurface ? "agent connected" : "built-in agent"}</span>
          </span>
        </div>
      </header>
      <main className="relative z-10 grid flex-1 grid-cols-1 gap-4 px-5 pt-4 pb-5 lg:min-h-0 lg:grid-cols-[35%_65%]">
        <section aria-label="Controls" className="pr-1 lg:min-h-0 lg:overflow-y-auto">
          <h2 className="pane-label rise" style={rise(60)}>
            CONTROLS
          </h2>
          <div role="group" aria-label="Datasets" className="rise mt-3 space-y-2" style={rise(100)}>
            <h3 className="card-label">DATASETS</h3>
            <p id="preset-status" className="meta">
              Drop a CSV to make it the active dataset, or click a preset to swap in demo data — in this tab's memory
              only; rows never leave the browser.
            </p>
            {/* Slice 7 leads (issue #82): bringing your own file is the
               dataset story's entry point; presets follow. */}
            <ImportPanel importFile={(file) => importLocalFile(file, vm.revision)} />
            {PRESETS.map((entry) => {
              const isActive = activeDatasetId === entry.preset.datasetId;
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-label={`Activate dataset ${entry.preset.datasetId} · ${entry.preset.policy} policy`}
                  aria-pressed={isActive}
                  aria-describedby="preset-status"
                  onClick={() => activate(entry.id)}
                  className={isActive ? "preset-card preset-card-active" : "preset-card"}
                >
                  <span className="card-core flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="mono-value block text-sm">{entry.preset.datasetId}</span>
                      <span className="meta mt-1 block">{presetMeta(entry)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        className={policyChip(entry.preset.policy)}
                        title={`${entry.preset.policy} — ${POLICY_LABEL[entry.preset.policy]}`}
                      >
                        {POLICY_LABEL[entry.preset.policy]}
                      </span>
                      {isActive ? (
                        <span className="chip-active">ACTIVE</span>
                      ) : (
                        <span aria-hidden className="preset-arrow opacity-60">
                          <ArrowGlyph />
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div role="group" aria-label="Run an analysis" className="card-panel rise mt-2" style={rise(130)}>
            <div className="card-core">
              <h3 className="card-label">RUN AN ANALYSIS</h3>
              <button
                type="button"
                className="button-run"
                onClick={() => {
                  void runCanonicalChurnAnalysis();
                }}
              >
                <span aria-hidden>⚡</span> Analyze churn against support tickets.
              </button>
              <p className="meta mt-1.5">
                One prompt, two calls — the same commands, budgets, and custody as the agent. To write your own SQL,
                open the <span className="text-ink">Query</span> tab.
              </p>
            </div>
          </div>
          <div role="group" aria-label="Saved results" className="card-panel rise mt-2" style={rise(160)}>
            <div className="card-core">
              <h3 className="card-label">SAVED RESULTS</h3>
              {vm.artifactCards.length === 0 ? (
                <p className="meta mt-1.5">No results yet. Run an analysis and it appears here.</p>
              ) : (
                <ul className="mt-1.5 space-y-1.5">
                  {vm.artifactCards.map((card) => (
                    <li key={card.artifactId}>
                      {card.evicted ? (
                        // Grilling 32/51 item 4: eviction discloses; the
                        // metadata remains, the rows do not.
                        <p className="meta">
                          <span className="mono-value">{card.artifactId}</span> cleaned up to save space — run the
                          analysis again
                        </p>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`artifact-card ${card.selected ? "artifact-card-selected" : ""}`}
                            aria-pressed={card.selected}
                            onClick={() => selectArtifact(card.artifactId, vm.revision)}
                          >
                            <span className="block text-sm text-ink">
                              {card.sourceId} · {card.rowCount.toLocaleString("en-US")} rows
                            </span>
                            <span className="meta mt-0.5 block">
                              <span className="mono-value">{card.artifactId}</span> · {card.releaseStatus}
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-1.5">
                              {card.kpis.map((kpi) => (
                                <span key={kpi.column} className="chip-kpi">
                                  {kpi.label} <span className="mono-value">{formatKpiValue(kpi.value, kpi.format)}</span>
                                </span>
                              ))}
                              <span className={policyChip(card.policy)} title={card.policy}>
                                {POLICY_LABEL[card.policy]}
                              </span>
                            </span>
                          </button>
                          {card.selected && (
                            <button
                              type="button"
                              className="button-recovery mt-1"
                              title={`Refines from ${card.artifactId}'s relation ${card.relationName} in the Query tab`}
                              onClick={() => refineFrom(card.artifactId, card.relationName)}
                            >
                              Refine from this result
                            </button>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div role="group" aria-label="Activity" className="card-operation rise mt-2" style={rise(220)}>
            <div className="card-operation-core">
              <h3 className="card-label">ACTIVITY</h3>
              {vm.operations.length === 0 ? (
                <p className="meta mt-1.5">Nothing running yet. Analyses appear here while they run.</p>
              ) : (
                <>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Operation stream">
                    {vm.operations.map((operation) => (
                      <li
                        key={operation.operationId}
                        className={`chip-operation op-${operation.status}`}
                        title={`${LABEL_FOR_KIND[operation.kind].title} · ${operation.operationId}`}
                      >
                        <span aria-hidden className="op-dot" />
                        <span>{LABEL_FOR_KIND[operation.kind].label}</span>
                        <span className="sr-only">{operation.status}</span>
                      </li>
                    ))}
                  </ul>
                  {/* Persistent polite region: the text change is what a
                      screen reader announces, so it never unmounts while
                      operations exist. */}
                  <p role="status" className="sr-only">
                    {settledAnnouncement}
                  </p>
                  {expandedOperation && (
                    <div className={`operation-card ${expandedOperation.status === "failed" ? "operation-card-failed" : ""}`}>
                      <p className="meta flex items-center gap-2">
                        <span className={`chip-operation op-${expandedOperation.status}`}>
                          <span aria-hidden className="op-dot" />
                          <span>{LABEL_FOR_KIND[expandedOperation.kind].label}</span>
                        </span>
                        <span className="mono-value">{expandedOperation.status}</span>
                        {runtime && (
                          <>
                            <span aria-hidden> · </span>
                            <span className="mono-value">{runtime}</span>
                          </>
                        )}
                      </p>
                      <p className="meta mt-1" title={expandedOperation.operationId}>
                        {expandedOperation.kind === "import_local_file" && expandedOperation.sourceId && (
                          <>
                            importing <span className="mono-value">{expandedOperation.sourceId}</span>
                            <span aria-hidden> · </span>
                          </>
                        )}
                        {expandedOperation.sourceId && expandedOperation.kind !== "import_local_file" && (
                          <>
                            source <span className="mono-value">{expandedOperation.sourceId}</span>
                            <span aria-hidden> · </span>
                          </>
                        )}
                        {expandedOperation.artifactId && (
                          <>
                            result <span className="mono-value">{expandedOperation.artifactId}</span>
                          </>
                        )}
                      </p>
                      {expandedOperation.status === "failed" ? (
                        <>
                          <p className="mt-1.5 flex items-center gap-2">
                            <span className="chip-error">{expandedOperation.errorCode}</span>
                            <span className="meta">{expandedOperation.errorCode ? ERROR_RECOVERY_MESSAGE[expandedOperation.errorCode] : ""}</span>
                          </p>
                          <p className="meta mt-1">{expandedOperation.errorCode ? ERROR_RECOVERY_MOVE[expandedOperation.errorCode] : ""}</p>
                        </>
                      ) : (
                        (expandedOperation.status === "running" || expandedOperation.status === "queued") && (
                          <>
                            {expandedOperation.kind === "import_local_file" && (
                              <p className="meta mt-1">
                                Importing <span className="mono-value">{expandedOperation.sourceId}</span>… it stays in this tab.
                              </p>
                            )}
                            <p className="mt-1.5">
                              <button
                                type="button"
                                className="button-recovery"
                                onClick={() => cancelActiveOperation(vm.revision)}
                              >
                                Cancel
                              </button>
                            </p>
                          </>
                        )
                      )}
                    </div>
                  )}
                  {/* Grilling 61: a rejected dispatch renders the standard
                      recovery card — live operation or not. */}
                  {dispatchFailure && (
                    <div className="operation-card operation-card-failed">
                      <p className="mt-1.5 flex items-center gap-2">
                        <span className="chip-error">{dispatchFailure.code}</span>
                        <span className="meta">{ERROR_RECOVERY_MESSAGE[dispatchFailure.code]}</span>
                      </p>
                      <p className="meta mt-1">{ERROR_RECOVERY_MOVE[dispatchFailure.code]}</p>
                    </div>
                  )}
                </>
              )}
              <p className="meta mt-2 border-t border-edge/60 pt-1.5">
                Time limit: {Math.round(vm.budgets.executionMs / 1000)} s
                <span aria-hidden> · </span>
                Row limit: {vm.budgets.resultRows.toLocaleString("en-US")}
              </p>
            </div>
          </div>
        </section>
        <section aria-label="Results" className="flex min-h-0 flex-col">
          <h2 className="pane-label rise" style={rise(140)}>
            RESULTS
          </h2>
          <div
            role="tablist"
            aria-label="Evidence views"
            className="rise mt-2 flex w-max max-w-full items-center gap-1 rounded-full border border-edge bg-canvas/80 p-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]"
            style={rise(200)}
            onKeyDown={onTablistKeyDown}
          >
            {VIEW_ORDER.map((id) => (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current.set(id, el);
                }}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={id === activeView}
                aria-controls={`panel-${id}`}
                tabIndex={id === activeView ? 0 : -1}
                onClick={() => switchTo(id)}
                className={`tab-evidence ${
                  id === activeView ? "tab-evidence-active" : "hover:bg-white/[0.04] hover:text-ink"
                }`}
              >
                {VIEWS[id].label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`panel-${activeView}`}
            aria-labelledby={`tab-${activeView}`}
            className="panel-evidence rise h-[70vh] min-h-0 flex-1 overflow-hidden lg:h-auto"
            style={rise(260)}
          >
            <div id="evidence-panel" className="h-full overflow-hidden p-1 text-sm">
              <div className="panel-evidence-core flex h-full min-h-0 flex-col">
                <View key={activeView} />
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
