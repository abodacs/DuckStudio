import { useRef, useState, type KeyboardEvent } from "react";
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

const TAB_TRANSITION =
  "transition-[background-color,border-color,color,transform] duration-150 ease-out motion-reduce:transition-none motion-reduce:transform-none";

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
    setActiveView(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <div className="flex h-dvh min-w-[960px] flex-col">
      <header className="flex items-center gap-4 border-b border-edge bg-surface px-4 py-2">
        <h1 className="text-lg font-semibold tracking-[-0.01em]">DuckStudio</h1>
        <p aria-live="polite" className="text-sm text-ink-secondary">
          <span className="font-mono text-ink">{vm.workspaceId}</span>
          <span aria-hidden> · </span>
          <span className="font-mono text-ink">rev {vm.revision}</span>
          <span aria-hidden> · </span>
          {vm.datasetLine}
        </p>
        <p className="text-sm text-ink-secondary">
          available preset{" "}
          <span className="font-mono text-ink">
            {saasChurnPreset.datasetId} · {saasChurnPreset.policy}
          </span>
        </p>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-surface px-3 py-1 text-sm">
          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          {vm.badge}
        </span>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-[35%_65%]">
        <section aria-label="Agent control and operations" className="border-r border-edge p-4">
          <h2 className="text-xs font-semibold tracking-wide text-ink-secondary">
            AGENT CONTROL &amp; OPERATIONS
          </h2>
          <div role="group" aria-label="Workspace context" className="mt-3 rounded-md border border-edge bg-surface px-3 py-2">
            <h3 className="text-xs font-medium tracking-wide text-ink-secondary">CONTEXT</h3>
            <p className="mt-1 text-xs text-ink-secondary">
              <span className="font-mono text-ink">{vm.workspaceId}</span>
              <span aria-hidden> · </span>
              rev <span className="font-mono text-ink">{vm.revision}</span>
            </p>
            <p className="mt-1 text-xs text-ink-secondary">dataset: {vm.datasetLine}</p>
            <dl className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 text-xs text-ink-secondary">
              {Object.entries(vm.budgets).map(([knob, limit]) => (
                <div key={knob} className="contents">
                  <dt>{knob}</dt>
                  <dd className="font-mono text-ink">{limit}</dd>
                </div>
              ))}
            </dl>
          </div>
          {/*
            The one read, pinned idle (ticket 06): reads never take the
            store's single-flight slot, so no workspace state backs this card
            and nothing dispatches it until the agent channel lands — an
            auto-dispatched proof-of-life read would flip the card with no
            state change to show for it.
          */}
          <div role="group" aria-label="Operations" className="mt-2 rounded-md border border-amber/40 bg-surface px-3 py-2">
            <h3 className="text-xs font-medium tracking-wide text-ink-secondary">OPERATION</h3>
            <p className="mt-1 flex items-center gap-2 text-xs">
              <span className="rounded-full border border-amber/40 px-2 py-0.5 font-mono text-amber">
                {GET_CONTEXT_TOOL}
              </span>
              <span className="text-ink-secondary">idle</span>
            </p>
            <p className="mt-1 text-xs text-ink-secondary">
              op <span className="font-mono">op_get_context</span>
            </p>
          </div>
          <div role="group" aria-label="Artifact stream" className="mt-2 rounded-md border border-edge bg-surface px-3 py-2">
            <h3 className="text-xs font-medium tracking-wide text-ink-secondary">ARTIFACTS</h3>
            {vm.recentArtifacts.length === 0 ? (
              <p className="mt-1 text-xs text-ink-secondary">No artifacts yet.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-xs">
                {vm.recentArtifacts.map((artifactId) => (
                  <li key={artifactId} className="font-mono text-ink">
                    {artifactId}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div role="group" aria-label="Dataset presets" className="mt-3 space-y-2">
            <h3 className="text-xs font-medium tracking-wide text-ink-secondary">DATASETS</h3>
            {PRESETS.map((preset) => (
              <button
                key={preset.datasetId}
                type="button"
                disabled
                aria-describedby="preset-status"
                className={`block w-full rounded-md border border-edge bg-surface px-3 py-2 text-left ${TAB_TRANSITION}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm text-ink">{preset.datasetId}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      preset.policy === "sensitive_aggregate_only"
                        ? "border-amber/40 text-amber"
                        : "border-edge text-ink-secondary"
                    }`}
                  >
                    {preset.policy}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-ink-secondary">{presetMeta(preset)}</span>
              </button>
            ))}
            <p id="preset-status" className="text-xs text-ink-secondary">
              Dataset activation is coming online.
            </p>
          </div>
          <p className="mt-4 text-xs text-ink-secondary">
            Agent channel: <span className="font-mono">simulator</span> ·{" "}
            <span className="font-mono">native WebMCP</span> — connecting.
          </p>
          <div role="group" aria-label="Custody monitoring" className="mt-4">
            <h3 className="text-xs font-medium tracking-wide text-ink-secondary">CUSTODY</h3>
            <p className="mt-1 text-xs text-ink-secondary">
              Monitored transports:{" "}
              {TRANSPORTS.map((transport, index) => (
                <span key={transport}>
                  {index > 0 && <span aria-hidden> · </span>}
                  <span className="font-mono text-ink">{transport}</span>
                </span>
              ))}
            </p>
          </div>
        </section>
        <section aria-label="Selected artifact" className="p-4">
          <h2 className="text-xs font-semibold tracking-wide text-ink-secondary">
            SELECTED ARTIFACT
          </h2>
          <div
            role="tablist"
            aria-label="Evidence views"
            className="mt-2 flex gap-1"
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
                onClick={() => setActiveView(id)}
                className={`rounded-t-md border border-b-0 px-3 py-1.5 text-sm focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.97] ${TAB_TRANSITION} ${
                  id === activeView
                    ? "relative z-10 translate-y-px border-edge bg-surface text-ink"
                    : "border-transparent text-ink-secondary hover:bg-surface hover:text-ink"
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
            className="rounded-b-md border border-edge bg-surface p-4 text-sm"
          >
            <View />
          </div>
        </section>
      </main>
    </div>
  );
}
