import { useEffect, useRef, useState } from "react";
import type { GridData } from "../revisioned-workspace/projection";

/**
 * The hand-rolled windowing contract (grilling 51 item 1): fixed 32px rows,
 * overscan 8, a passive scroll listener, and translate-only positioning —
 * no virtualization dependency, no layout reads on scroll. The measurable
 * bar: DOM row count stays ≤ viewport rows + 2×overscan at the 10k-row
 * budget, which `_contract` asserts.
 */

const ROW_HEIGHT = 32;
const OVERSCAN = 8;

export function VirtualGrid({
  grid,
  totalRows,
}: {
  grid: Extract<GridData, { kind: "rows" }>;
  totalRows: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    // jsdom renders no layout; the fallback of one viewport row keeps the
    // window honest (overscan-bounded) without a layout engine.
    setViewportHeight(container.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setViewportHeight(container.clientHeight));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const viewportRows = Math.max(1, Math.ceil(viewportHeight / ROW_HEIGHT));
  const first = Math.floor(scrollTop / ROW_HEIGHT);
  const start = Math.max(0, first - OVERSCAN);
  const end = Math.min(grid.rows.length, first + viewportRows + OVERSCAN);
  const visibleRows = grid.rows.slice(start, end);
  const template = `minmax(9rem, 1fr) repeat(${Math.max(0, grid.columns.length - 1)}, minmax(6rem, 1fr))`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid-header grid" style={{ gridTemplateColumns: template }}>
        {grid.columns.map((column) => (
          <span key={column.name} className="truncate px-2.5 py-1.5">
            {column.name} <span className="text-ink-secondary">{column.type}</span>
          </span>
        ))}
      </div>
      <div
        ref={scrollRef}
        data-grid-viewport
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div
          data-grid-canvas
          style={{ height: grid.rows.length * ROW_HEIGHT, position: "relative" }}
        >
          <div
            data-grid-window
            style={{ position: "absolute", insetInline: 0, transform: `translateY(${start * ROW_HEIGHT}px)` }}
          >
            {visibleRows.map((row, index) => (
              <div
                key={start + index}
                data-grid-row
                className="grid border-t border-edge/60 hover:bg-white/[0.03]"
                style={{ gridTemplateColumns: template, height: ROW_HEIGHT }}
              >
                {row.map((cell, cellIndex) => (
                  <span key={cellIndex} className="mono-value truncate px-2.5 leading-8">
                    {cell === null || cell === undefined ? "∅" : String(cell)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="meta mt-1 px-1">
        {grid.truncated
          ? `showing ${grid.rows.length} of ${totalRows} committed rows — the cache is bounded`
          : `${grid.rows.length} committed rows`}
      </p>
    </div>
  );
}
