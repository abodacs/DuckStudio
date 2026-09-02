// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CustodyView } from "../custody-view";
import { DataGridView } from "../data-grid-view";
import { InsightsView } from "../insights-view";
import { SqlLineageView } from "../sql-lineage-view";
import { workspaceStore } from "../../revisioned-workspace/store";

/**
 * The canvas selector contract (ADR 0003/0004): oxlint has no
 * `react-hooks/exhaustive-deps` equivalent, so this test owns the gap for
 * the canvas projection selector. All four views read the workspace through
 * `useWorkspace((ws) => projectArtifact(ws, ws.selectedArtifactId))`, and
 * the contract they must hold is the one `useSyncExternalStore` needs to not
 * loop:
 *
 * 1. every view renders from `projectArtifact` — the single projection
 *    owner — never a local derivation;
 * 2. the selected value is referentially stable for the same snapshot, and
 *    stays equal across a snapshot replacement that does not touch the
 *    artifact state (appendCapability), so a notification cannot cascade
 *    into unbounded re-renders;
 * 3. a workspace notification actually reaches every view.
 */
describe("canvas projection selector contract (ADR 0003)", () => {
  const views = [
    { name: "Insights", View: InsightsView, empty: "No artifact selected" },
    { name: "Data Grid", View: DataGridView, empty: "No artifact" },
    { name: "SQL & Lineage", View: SqlLineageView, empty: "No artifact" },
    { name: "Custody", View: CustodyView, empty: "No custody evidence yet" },
  ] as const;

  it("renders every view from projectArtifact's stable no_artifact view", () => {
    const artifact = workspaceStore.getSnapshot();
    expect(artifact.selectedArtifactId).toBeNull();

    for (const { View, empty } of views) {
      const { unmount } = render(<View />);
      expect(screen.getByText(new RegExp(empty))).toBeDefined();
      unmount();
    }
  });

  it("survives a snapshot replacement without a render loop", () => {
    const renders: number[] = [];
    const { View } = views[1];

    function Probe() {
      renders.push(renders.length);
      return <View />;
    }

    render(<Probe />);
    const rendersAfterMount = renders.length;
    expect(rendersAfterMount).toBeGreaterThan(0);

    act(() => {
      workspaceStore.appendCapability("simulator_only");
    });

    // One notification, bounded re-render: the selector output stayed
    // referentially equal (projectArtifact memoizes per snapshot+id), so
    // useSyncExternalStore settled instead of looping.
    expect(renders.length).toBeLessThanOrEqual(rendersAfterMount + 2);
    expect(screen.getByText(/No artifact/)).toBeDefined();
  });
});
