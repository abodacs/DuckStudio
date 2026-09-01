import { z } from "zod";
import {
  WorkspaceSchema,
  type BudgetLimits,
  type Capability,
  type Policy,
  type Workspace,
} from "./schemas";

/**
 * The single projection owner (ADR 0005 am3): `projectWorkspace` serves the
 * header badge, the left-pane cards, the simulator cards, and — at rev 0 —
 * the envelope `summary` (ticket 06's resolution of the ADR 0005 line-36
 * tension). `projectArtifact` serves the four evidence views. No adapter
 * derives workspace or artifact display state any other way.
 */

/** The projection input schema, compiled per ADR 0004's hot-path rule. */
export const CompiledProjectionInput = z.compile(WorkspaceSchema);

/**
 * Ticket-06 view model. `datasetState`'s active member and its metadata
 * arrive with activation (Slice 2); at rev 0 `activeDatasetId` can only be
 * null, so `none` is the only value the projection can produce.
 */
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
  /** Derived display line for the dataset state — "no dataset" until an activation composes `datasetId · policy` (Slice 2). */
  datasetLine: string;
  /** Derived display string, composed once here — header and cards share it verbatim. */
  badge: string;
  capabilities: Capability[];
  budgets: BudgetLimits;
  selectedArtifactId: string | null;
  recentArtifacts: [];
};

/**
 * The artifact-scope view (ticket 06): at rev 0 no artifact can exist, so
 * `no_artifact` is the only member; Slice 3's artifact-bearing views widen
 * this union, and every view's switch must grow with it.
 */
export type ArtifactView = { kind: "no_artifact" };

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
  const output: WorkspaceViewModel = {
    workspaceId: workspace.workspaceId,
    revision: workspace.revision,
    // No activation exists yet, so `none` is the only reachable state; the
    // active mapping lands with Slice 2's activation metadata.
    datasetState: { kind: "none" },
    datasetLine: "no dataset",
    badge: NO_UPLOAD_BADGE,
    capabilities: workspace.capabilities,
    budgets: workspace.budgets,
    selectedArtifactId: workspace.selectedArtifactId,
    recentArtifacts: [],
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
 * At rev 0 `null` is the only legal id — `selectedArtifactId` cannot hold a
 * value and no artifact graph exists — so a non-null id is a caller bug and
 * throws instead of faking a view (ticket 04's no-stub rule). Slice 3
 * replaces the throw with the artifact-bearing union members.
 */
export function projectArtifact(workspace: Workspace, artifactId: string | null): ArtifactView {
  if (workspace === lastArtifactInput && artifactId === lastArtifactId) {
    return lastArtifactOutput as ArtifactView;
  }
  CompiledProjectionInput.parse(workspace);
  if (artifactId !== null) {
    throw new Error(
      `projectArtifact: no artifact "${artifactId}" can exist — the workspace holds no artifacts until Slice 3.`,
    );
  }
  const output: ArtifactView = { kind: "no_artifact" };
  lastArtifactInput = workspace;
  lastArtifactId = artifactId;
  lastArtifactOutput = output;
  return output;
}
