import { z } from "zod";
import { WorkspaceSchema, type BudgetLimits, type Capability, type Workspace } from "./schemas";

/**
 * The single projection owner (ADR 0005 am3): `projectWorkspace` serves the
 * header badge, the left-pane cards, the simulator cards, and — at rev 0 —
 * the envelope `summary` (ticket 06's resolution of the ADR 0005 line-36
 * tension). No adapter derives workspace display state any other way.
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
      policy: "public_synthetic" | "sensitive_aggregate_only";
      rowCount: number;
      bytes: number;
    };

export type WorkspaceViewModel = {
  workspaceId: string;
  revision: number;
  datasetState: DatasetState;
  /** Derived display string, composed once here — header and cards share it verbatim. */
  badge: string;
  capabilities: Capability[];
  budgets: BudgetLimits;
  selectedArtifactId: string | null;
  recentArtifacts: [];
};

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
