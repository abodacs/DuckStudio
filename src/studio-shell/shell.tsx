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
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-[35%_65%]">
        <section aria-label="Agent control and operations" className="border-r border-edge p-4">
          <h2 className="pane-label">AGENT CONTROL &amp; OPERATIONS</h2>
          <div role="group" aria-label="Workspace context" className="card-panel mt-3">
            <h3 className="card-label">CONTEXT</h3>
            <p className="meta mt-1">
              <span className="mono-value">{vm.workspaceId}</span>
              <span aria-hidden> · </span>
              rev <span className="mono-value">{vm.revision}</span>
            </p>
            <p className="meta mt-1">dataset: {vm.datasetLine}</p>
            <dl className="meta mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
              {Object.entries(vm.budgets).map(([knob, limit]) => (
                <div key={knob} className="contents">
                  <dt>{knob}</dt>
                  <dd className="mono-value">{limit}</dd>
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
          <div role="group" aria-label="Operations" className="card-operation mt-2">
            <h3 className="card-label">OPERATION</h3>
            <p className="meta mt-1 flex items-center gap-2">
              <span className="chip-tool">{GET_CONTEXT_TOOL}</span>
              <span>idle</span>
            </p>
            <p className="meta mt-1">
              op <span className="mono-value">op_get_context</span>
            </p>
          </div>
          <div role="group" aria-label="Artifact stream" className="card-panel mt-2">
            <h3 className="card-label">ARTIFACTS</h3>
            {vm.recentArtifacts.length === 0 ? (
              <p className="meta mt-1">No artifacts — operations settle here as immutable artifacts.</p>
            ) : (
              <ul className="meta mt-1 space-y-1">
                {vm.recentArtifacts.map((artifactId) => (
                  <li key={artifactId} className="mono-value">
                    {artifactId}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div role="group" aria-label="Dataset presets" className="mt-3 space-y-2">
            <h3 className="card-label">DATASETS</h3>
            {PRESETS.map((preset) => (
              <button
                key={preset.datasetId}
                type="button"
                disabled
                aria-describedby="preset-status"
                className="preset-card"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="mono-value text-sm">{preset.datasetId}</span>
                  <span
                    className={
                      preset.policy === "sensitive_aggregate_only"
                        ? "chip-policy-sensitive"
                        : "chip-policy-public"
                    }
                  >
                    {preset.policy}
                  </span>
                </span>
                <span className="meta mt-1 block">{presetMeta(preset)}</span>
              </button>
            ))}
            <p id="preset-status" className="meta">
              Dataset activation is coming online.
            </p>
          </div>
          <p className="meta mt-4">
            Agent channel: <span className="mono-value">simulator</span> ·{" "}
            <span className="mono-value">native WebMCP</span> — connecting.
          </p>
          <div role="group" aria-label="Custody monitoring" className="card-panel mt-4">
            <h3 className="card-label">CUSTODY</h3>
            <p className="meta mt-1">
              Monitored transports:{" "}
              {TRANSPORTS.map((transport, index) => (
                <span key={transport}>
                  {index > 0 && <span aria-hidden> · </span>}
                  <span className="mono-value">{transport}</span>
                </span>
              ))}
            </p>
          </div>
        </section>
        <section aria-label="Selected artifact" className="flex flex-col p-4">
          <h2 className="pane-label">SELECTED ARTIFACT</h2>
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
                className={`tab-evidence ${
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
            className="flex min-h-0 flex-1 flex-col rounded-b-md border border-edge bg-surface p-4 text-sm"
          >
            <View key={activeView} />
          </div>
        </section>
      </main>
    </div>
  );
}
