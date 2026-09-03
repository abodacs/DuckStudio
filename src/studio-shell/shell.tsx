import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { PRESET_CARD_SOURCES, saasChurnPreset, type PresetId } from "../demo-presets/catalog";
import { ToolNameSchema } from "../agent-control-plane/envelope";
import type { ErrorCode, OperationSummary } from "../revisioned-workspace/schemas";
import { ERROR_RECOVERY_MESSAGE, ERROR_RECOVERY_MOVE } from "../revisioned-workspace/schemas";
import { MONITORED_TRANSPORTS } from "../dataset-custody/schemas";
import { projectWorkspace } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";
import { cancelActiveOperation, selectArtifact, activatePreset, runCanonicalChurnAnalysis } from "../live-canvas/human-commands";
import { formatKpiValue } from "../live-canvas/kpi";
import { consumeInitialView, resolvePostCommitView } from "../live-canvas/view-intent";
import { CustodyView } from "../live-canvas/custody-view";
import { DataGridView } from "../live-canvas/data-grid-view";
import { InsightsView } from "../live-canvas/insights-view";
import { SqlLineageView } from "../live-canvas/sql-lineage-view";
import "./shell.css";

const VIEWS = {
  insights: { label: "Insights", View: InsightsView },
  grid: { label: "Data Grid", View: DataGridView },
  sql_lineage: { label: "SQL & Lineage", View: SqlLineageView },
  custody: { label: "Custody", View: CustodyView },
};

type ViewId = keyof typeof VIEWS;

const VIEW_ORDER: readonly ViewId[] = ["insights", "grid", "sql_lineage", "custody"];

/** Operation kind → the exact registered tool name (grilling 53). */
const TOOL_FOR_KIND: Record<OperationSummary["kind"], string> = {
  activate_dataset: ToolNameSchema.enum.duckdb_activate_dataset,
  run_analysis: ToolNameSchema.enum.duckdb_execute_sql_to_canvas,
};

/**
 * Rev-0 preset-chip chrome (ticket 10). The chips keep their static cards
 * until activation exists (Slice 2); every chip field reads the seeded
 * catalog, so ids and policies have one spelling.
 */
const PRESETS = PRESET_CARD_SOURCES;

/** Chip display line, composed from the catalog's own size facts. */
function presetMeta(entry: (typeof PRESETS)[number]): string {
  const { preset } = entry;
  return `${Math.round(preset.rowCount / 1000)}k rows · ~${(preset.byteSizeEstimate / 1_000_000).toFixed(1)} MB`;
}

/**
 * The first-run path (PRD §7.3 first paint): three moves to the aha —
 * governed evidence on glass while the badge still reads zero upload. The
 * moves are guidance, not chrome state: the current move derives from
 * workspace state, never from a tour counter.
 */
