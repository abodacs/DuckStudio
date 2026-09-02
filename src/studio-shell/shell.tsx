import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { healthcarePiiPreset, saasChurnPreset } from "../demo-presets/catalog";
import { ToolNameSchema } from "../agent-control-plane/envelope";
import { projectWorkspace } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";
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

/** The one tool the skeleton serves — the envelope's spelling, never a literal. */
const GET_CONTEXT_TOOL = ToolNameSchema.enum.duckdb_get_context;

/**
 * Rev-0 preset-chip chrome (ticket 10). The chips keep their static cards
 * until activation exists (Slice 2); every chip field reads the seeded
 * catalog, so ids and policies have one spelling.
 */
const PRESETS = [saasChurnPreset, healthcarePiiPreset];

/** Chip display line, composed from the catalog's own size facts. */
function presetMeta(preset: (typeof PRESETS)[number]): string {
  return `${Math.round(preset.rowCount / 1000)}k rows · ~${(preset.byteSizeEstimate / 1_000_000).toFixed(1)} MB`;
}

/**
 * Canonical monitored-transport list from the custody evidence contract
 * (docs/agent-system-design.md, duckdb_verify_zero_egress response).
 */
const TRANSPORTS = ["fetch", "XMLHttpRequest", "sendBeacon", "WebSocket", "WebTransport"] as const;

/**
 * The first-run path (PRD §7.3 first paint): three moves to the aha —
 * governed evidence on glass while the badge still reads zero upload. Each
 * move names real UI; the current move derives from workspace state, never
 * from a tour counter.
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

/**
 * Two-pane evidence chrome (PRD §7) rendered by the single projection owner
 * (ADR 0005 am3): the header and left-pane cards read `projectWorkspace`,
 * the right pane's views read `projectArtifact` — no second projection.
 */
export function WorkspaceShell() {
  const [activeView, setActiveView] = useState<ViewId>("insights");
  const vm = useWorkspace(projectWorkspace);
  const { View } = VIEWS[activeView];
  const tabRefs = useRef<Map<ViewId, HTMLButtonElement | null>>(new Map());
  const switchTo = switchView(setActiveView);

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
            <span aria-hidden className="badge-dot" />
            {vm.badge}
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
          <div role="group" aria-label="Workspace context" className="card-panel rise mt-2" style={rise(160)}>
            <div className="card-core">
              <h3 className="card-label">CONTEXT</h3>
              <p className="meta mt-1.5">
                <span className="mono-value">{vm.workspaceId}</span>
                <span aria-hidden> · </span>
                rev <span className="mono-value">{vm.revision}</span>
              </p>
              <p className="meta mt-1">dataset: {vm.datasetLine}</p>
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
          {/*
            The one read, pinned idle (ticket 06): reads never take the
            store's single-flight slot, so no workspace state backs this card
            and nothing dispatches it until the agent channel lands — an
            auto-dispatched proof-of-life read would flip the card with no
            state change to show for it.
          */}
          <div role="group" aria-label="Operations" className="card-operation rise mt-2" style={rise(220)}>
            <div className="card-operation-core">
              <h3 className="card-label">OPERATION</h3>
              <p className="meta mt-1.5 flex items-center gap-2">
                <span className="chip-tool">{GET_CONTEXT_TOOL}</span>
                <span>idle</span>
              </p>
              <p className="meta mt-1">
                op <span className="mono-value">op_get_context</span>
              </p>
            </div>
          </div>
          <div role="group" aria-label="Artifact stream" className="card-panel rise mt-2" style={rise(280)}>
            <div className="card-core">
              <h3 className="card-label">ARTIFACTS</h3>
              {vm.recentArtifacts.length === 0 ? (
                <p className="meta mt-1.5">No artifacts — operations settle here as immutable artifacts.</p>
              ) : (
                <ul className="meta mt-1.5 space-y-1">
                  {vm.recentArtifacts.map((artifact) => (
                    <li key={artifact.artifactId} className="mono-value">
                      {artifact.artifactId}
                      {artifact.evicted ? <span className="meta"> · evicted</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div role="group" aria-label="Dataset presets" className="rise mt-3 space-y-2" style={rise(340)}>
            <h3 className="card-label">DATASETS</h3>
            <p id="preset-status" className="meta">
              Dataset activation is coming online.
            </p>
            {PRESETS.map((preset) => (
              <button
                key={preset.datasetId}
                type="button"
                disabled
                aria-describedby="preset-status"
                className="preset-card opacity-75"
              >
                <span className="card-core flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="mono-value block text-sm">{preset.datasetId}</span>
                    <span className="meta mt-1 block">{presetMeta(preset)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className={
                        preset.policy === "sensitive_aggregate_only"
                          ? "chip-policy-sensitive"
                          : "chip-policy-public"
                      }
                    >
                      {preset.policy}
                    </span>
                    <span aria-hidden className="preset-arrow opacity-60">
                      <ArrowGlyph />
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
          <p className="meta rise mt-3" style={rise(400)}>
            Agent channel: <span className="mono-value">simulator</span> ·{" "}
            <span className="mono-value">native WebMCP</span> — connecting.
          </p>
          <div role="group" aria-label="Custody monitoring" className="card-panel rise mt-2" style={rise(440)}>
            <div className="card-core">
              <h3 className="card-label">CUSTODY</h3>
              <p className="meta mt-1.5">
                Monitored transports:{" "}
                {TRANSPORTS.map((transport, index) => (
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
            <div id="evidence-panel" className="h-full overflow-y-auto p-1 text-sm">
              <div className="panel-evidence-core flex min-h-full flex-col">
                <View key={activeView} />
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
