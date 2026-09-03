import { useCallback, useMemo, useRef, useState } from "react";
import { useReactTable, getCoreRowModel, type ColumnDef } from "@tanstack/react-table";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import type { GridData } from "../revisioned-workspace/projection";

/**
 * The interactive read-only grid (stage 4, issue #19): the tanstack table
 * model owns columns and cells, react-virtual owns the row **and** column
 * windows (wide SQL results virtualize on both axes), and the cells stay
 * hand-rolled. Read-only by construction — the engine is SELECT-only and
 * artifacts immutable — so interaction is navigation, selection, and copy,
 * and selection is view state: it never dispatches and never mutates the
 * committed presentation.
 *
 * Keyboard map (prd §10): arrows move; Shift+arrows extend; Home/End row
 * ends; Ctrl/Cmd+Home/End grid ends; PageUp/PageDown viewport; Ctrl/Cmd+C
 * copies the selection as TSV matching the rendered cells, header included;
 * Escape clears; Tab always passes through — never trapped. ARIA grid with
 * `aria-activedescendant` roving, which is how a virtualized grid keeps
 * focus meaningful while the DOM window moves.
 *
 * The windowing contract keeps the old measurable bar: 32px rows, overscan
 * 8, translate-only vertical positioning (`data-grid-window`), DOM rows ≤
 * viewport + 2×overscan.
 *
 * The grid rides the v8 headless API (`useReactTable` + core row model),
 * not the v9 feature-flag build the plan sketched: with the cells
 * hand-rolled and no table-owned interaction state, v9's feature and
 * reactivity layers buy nothing here. Exact pin, deliberate deviation —
 * recorded in the PR.
 */

const ROW_HEIGHT = 32;
const ROW_OVERSCAN = 8;
const COLUMN_WIDTH = 128;
const COLUMN_OVERSCAN = 2;
const PAGE_ROWS = 16;

type CellRef = { readonly row: number; readonly col: number };

interface Selection {
  readonly anchor: CellRef;
  readonly focus: CellRef;
}

function normalize(selection: Selection): {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
} {
  return {
    r0: Math.min(selection.anchor.row, selection.focus.row),
    r1: Math.max(selection.anchor.row, selection.focus.row),
    c0: Math.min(selection.anchor.col, selection.focus.col),
    c1: Math.max(selection.anchor.col, selection.focus.col),
  };
}

/** The exact text a cell renders — copy uses this, so TSV matches the DOM. */
function cellText(value: unknown): string {
  return value === null || value === undefined ? "∅" : String(value);
}

