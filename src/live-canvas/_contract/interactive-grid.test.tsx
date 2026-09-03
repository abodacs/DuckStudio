// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataGridView } from "../data-grid-view";
import { workspaceStore } from "../../revisioned-workspace/store";
import type { WorkspaceStore } from "../../revisioned-workspace/store";
import {
  activateSaasChurn,
  createStore,
  fakeEngine,
  runChurn,
} from "../../revisioned-workspace/_contract/harness";

let current: WorkspaceStore = createStore(fakeEngine());

vi.mock("../../revisioned-workspace/use-workspace", () => ({
  useWorkspace: (selector: (workspace: never) => unknown) => selector(current.getSnapshot() as never),
}));

/**
 * The interactive grid's contract (stage 4, issue #19): the keyboard map is
 * operable without a mouse, copy sources the rendered safe projection with
 * its header, paste is an explicit no-op, and selection is view state — it
 * never dispatches and never leaves the grid.
 */

async function churnWorkspace(): Promise<WorkspaceStore> {
  const store = createStore(fakeEngine());
  await activateSaasChurn(store);
  const envelope = await runChurn(store, "grid-contract-churn");
  if (!envelope.ok) throw new Error("expected the churn analysis to commit");
  return store;
}

const CHURN_SCHEMA = [
  { name: "tickets", type: "INTEGER" },
  { name: "accounts", type: "BIGINT" },
];

beforeEach(async () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: false, media: query }) as MediaQueryList,
  });
});

afterEach(cleanup);

async function renderGrid() {
  const store = await churnWorkspace();
  current = store;
  render(<DataGridView />);
  return store;
}

function gridElement() {
  return screen.getByRole("grid", { name: "Rows" });
}

function activeCellId() {
  return gridElement().getAttribute("aria-activedescendant");
}

describe("interactive grid (stage 4)", () => {
  it("reaches every keyboard move without a mouse and never dispatches", async () => {
    await renderGrid();
    const spy = vi.spyOn(workspaceStore, "dispatch");
    const grid = gridElement();
    grid.focus();

    // Arrows move; aria-activedescendant roves across the virtual window.
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(activeCellId()).toBe("cell-1-0");
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(activeCellId()).toBe("cell-1-1");
    fireEvent.keyDown(grid, { key: "Home" });
    expect(activeCellId()).toBe("cell-1-0");
    fireEvent.keyDown(grid, { key: "End" });
    expect(activeCellId()).toBe("cell-1-1");
    fireEvent.keyDown(grid, { key: "Home", ctrlKey: true });
    expect(activeCellId()).toBe("cell-0-0");
    fireEvent.keyDown(grid, { key: "End", ctrlKey: true });
    expect(activeCellId()).toBe("cell-1-1");
    fireEvent.keyDown(grid, { key: "PageUp" });
    expect(activeCellId()).toBe("cell-0-1");

    // Escape clears; Tab passes through (the grid never traps it).
    fireEvent.keyDown(grid, { key: "Escape" });
    expect(activeCellId()).toBeNull();
    fireEvent.keyDown(grid, { key: "Tab" });
    expect(activeCellId()).toBeNull();

    // Selection is view state: zero dispatches for the whole keyboard tour.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("copies the selection as TSV matching the rendered cells, header included", async () => {
    await renderGrid();
    const grid = gridElement();
    grid.focus();

    // A 2×1 range from the first cell: down then extend right.
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowRight", shiftKey: true });

    const setData = vi.fn();
    fireEvent.copy(grid, {
      clipboardData: { setData },
    });
    expect(setData).toHaveBeenCalledWith("text/plain", ["tickets\taccounts", "9\t40"].join("\n"));

    // The copied text is the rendered text: for the one cell the column
    // window paints, the TSV body carries exactly what the cell shows.
    const painted = [...grid.querySelectorAll("[data-grid-row]")].flatMap((row) =>
      [...row.querySelectorAll("[role='gridcell']")].map((cell) => cell.textContent),
    );
    expect(painted).toContain("3");
    fireEvent.mouseDown(screen.getByText("3"));
    fireEvent.copy(grid, { clipboardData: { setData } });
    expect(setData).toHaveBeenLastCalledWith("text/plain", ["tickets", "3"].join("\n"));
  });

  it("treats paste as an explicit no-op", async () => {
    await renderGrid();
    const grid = gridElement();
    const spy = vi.spyOn(workspaceStore, "dispatch");
    const before = grid.outerHTML;
    // fireEvent resolves falsy exactly when the handler swallowed the event.
    const propagated = fireEvent.paste(grid, { clipboardData: { getData: () => "x\ty" } });
    expect(propagated).toBe(false);
    expect(grid.outerHTML).toBe(before);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("keeps the schema digest on the result columns (no second model)", async () => {
    const store = await renderGrid();
    const artifact = store.getSnapshot().artifacts[0];
    expect(artifact?.artifact.schema.map((column) => column.name)).toEqual(CHURN_SCHEMA.map((c) => c.name));
  });
});
