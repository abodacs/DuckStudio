import { useState } from "react";
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

/**
 * Two-pane evidence chrome (PRD §7). At the walking-skeleton stage the header
 * values are the rev-0 constants; the workspace store (next tickets) and the
 * projection wiring own them from ticket 13.
 */
export function WorkspaceShell() {
  const [activeView, setActiveView] = useState<ViewId>("insights");
  const { label, View } = VIEWS[activeView];

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-4 border-b border-zinc-300 px-4 py-2">
        <span className="text-lg font-semibold">DuckStudio</span>
        <span>ws_local_01 · rev 0 · no dataset</span>
        <span className="ml-auto rounded border border-zinc-400 px-2 py-0.5 text-sm">
          0 Bytes of Dataset Uploaded
        </span>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-[35%_65%]">
        <section aria-label="Agent control and operations" className="border-r border-zinc-300 p-4">
          <h2 className="text-xs font-semibold tracking-wide text-zinc-500">
            AGENT CONTROL &amp; OPERATIONS
          </h2>
        </section>
        <section aria-label="Selected artifact" className="p-4">
          <h2 className="text-xs font-semibold tracking-wide text-zinc-500">SELECTED ARTIFACT</h2>
          <div role="tablist" aria-label="Evidence views" className="mt-2 flex gap-1">
            {VIEW_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === activeView}
                onClick={() => setActiveView(id)}
                className="rounded-t border border-b-0 border-zinc-300 px-3 py-1 text-sm"
              >
                {VIEWS[id].label}
              </button>
            ))}
          </div>
          <div role="tabpanel" aria-label={label} className="border border-zinc-300 p-4 text-sm">
            <View />
          </div>
        </section>
      </main>
    </div>
  );
}