const FIRST_RUN_MOVES = [
  {
    id: "activate",
    label: "Activate a dataset",
    detail: "Pick a preset below — rows never leave this tab.",
  },
  {
    id: "ask",
    label: "Ask the agent",
    detail: "The simulator or native WebMCP runs governed SQL.",
  },
  {
    id: "read",
    label: "Read the evidence",
    detail: "KPIs, grid, SQL, and custody land on the right.",
  },
] as const;

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
 * Two-pane evidence chrome (PRD §7) rendered by the single projection owner
 * (ADR 0005 am3): the header and left-pane cards read `projectWorkspace`,
 * the right pane's views read `projectArtifact` — no second projection.
 * Every card interaction is a named dispatch; tab clicks never dispatch.
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
   * teaches"). Canvas-local echo only — the workspace never records a
   * rejected command, so the card renders while the operation it conflicted
   * with is live and disappears when the stream settles.
   */
  const [dispatchFailure, setDispatchFailure] = useState<{ code: ErrorCode } | null>(null);

  // A rejected dispatch echoes until the workspace next succeeds — the advice
  // is consumed by the move it teaches, so a later success clears the card.
  useEffect(() => {
    if (vm.operations[0]?.status === "succeeded") setDispatchFailure(null);
  }, [vm.operations]);

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

  // The current first-run move reads workspace state: activation promotes
  // move two, a settled artifact promotes move three. At rev 0 that is move
  // one — honestly, not by a tour counter.
  const currentMove =
    vm.recentArtifacts.length > 0 ? 2 : vm.datasetState.kind === "active" ? 1 : 0;

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
   * The judge-path surface facts (slice 6) read from the one projection:
   * the served capability names the header chip, and the active dataset
   * highlights its preset card. Neither gates a dispatch — grilling 61
   * keeps every gesture enabled so the envelope teaches recovery.
   */
  const activeDatasetId = vm.datasetState.kind === "active" ? vm.datasetState.datasetId : null;
  const nativeSurface = vm.capabilities.includes("webmcp_native");

  /** One dispatch per click; the envelope's verdict echoes in the canvas. */
  const activate = (datasetId: PresetId) => {
    const pending = activatePreset(datasetId, vm.revision);
    void pending.then((verdict) => {
      setDispatchFailure(verdict.ok ? null : { code: verdict.code });
    });
  };

  return (
    <div className="relative flex h-dvh min-w-[960px] flex-col overflow-hidden">
      <div aria-hidden className="lamp-field" />
      <header className="relative z-30 px-5 pt-4">
        <div className="glass-island rise flex items-center gap-4 px-4 py-2.5">
          <h1 className="title shrink-0">DuckStudio</h1>
          <p aria-live="polite" className="meta whitespace-nowrap">
            <span className="mono-value">{vm.workspaceId}</span>
            <span aria-hidden> · </span>
            <span className="mono-value">rev {vm.revision}</span>
            <span aria-hidden> · </span>
            {vm.datasetLine}
          </p>
          <p className="meta whitespace-nowrap">
            available preset{" "}
            <span className="mono-value">
              {saasChurnPreset.datasetId} · {saasChurnPreset.policy}
            </span>
          </p>
          <span className="badge-zero-upload">
            <span aria-hidden className={`badge-dot ${operationsLive ? "badge-dot-live" : ""}`} />
            {vm.badge}
          </span>
          <span
            aria-label="Agent capability"
            title="The served agent surface"
            className="chip-capability"
          >
            <span aria-hidden className={`agent-dot ${nativeSurface ? "agent-dot-native" : "agent-dot-simulator"}`} />
            <span className="mono-value">{nativeSurface ? "webmcp_native" : "simulator_only · same workspace"}</span>
          </span>
        </div>
      </header>
      <main className="relative z-10 grid min-h-0 flex-1 grid-cols-[35%_65%] gap-4 px-5 pt-4 pb-5">
        <section
          aria-label="Agent control and operations"
          className="min-h-0 overflow-y-auto pr-1"
        >
          <h2 className="pane-label rise" style={rise(60)}>
            AGENT CONTROL &amp; OPERATIONS
          </h2>
          <div
            role="group"
            aria-label="First analysis"
            className="card-panel rise mt-3"
            style={rise(100)}
          >
            <div className="card-core">
              <h3 className="card-label">FIRST ANALYSIS</h3>
              <ol className="mt-2.5 space-y-3">
                {FIRST_RUN_MOVES.map((move, index) => {
                  const isCurrent = index === currentMove;
                  return (
                    <li key={move.id} className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border font-display text-xs ${
                          isCurrent
                            ? "border-accent/40 bg-accent/[0.07] text-accent"
                            : "border-edge bg-white/[0.03] text-ink-secondary"
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={`block text-[13px] leading-5 ${isCurrent ? "text-ink" : "text-ink-secondary"}`}
                        >
                          {move.label}
                        </span>
                        <span className="meta mt-0.5 block">{move.detail}</span>
                      </span>
                      {isCurrent && <span className="sr-only">(current move)</span>}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
          <div role="group" aria-label="Run an analysis" className="card-panel rise mt-2" style={rise(130)}>
            <div className="card-core">
              <h3 className="card-label">ASK THE AGENT</h3>
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
                One prompt, two calls — <span className="mono-value">duckdb_get_context</span> then{" "}
                <span className="mono-value">duckdb_execute_sql_to_canvas</span>: the same commands, budgets, and
                custody as the agent.
              </p>
            </div>
          </div>
          <div role="group" aria-label="Workspace context" className="card-panel rise mt-2" style={rise(160)}>
            <div className="card-core">
              <h3 className="card-label">CONTEXT</h3>
              <p className="meta mt-1.5">
                <span className="mono-value">{vm.workspaceId}</span>
                <span aria-hidden> · </span>
                rev <span className="mono-value">{vm.revision}</span>
              </p>
              <p className="meta mt-1">dataset: {vm.datasetLine}</p>
              {vm.datasetState.kind === "active" && (
                <p className="meta mt-1">
                  safe schema:{" "}
                  <span className="mono-value">
                    {vm.datasetState.safeSchemaCount} of {vm.datasetState.schemaCount}
                  </span>{" "}
                  columns
                </p>
              )}
              <h4 className="card-label mt-2.5">BUDGETS</h4>
              <dl className="meta mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
                {Object.entries(vm.budgets).map(([knob, limit]) => (
                  <div key={knob} className="contents">
                    <dt>{knob}</dt>
                    <dd className="mono-value">{limit}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          <div role="group" aria-label="Operations" className="card-operation rise mt-2" style={rise(220)}>
            <div className="card-operation-core">
              <h3 className="card-label">OPERATIONS</h3>
              {vm.operations.length === 0 ? (
                <p className="meta mt-1.5">Nothing running yet. Analyses appear here while they run.</p>
              ) : (
                <>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Operation stream">
                    {vm.operations.map((operation) => (
                      <li key={operation.operationId} className={`chip-operation op-${operation.status}`}>
                        <span aria-hidden className="op-dot" />
                        <span className="font-mono">{TOOL_FOR_KIND[operation.kind]}</span>
                      </li>
                    ))}
                  </ul>
                  {expandedOperation && (
                    <div className={`operation-card ${expandedOperation.status === "failed" ? "operation-card-failed" : ""}`}>
                      <p className="meta flex items-center gap-2">
                        <span className={`chip-operation op-${expandedOperation.status}`}>
                          <span aria-hidden className="op-dot" />
                          <span className="font-mono">{TOOL_FOR_KIND[expandedOperation.kind]}</span>
                        </span>
                        <span className="mono-value">{expandedOperation.status}</span>
                        {runtime && (
                          <>
                            <span aria-hidden> · </span>
                            <span className="mono-value">{runtime}</span>
                          </>
                        )}
                      </p>
                      <p className="meta mt-1">
                        op <span className="mono-value">{expandedOperation.operationId}</span>
                        {expandedOperation.sourceId && (
                          <>
                            <span aria-hidden> · </span>source <span className="mono-value">{expandedOperation.sourceId}</span>
                          </>
                        )}
                        {expandedOperation.artifactId && (
                          <>
                            <span aria-hidden> · </span>artifact <span className="mono-value">{expandedOperation.artifactId}</span>
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
                          <p className="mt-1.5">
                            <button
                              type="button"
                              className="button-recovery"
                              onClick={() => cancelActiveOperation(vm.revision)}
                            >
                              Cancel
                            </button>
                          </p>
                        )
                      )}
                    </div>
                  )}
                </>
              )}
              {/* Grilling 61: a rejected preset dispatch (OPERATION_CONFLICT
                  and friends) renders the standard recovery card — live
                  operation or not; a failed dispatch with nothing running is
                  exactly when a dead click would otherwise hide it. */}
              {dispatchFailure && (
                <div className="operation-card operation-card-failed">
                  <p className="mt-1.5 flex items-center gap-2">
                    <span className="chip-error">{dispatchFailure.code}</span>
                    <span className="meta">{ERROR_RECOVERY_MESSAGE[dispatchFailure.code]}</span>
                  </p>
                  <p className="meta mt-1">{ERROR_RECOVERY_MOVE[dispatchFailure.code]}</p>
                </div>
              )}
            </div>
          </div>
          <div role="group" aria-label="Artifact stream" className="card-panel rise mt-2" style={rise(280)}>
            <div className="card-core">
              <h3 className="card-label">ARTIFACTS</h3>
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
                        <button
                          type="button"
                          className={`artifact-card ${card.selected ? "artifact-card-selected" : ""}`}
                          aria-pressed={card.selected}
                          onClick={() => selectArtifact(card.artifactId, vm.revision)}
                        >
                          <span className="mono-value block text-sm">{card.artifactId}</span>
                          <span className="meta mt-0.5 block">
                            source {card.sourceId} · {card.rowCount.toLocaleString("en-US")} rows ·{" "}
                            {card.releaseStatus}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            {card.kpis.map((kpi) => (
                              <span key={kpi.column} className="chip-kpi">
                                {kpi.label} <span className="mono-value">{formatKpiValue(kpi.value, kpi.format)}</span>
                              </span>
                            ))}
                            <span
                              className={card.policy === "sensitive_aggregate_only" ? "chip-policy-sensitive" : "chip-policy-public"}
                            >
                              {card.policy}
                            </span>
                          </span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div role="group" aria-label="Dataset presets" className="rise mt-3 space-y-2" style={rise(340)}>
            <h3 className="card-label">DATASETS</h3>
            <p id="preset-status" className="meta">
              Click a preset to activate it — in this tab's memory only; rows never leave the browser.
            </p>
            {PRESETS.map((entry) => {
              const isActive = activeDatasetId === entry.preset.datasetId;
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-label={`Activate dataset ${entry.preset.datasetId} · ${entry.preset.policy} policy`}
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
                        className={
                          entry.preset.policy === "sensitive_aggregate_only"
                            ? "chip-policy-sensitive"
                            : "chip-policy-public"
                        }
                      >
                        {entry.preset.policy}
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
          <div role="group" aria-label="Custody monitoring" className="card-panel rise mt-2" style={rise(440)}>
            <div className="card-core">
              <h3 className="card-label">CUSTODY</h3>
              <p className="meta mt-1.5">
                Monitored transports:{" "}
                {MONITORED_TRANSPORTS.map((transport, index) => (
                  <span key={transport}>
                    {index > 0 && <span aria-hidden> · </span>}
                    <span className="mono-value">{transport}</span>
                  </span>
                ))}
              </p>
            </div>
          </div>
        </section>
        <section aria-label="Selected artifact" className="flex min-h-0 flex-col">
          <h2 className="pane-label rise" style={rise(140)}>
            SELECTED ARTIFACT
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
            className="panel-evidence rise min-h-0 flex-1 overflow-hidden"
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
