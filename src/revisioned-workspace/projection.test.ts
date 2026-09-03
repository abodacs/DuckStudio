import { describe, expect, it } from "vitest";
import { createStore, fakeEngine, activateSaasChurn, runChurn } from "./_contract/harness";
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
        "import_local_file",
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
      operations: [],
      artifactCards: [],
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

  it("discloses an unknown id as unavailable — the rev-0 workspace holds no artifacts", () => {
    expect(projectArtifact(ws, "a_01")).toEqual({
      kind: "unavailable",
      artifactId: "a_01",
      reason: "not_found",
    });
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

describe("the widened projection on an artifact-bearing workspace (Slice 5, grilling 51/52)", () => {
  it("gives the envelope summary, the artifact card, and Insights the same objects", async () => {
    const store = createStore(fakeEngine());
    await activateSaasChurn(store);
    const envelope = await runChurn(store, "projection-widened-01");
    if (!envelope.ok) throw new Error(`expected the churn analysis to commit: ${JSON.stringify(envelope.error)}`);

    const workspace = store.getSnapshot();
    const summary = (envelope.data as { summary: { kpis: unknown[]; chart: unknown } }).summary;
    const vm = projectWorkspace(workspace);
    const card = vm.artifactCards[0];
    if (!card) throw new Error("expected the committed artifact card");
    const view = projectArtifact(workspace, workspace.selectedArtifactId);

    // The envelope summary and the projection's artifact view are one object.
    expect(view.kind).toBe("artifact");
    if (view.kind !== "artifact") throw new Error("unreachable");
    expect(view.summary).toBe(summary);
    expect(card.artifactId).toBe("a_01");
    expect(card.selected).toBe(true);
    expect(card.kpis[0]).toBe(summary.kpis[0]);
    expect(view.insights.kpis).toBe(summary.kpis);
    expect(view.insights.chart).toBe(summary.chart);
    // Memoization: the same workspace + id return the same reference.
    expect(projectArtifact(workspace, "a_01")).toBe(view);
  });

  it("merges the committed row cache and custody evidence synchronously", async () => {
    const store = createStore(fakeEngine());
    await activateSaasChurn(store);
    await runChurn(store, "projection-widened-02");
    const view = projectArtifact(store.getSnapshot(), "a_01");
    if (view.kind !== "artifact") throw new Error("unreachable");

    // Grid rows: bounded page memory captured at commit, never a fetch.
    expect(view.grid.kind).toBe("rows");
    if (view.grid.kind !== "rows") throw new Error("unreachable");
    expect(view.grid.rows).toEqual([
      [3, 120],
      [9, 40],
    ]);
    expect(view.grid.truncated).toBe(false);
    expect(view.grid.columns).toBe(view.artifact.schema);

    // Lineage carries the exact statement, hash, source, chain, release, metrics.
    expect(view.lineage.sql).toBe(view.artifact.sql);
    expect(view.lineage.sqlHash).toBe(view.artifact.sqlHash);
    expect(view.lineage.chain).toBe(view.artifact.lineage);

    // Custody: the §8.4 snapshot the store captured from the kernel recorder.
    expect(view.custody?.scope).toEqual({ kind: "artifact", id: "a_01" });
    expect(view.custody?.datasetBytesUploaded).toBe(0);
    expect(view.custody?.limitations).toHaveLength(2);

    // Insights: downsampling derives from the measured metrics.
    expect(view.insights.chartDownsampled).toBe(false);
  });
});
