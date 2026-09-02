import { z } from "zod";
import {
  WorkspaceSchema,
  type BudgetLimits,
  type Capability,
  type Policy,
  type RecentArtifact,
  type Workspace,
} from "./schemas";
import type { AnalysisArtifact, ArtifactSummary } from "../analysis-artifacts/schemas";

/**
 * The single projection owner (ADR 0005 am3): `projectWorkspace` serves the
 * header badge, the left-pane cards, the simulator cards, and the envelope
 * `summary`. `projectArtifact` serves the four evidence views and the
 * artifact-bearing summaries (ADR 0005 am4: realized in Slice 3). No adapter
 * derives workspace or artifact display state any other way.
 */

/** The projection input schema, compiled per ADR 0004's hot-path rule. */
export const CompiledProjectionInput = z.compile(WorkspaceSchema);

/** §4.1 dataset state: none until an activation composes the catalog metadata in. */
export type DatasetState =
  | { kind: "none" }
  | {
      kind: "active";
      datasetId: string;
      policy: Policy;
      rowCount: number;
      bytes: number;
    };

export type WorkspaceViewModel = {
  workspaceId: string;
  revision: number;
  datasetState: DatasetState;
  /** Derived display line for the dataset state — `datasetId · policy` once active. */
  datasetLine: string;
  /** Derived display string, composed once here — header and cards share it verbatim. */
  badge: string;
  capabilities: Capability[];
  budgets: BudgetLimits;
  selectedArtifactId: string | null;
  /** Newest first; evicted artifacts stay listed, flagged (grilling 32). */
  recentArtifacts: RecentArtifact[];
};

/**
 * The artifact-scope view (ticket 06's union, widened by Slice 3): the
 * committed record with its measured summary, the no-artifact empty state,
 * or the eviction disclosure for an artifact whose relation retention
 * dropped (grilling 32). Every view's switch grows with this union.
 */
export type ArtifactView =
  | { kind: "no_artifact" }
  | { kind: "unavailable"; artifactId: string; reason: "not_found" | "relation_evicted" }
  | { kind: "artifact"; artifact: AnalysisArtifact; summary: ArtifactSummary };

/** SECURITY.md: keep the badge copy exact. Upload accounting grows with Slice 2. */
const NO_UPLOAD_BADGE = "0 Bytes of Dataset Uploaded";

let lastInput: Workspace | undefined;
let lastOutput: WorkspaceViewModel | undefined;

/**
 * Memoized by last input: the store snapshot is immutable, so the same
 * workspace must yield the same object reference at every call site
 * (ADR 0005 am3's referential-equality contract).
 */
export function projectWorkspace(workspace: Workspace): WorkspaceViewModel {
  if (workspace === lastInput) {
    return lastOutput as WorkspaceViewModel;
  }
  CompiledProjectionInput.parse(workspace);
  const dataset = workspace.activeDataset;
  const output: WorkspaceViewModel = {
    workspaceId: workspace.workspaceId,
    revision: workspace.revision,
    datasetState:
      dataset && workspace.activeDatasetId === dataset.datasetId
        ? {
            kind: "active",
            datasetId: dataset.datasetId,
            policy: dataset.policy,
            rowCount: dataset.rowCount,
            bytes: dataset.byteSizeEstimate,
          }
        : { kind: "none" },
    datasetLine: dataset ? `${dataset.datasetId} · ${dataset.policy}` : "no dataset",
    badge: NO_UPLOAD_BADGE,
    capabilities: workspace.capabilities,
    budgets: workspace.budgets,
    selectedArtifactId: workspace.selectedArtifactId,
    // Commit order is oldest-first; cards read newest-first. Evicted
    // artifacts stay listed with the flag (grilling 32's UI disclosure).
    recentArtifacts: [...workspace.artifacts]
      .reverse()
      .map((record) => ({
        artifactId: record.artifact.artifactId,
        evicted: workspace.evictedArtifactIds.includes(record.artifact.artifactId),
      })),
  };
  lastInput = workspace;
  lastOutput = output;
  return output;
}

let lastArtifactInput: Workspace | undefined;
let lastArtifactId: string | null | undefined;
let lastArtifactOutput: ArtifactView | undefined;

/**
 * Memoized like `projectWorkspace`: same immutable workspace and id must
 * yield the same object reference at every view (ADR 0005 am3's
 * referential-equality contract).
 *
 * The artifact records ride the workspace snapshot (the store is the only
 * writer), so the view is a pure lookup: selection always points at a
 * committed artifact, and an evicted one discloses the eviction.
 */
export function projectArtifact(workspace: Workspace, artifactId: string | null): ArtifactView {
  if (workspace === lastArtifactInput && artifactId === lastArtifactId) {
    return lastArtifactOutput as ArtifactView;
  }
  CompiledProjectionInput.parse(workspace);
  let output: ArtifactView;
  if (artifactId === null) {
    output = { kind: "no_artifact" };
  } else {
    const record = workspace.artifacts.find((entry) => entry.artifact.artifactId === artifactId);
    if (!record) {
      output = { kind: "unavailable", artifactId, reason: "not_found" };
    } else if (workspace.evictedArtifactIds.includes(artifactId)) {
      output = { kind: "unavailable", artifactId, reason: "relation_evicted" };
    } else {
      output = { kind: "artifact", artifact: record.artifact, summary: record.summary };
    }
  }
  lastArtifactInput = workspace;
  lastArtifactId = artifactId;
  lastArtifactOutput = output;
  return output;
}
