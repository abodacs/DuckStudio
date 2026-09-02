import { z } from "zod";
import {
  GetContextInputSchema,
  type BudgetLimits,
  type Capability,
  type GetContextInput,
  type Workspace,
} from "./schemas";
import { projectWorkspace } from "./projection";
import {
  failureEnvelope,
  successEnvelope,
  validationFailure,
  type Envelope,
} from "./envelope";

/**
 * The revisioned workspace (ADR 0004 am4): a React-compatible external store
 * whose `dispatch` is honest about time. Validation — and, from Slice 2,
 * staleness and idempotency — decides synchronously before the first await;
 * the commit envelope travels one awaited path every adapter shares.
 * Single-flight (§9): reads never take the slot; the skeleton has zero
 * mutating operations, so `OPERATION_CONFLICT` is unreachable until the
 * engine lands.
 *
 * The command union is open by omission, closed by schema: `getContext` and
 * nothing else. `selectArtifact` / `cancelActiveOperation` are omitted, not
 * stubbed (ticket 04) — a stub would fake success for a state that cannot
 * exist; they rejoin the union when their domain exists.
 */

/**
 * The pre-parse command shape: `input` is the schema's *input* type — `limit`
 * is optional until `getContext`'s default applies at the seam.
 */
export type DomainCommand = {
  kind: "getContext";
  input: z.input<typeof GetContextInputSchema>;
};

const DomainCommandSchema = z.strictObject({
  kind: z.literal("getContext"),
  input: GetContextInputSchema,
});

const CompiledDomainCommand = z.compile(DomainCommandSchema);

export type WorkspaceStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Workspace;
  getServerSnapshot(): Workspace;
  dispatch(command: DomainCommand): Promise<Envelope>;
  appendCapability(capability: "webmcp_native" | "simulator_only"): void;
};

/** §4.1: the workspace has a stable ID — deterministic for parity tests and the simulator. */
const WORKSPACE_ID = "ws_local_01";

/** §4.1 bootstrap capabilities; negotiation appends `webmcp_native` / `simulator_only` (ticket 14). */
const BOOTSTRAP_CAPABILITIES: Capability[] = [
  "activate_local_preset",
  "run_readonly_sql",
  "present_artifact",
  "verify_custody",
  "cancel_active_operation",
  "select_artifact",
];

/** §4.6 budget defaults; the hard maxima are custody-kernel enforcement, not seeds. */
const DEFAULT_BUDGETS: BudgetLimits = {
  executionMs: 5000,
  resultRows: 10000,
  chartPoints: 2000,
  toolSummaryBytes: 8192,
  retainedArtifacts: 20,
  contextItems: 20,
};

function createRev0Workspace(): Workspace {
  const workspace: Workspace = {
    workspaceId: WORKSPACE_ID,
    revision: 0,
    schemaVersion: "duckstudio.webmcp/v1",
    capabilities: [...BOOTSTRAP_CAPABILITIES],
    activeDatasetId: null,
    selectedArtifactId: null,
    budgets: { ...DEFAULT_BUDGETS },
    operations: [],
    recentArtifactIds: [],
  };
  // Frozen so accidental snapshot mutation fails loudly instead of leaking
  // into the next projection; the store replaces snapshots whole.
  Object.freeze(workspace.capabilities);
  Object.freeze(workspace.budgets);
  Object.freeze(workspace.operations);
  Object.freeze(workspace.recentArtifactIds);
  return Object.freeze(workspace);
}

/**
 * The one read path (ticket 04's rev-0 scope table). The seed's catalog
 * metadata stays in `demo-presets/` — the envelope reports state, the catalog
 * reports catalog, so `activeDataset` is null until a real activation.
 */
function executeGetContext(workspace: Workspace, input: GetContextInput): Envelope {
  switch (input.scope) {
    case "summary": {
      const vm = projectWorkspace(workspace);
      return successEnvelope(workspace, {
        capabilities: vm.capabilities,
        activeDataset:
          vm.datasetState.kind === "active"
            ? {
                datasetId: vm.datasetState.datasetId,
                policy: vm.datasetState.policy,
                rowCount: vm.datasetState.rowCount,
              }
            : null,
        budgets: vm.budgets,
        selectedArtifactId: vm.selectedArtifactId,
        recentArtifacts: vm.recentArtifacts,
      });
    }
    case "events": {
      // Nothing can append yet, so nothing can truncate: the buffer is empty
      // and every legal `sinceRevision` sits inside the window by
      // construction. Ring bounding and `DELTA_WINDOW_EXPIRED` land with the
      // first mutation (Slice 2).
      return successEnvelope(workspace, {
        events: [],
        oldestRetainedRevision: 0,
      });
    }
    case "schema":
      return failureEnvelope(
        workspace,
        {
          code: "DATASET_UNAVAILABLE",
          message: "No dataset is activated; the safe column schema arrives with an activation.",
          retryable: true,
          details: { activeDatasetId: workspace.activeDatasetId },
        },
        [{ kind: "human_action", action: "select_local_file" }],
      );
    case "artifact":
      return failureEnvelope(
        workspace,
        {
          code: "ARTIFACT_UNAVAILABLE",
          message: "No artifact with that id exists; artifacts arrive with the first analysis.",
          retryable: true,
          details: { artifactId: input.artifactId ?? null },
        },
        [{ kind: "tool", tool: "duckdb_get_context", input: { scope: "summary" } }],
      );
  }
}

/**
 * One tab, one workspace. The app instance is the exported binding below;
 * tests drive fresh stores headlessly through this factory without mounting
 * React (ADR 0004 am4).
 */
export function createWorkspaceStore(): WorkspaceStore {
  const listeners = new Set<() => void>();
  let workspace = createRev0Workspace();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => workspace,
    getServerSnapshot: () => workspace,
    dispatch: (command) => {
      // Synchronous seam: the validation decision is made before a promise
      // exists, so a malformed command costs one microtask, never a round
      // trip. Slice 2's staleness / idempotency checks join this phase; only
      // validated commands reach the awaited commit path.
      const parsed = CompiledDomainCommand.safeParse(command);
      if (!parsed.success) {
        return Promise.resolve(validationFailure(workspace, parsed.error));
      }
      return Promise.resolve(executeGetContext(workspace, parsed.data.input));
    },
    appendCapability: (capability) => {
      // Negotiation, not a domain event: the revision stays 0, but the
      // snapshot is replaced whole so the deep-freeze discipline holds and
      // `useSyncExternalStore` sees a new reference. A second append for the
      // same capability means two surfaces claim the tool — a defect, never
      // silently swallowed (ARCHITECTURE.md).
      if (workspace.capabilities.includes(capability)) {
        throw new Error(`store: capability "${capability}" appended twice — negotiation is a defect`);
      }
      const next: Workspace = {
        ...workspace,
        capabilities: [...workspace.capabilities, capability],
      };
      Object.freeze(next.capabilities);
      workspace = Object.freeze(next);
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

/**
 * The one app store binding (ADR 0001 am6): the agent adapters register
 * against it and the UI reads it through `useWorkspace`, so a tool dispatch
 * and the header render can never hold two different workspaces. There is no
 * second instantiation site — `boot.ts` consumes this binding, it does not
 * create a store.
 */
export const workspaceStore: WorkspaceStore = createWorkspaceStore();
