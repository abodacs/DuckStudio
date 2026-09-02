import { describe, expect, it } from "vitest";
import { createWorkspaceStore } from "./store";
import { projectArtifact, projectWorkspace } from "./projection";
import type { GetContextSummaryData } from "./schemas";

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
      datasetLine: "no dataset",
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

describe("projectArtifact at rev 0", () => {
  it("projects the no_artifact view for the only legal call", () => {
    expect(projectArtifact(ws, null)).toEqual({ kind: "no_artifact" });
  });

  it("projects from the workspace's selected artifact id, which cannot hold a value", () => {
    expect(projectArtifact(ws, ws.selectedArtifactId)).toEqual({ kind: "no_artifact" });
  });

  it("throws on a non-null id — no artifact can exist to reference", () => {
    expect(() => projectArtifact(ws, "a_01")).toThrow(/no artifact "a_01" can exist/);
  });

  it("returns the same reference for the same workspace and id", () => {
    expect(projectArtifact(ws, null)).toBe(projectArtifact(ws, null));
  });

  it("recomputes when a different snapshot arrives", () => {
    const moved = { ...ws, revision: 1 };
    const view = projectArtifact(moved, null);
    expect(view).toEqual({ kind: "no_artifact" });
    expect(view).not.toBe(projectArtifact(ws, null));
  });
});

describe("8 KB envelope-summary budget (PRD §10, ticket 08)", () => {
  // PRD §10: one `summary` response under 8 KB must suffice to choose a
  // legal next action. Ticket 08 pinned the enforcement site and threshold
  // (8192) against the serialized rev-0 summary — a trivial pass today, but
  // the guard is in place the day the summary can grow. Measured in UTF-8
  // bytes, the canonical budget's unit (agent-system-design.md §14: "The
  // budget is bytes"), not UTF-16 code units.
  it("keeps the serialized rev-0 summary within 8192 bytes", async () => {
    const store = createWorkspaceStore();
    const envelope = await store.dispatch({ kind: "getContext", input: { scope: "summary" } });
    if (!envelope.ok) {
      throw new Error("expected the rev-0 summary read to succeed");
    }
    const summary = envelope.data as GetContextSummaryData;
    const serialized = JSON.stringify(summary);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(8192);
  });
});

describe("referential-equality contract across the four call sites (ADR 0005 am3)", () => {
  // The four call sites: header badge + simulator cards (workspace scope,
  // `projectWorkspace`), the envelope `summary` (workspace scope at rev 0,
  // ticket 06's amendment-4 resolution), and the four evidence views
  // (artifact scope, `projectArtifact`). The simulator adapter itself lands
  // with ticket 14 — until then this test pins the references it will
  // consume, so the plumbing cannot drift before the consumer exists.
  it("gives every call site the same object for the same workspace", async () => {
    const store = createWorkspaceStore();
    const workspace = store.getSnapshot();
    const vm = projectWorkspace(workspace);

    // Header badge + simulator cards: identical view model reference.
    expect(projectWorkspace(workspace)).toBe(vm);

    // Envelope summary: assembled through projectWorkspace inside dispatch.
    const envelope = await store.dispatch({ kind: "getContext", input: { scope: "summary" } });
    if (!envelope.ok) {
      throw new Error("expected the rev-0 summary read to succeed");
    }
    // Type-only assertion: the summary scope's shape is guaranteed by the
    // store; re-parsing would copy and defeat the reference assertions.
    const data = envelope.data as GetContextSummaryData;
    expect(data.capabilities).toBe(vm.capabilities);
    expect(data.budgets).toBe(vm.budgets);
    expect(data.selectedArtifactId).toBe(vm.selectedArtifactId);
    expect(data.recentArtifacts).toBe(vm.recentArtifacts);

    // Four views: identical artifact-scope reference against no_artifact.
    const view = projectArtifact(workspace, workspace.selectedArtifactId);
    expect(projectArtifact(workspace, null)).toBe(view);
    expect(view).toEqual({ kind: "no_artifact" });
  });
});