export function InteractiveGrid({
  grid,
  totalRows,
}: {
  grid: Extract<GridData, { kind: "rows" }>;
  totalRows: number;
}) {
  const { rows, columns } = grid;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  // The tanstack column model: one accessor column per result column; rows
  // are objects keyed by column name so cells read through the table.
  const data = useMemo(
    () =>
      rows.map((cells) =>
        Object.fromEntries(columns.map((column, index) => [column.name, cells[index] ?? null])),
      ),
    [rows, columns],
  );
  const columnDefs = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => columns.map((column) => ({ accessorKey: column.name, id: column.name })),
    [columns],
  );
  const table = useReactTable({ data, columns: columnDefs, getCoreRowModel: getCoreRowModel() });
  const tableRows = table.getRowModel().rows;

  // Straight scrollTop/clientHeight observers: identical values to the
  // library defaults in a real browser, and deterministic under jsdom's
  // layout-less element (getBoundingClientRect is always zeros there).
  const observeOffset = (
    instance: Virtualizer<HTMLDivElement, Element>,
    callback: (offset: number, isScrolling: boolean) => void,
  ): (() => void) | undefined => {
    const element = instance.scrollElement;
    if (!element) return;
    const handler = () => callback(element.scrollTop, false);
    handler();
    element.addEventListener("scroll", handler, { passive: true });
    return () => element.removeEventListener("scroll", handler);
  };
  // The horizontal window reads scrollLeft instead — same deal, per axis.
  const observeOffsetX = (
    instance: Virtualizer<HTMLDivElement, Element>,
    callback: (offset: number, isScrolling: boolean) => void,
  ): (() => void) | undefined => {
    const element = instance.scrollElement;
    if (!element) return;
    const handler = () => callback(element.scrollLeft, false);
    handler();
    element.addEventListener("scroll", handler, { passive: true });
    return () => element.removeEventListener("scroll", handler);
  };
  const observeRect = (
    instance: Virtualizer<HTMLDivElement, Element>,
    callback: (rect: { width: number; height: number; x: number; y: number }) => void,
  ): (() => void) | undefined => {
    const element = instance.scrollElement;
    if (!element) return;
    const handler = () => callback({ width: element.clientWidth, height: element.clientHeight, x: 0, y: 0 });
    handler();
    element.addEventListener("scroll", handler, { passive: true });
    return () => element.removeEventListener("scroll", handler);
  };

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: ROW_OVERSCAN,
    observeElementOffset: observeOffset,
    observeElementRect: observeRect,
  });
  const columnVirtualizer = useVirtualizer({
    count: columns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COLUMN_WIDTH,
    overscan: COLUMN_OVERSCAN,
    horizontal: true,
    observeElementOffset: observeOffsetX,
    observeElementRect: observeRect,
  });

  // jsdom (and any engine without layout) measures no viewport, so the
  // virtualizers can return no window; the fallback of one row keeps the
  // render honest without a layout engine — the same bar the old grid held.
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems();
  const renderRows =
    virtualRows.length > 0
      ? virtualRows
      : rows.length > 0
        ? [{ index: 0, key: 0, start: 0, end: ROW_HEIGHT, size: ROW_HEIGHT, lane: 0 }]
        : [];
  const renderColumns =
    virtualColumns.length > 0
      ? virtualColumns
      : columns.length > 0
        ? [{ index: 0, key: 0, start: 0, end: COLUMN_WIDTH, size: COLUMN_WIDTH, lane: 0 }]
        : [];
  const start = renderRows[0]?.index ?? 0;
  const totalWidth = columns.length * COLUMN_WIDTH;

  const inRange = useCallback(
    (row: number, col: number): boolean => {
      if (!selection) return false;
      const { r0, r1, c0, c1 } = normalize(selection);
      return row >= r0 && row <= r1 && col >= c0 && col <= c1;
    },
    [selection],
  );

  const moveFocus = useCallback(
    (row: number, col: number, extend: boolean) => {
      const clamped = {
        row: Math.max(0, Math.min(row, rows.length - 1)),
        col: Math.max(0, Math.min(col, columns.length - 1)),
      };
      if (rows.length === 0 || columns.length === 0) return;
      setSelection((current) => {
        const anchor = current && extend ? current.anchor : clamped;
        return { anchor, focus: clamped };
      });
      rowVirtualizer.scrollToIndex(clamped.row);
      columnVirtualizer.scrollToIndex(clamped.col);
    },
    [rows.length, columns.length, rowVirtualizer, columnVirtualizer],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Tab is never trapped: the grid is one tab stop, and focus leaves it natively.
      if (event.key === "Tab") return;
      const current = selection?.focus ?? { row: 0, col: 0 };
      const extend = event.shiftKey;
      const mod = event.metaKey || event.ctrlKey;
      switch (event.key) {
        case "ArrowDown":
          moveFocus(current.row + 1, current.col, extend);
          break;
        case "ArrowUp":
          moveFocus(current.row - 1, current.col, extend);
          break;
        case "ArrowRight":
          moveFocus(current.row, current.col + 1, extend);
          break;
        case "ArrowLeft":
          moveFocus(current.row, current.col - 1, extend);
          break;
        case "Home":
          moveFocus(mod ? 0 : current.row, 0, extend);
          break;
        case "End":
          moveFocus(mod ? rows.length - 1 : current.row, columns.length - 1, extend);
          break;
        case "PageDown":
          moveFocus(current.row + PAGE_ROWS, current.col, extend);
          break;
        case "PageUp":
          moveFocus(current.row - PAGE_ROWS, current.col, extend);
          break;
        case "Escape":
          setSelection(null);
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [selection, rows.length, columns.length, moveFocus],
  );

  const onCopy = useCallback(
    (event: React.ClipboardEvent) => {
      if (!selection) return;
      const { r0, r1, c0, c1 } = normalize(selection);
      // The rendered safe projection only: header line plus the same text
      // the cells paint, from the bounded rows the store captured.
      const header = columns.slice(c0, c1 + 1).map((column) => column.name);
      const body = rows.slice(r0, r1 + 1).map((cells) =>
        cells.slice(c0, c1 + 1).map((cell) => cellText(cell)).join("\t"),
      );
      const tsv = [header.join("\t"), ...body].join("\n");
      event.clipboardData.setData("text/plain", tsv);
      event.preventDefault();
    },
    [selection, columns, rows],
  );

  // Paste is an explicit no-op: the grid is read-only, so a paste never
  // mutates anything — swallowed, not ignored silently (the handler exists
  // to make that promise inspectable).
  const onPaste = useCallback((event: React.ClipboardEvent) => {
    event.preventDefault();
  }, []);

  const focusedId = selection ? `cell-${selection.focus.row}-${selection.focus.col}` : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        role="grid"
        aria-label="Rows"
        aria-rowcount={rows.length + 1}
        aria-colcount={columns.length}
        aria-activedescendant={focusedId}
        tabIndex={0}
        data-grid-viewport
        className="min-h-0 flex-1 overflow-auto outline-none"
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
      >
        <div style={{ width: totalWidth, position: "relative" }}>
            <div role="row" aria-rowindex={1} className="grid-header sticky top-0 z-10" style={{ height: ROW_HEIGHT, width: totalWidth, position: "sticky" }}>
              {virtualColumns.map((virtualColumn) => {
                const column = columns[virtualColumn.index];
                if (!column) return null;
                return (
                  <span
                    key={column.name}
                    role="columnheader"
                    className="absolute truncate px-2.5 py-1.5"
                    style={{ left: virtualColumn.index * COLUMN_WIDTH, width: COLUMN_WIDTH, top: 0 }}
                  >
                    {column.name} <span className="text-ink-secondary">{column.type}</span>
                  </span>
                );
              })}
            </div>
          <div
            data-grid-canvas
            style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}
          >
            <div
              data-grid-window
              style={{ position: "absolute", insetInline: 0, transform: `translateY(${start * ROW_HEIGHT}px)` }}
            >
              {renderRows.map((virtualRow) => {
                const rowIndex = virtualRow.index;
                const row = tableRows[rowIndex];
                if (!row) return null;
                return (
                    <div
                      key={rowIndex}
                      data-grid-row
                      role="row"
                      aria-rowindex={rowIndex + 2}
                      className="absolute border-t border-edge/60 hover:bg-white/[0.03]"
                      style={{ top: (rowIndex - start) * ROW_HEIGHT, height: ROW_HEIGHT, width: totalWidth }}
                    >
                {renderColumns.map((virtualColumn) => {
                  const column = columns[virtualColumn.index];
                  if (!column) return null;
                  const cell = row.getAllCells()[virtualColumn.index];
                        const selected = inRange(rowIndex, virtualColumn.index);
                        const isFocus =
                          selection?.focus.row === rowIndex && selection?.focus.col === virtualColumn.index;
                        return (
                          <span
                            key={column.name}
                            id={`cell-${rowIndex}-${virtualColumn.index}`}
                            role="gridcell"
                            aria-selected={selected}
                            data-grid-cell
                            className={`mono-value absolute truncate px-2.5 leading-8 ${selected ? "bg-accent/[0.08]" : ""} ${
                              isFocus ? "outline outline-1 -outline-offset-1 outline-accent/50" : ""
                            }`}
                            style={{ left: virtualColumn.index * COLUMN_WIDTH, width: COLUMN_WIDTH, top: 0, height: ROW_HEIGHT }}
                            onMouseDown={(event) => {
                              const ref = { row: rowIndex, col: virtualColumn.index };
                              setSelection((current) =>
                                event.shiftKey && current ? { anchor: current.anchor, focus: ref } : { anchor: ref, focus: ref },
                              );
                            }}
                          >
                            {cellText(cell?.getValue())}
                          </span>
                        );
                      })}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>
      <p className="meta mt-1 px-1">
        {grid.truncated
          ? `showing ${rows.length} of ${totalRows} committed rows — the cache is bounded`
          : `${rows.length} committed rows`}
      </p>
    </div>
  );
}
