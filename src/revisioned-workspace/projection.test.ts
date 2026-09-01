import { describe, expect, it } from "vitest";
import { createWorkspaceStore } from "./store";
import { projectWorkspace } from "./projection";

// The rev-0 workspace through the real composition path: the store seed is
// the canonical projection input.
const ws = createWorkspaceStore().getSnapshot();

describe("projectWorkspace at rev 0", () => {
  it("projects the ticket-06 view model for the seeded workspace", () => {
    const vm = projectWorkspace(ws);
    expect(vm).toEqual({
      workspaceId: "ws_local_01",
      revision: 0,
      datasetState: { kind: "none" },
      badge: "0 Bytes of Dataset Uploaded",
      capabilities: [
        "activate_local_preset",
        "run_readonly_sql",
        "present_artifact",
        "verify_custody",
        "cancel_active_operation",
        "select_artifact",
      ],
      budgets: {
        executionMs: 5000,
        resultRows: 10000,
        chartPoints: 2000,
        toolSummaryBytes: 8192,
        retainedArtifacts: 20,
        contextItems: 20,
      },
      selectedArtifactId: null,
      recentArtifacts: [],
    });
  });

  it("keeps the exact badge copy from SECURITY.md", () => {
    expect(projectWorkspace(ws).badge).toBe("0 Bytes of Dataset Uploaded");
  });

  it("returns the same reference for the same immutable snapshot", () => {
    expect(projectWorkspace(ws)).toBe(projectWorkspace(ws));
  });

  it("recomputes when a different snapshot arrives", () => {
    const moved = { ...ws, revision: 1 };
    const vm = projectWorkspace(moved);
    expect(vm.revision).toBe(1);
    expect(vm).not.toBe(projectWorkspace(ws));
  });
});
