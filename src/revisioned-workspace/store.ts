import { z } from "zod";
import { createArtifactGraph, type ArtifactGraph } from "../analysis-artifacts/graph";
import type { ResultColumn } from "../analysis-artifacts/schemas";
import { sha256Hex } from "../analysis-artifacts/sql-hash";
import { healthcarePiiPreset, saasChurnPreset } from "../demo-presets/catalog";
import { custodyKernel, governedSource, type CustodyKernel } from "../dataset-custody/kernel";
import type { CustodyFailure, GovernedSource } from "../dataset-custody/schemas";
import type { EngineFailure, ExecutionResult } from "../duck-engine/protocol";
import { workspaceEngine, type WorkspaceEngine } from "../duck-engine/worker";
import {
  downsampleChartPoints,
  measureSummary,
  resolvePresentation,
} from "./presentation";
import {
  bindPageMemory,
  createPageMemory,
  projectWorkspace,
  type GridCell,
  type GridRows,
  type PageMemory,
} from "./projection";
import {
  ActivateDatasetInputSchema,
  CancelActiveOperationInputSchema,
  GetContextInputSchema,
  RunAnalysisInputSchema,
  SelectArtifactInputSchema,
  VerifyCustodyInputSchema,
  type ActivateDatasetInput,
  type BudgetLimits,
  type Capability,
  type CancelActiveOperationInput,
  type ErrorCode,
  type GetContextInput,
  type RunAnalysisInput,
  type SelectArtifactInput,
  type VerifyCustodyInput,
  type Workspace,
  type WorkspaceEvent,
} from "./schemas";
import {
  contextDelta,
  failureEnvelope,
  forwardAction,
  recoveryActions,
  successEnvelope,
  validationFailure,
  type Envelope,
  type EnvelopeFailure,
} from "./envelope";

/**
 * The revisioned workspace (ADR 0004 am4): a React-compatible external store
 * whose `dispatch` is honest about time. Schema validation, the idempotency
 * cache, staleness, and single-flight all decide synchronously before the
 * first await; the commit envelope travels one awaited path every adapter
 * shares. The single-flight slot lives here (grilling 31): reads and
 * `selectArtifact` never take it; one mutating operation runs at a time.
 *
 * Commit ordering (grilling 31): check schema → cache → staleness →
 * single-flight → accept as `queued` → authorize (custody) → execute
 * (engine) → release confirm. The point of no return is the release
 * confirmation: append artifact → events → selection → revision+1 is one
 * synchronous in-memory step with zero awaits, so no rollback code exists.
 * Pre-release failures commit nothing — the operation records its terminal
 * state and the lifecycle event, but revision, artifacts, and selection are
 * untouched. Exact replays return the cached envelope verbatim (grilling 33).
 */

/** The six domain commands (§3.1); `input` is the schema's input type. */
export type DomainCommand =
  | { kind: "getContext"; input: z.input<typeof GetContextInputSchema> }
  | { kind: "activateDataset"; input: ActivateDatasetInput }
  | { kind: "runAnalysis"; input: RunAnalysisInput }
  | { kind: "verifyCustody"; input: VerifyCustodyInput }
  | { kind: "selectArtifact"; input: SelectArtifactInput }
  | { kind: "cancelActiveOperation"; input: CancelActiveOperationInput };

const DomainCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("getContext"), input: GetContextInputSchema }),
  z.strictObject({ kind: z.literal("activateDataset"), input: ActivateDatasetInputSchema }),
  z.strictObject({ kind: z.literal("runAnalysis"), input: RunAnalysisInputSchema }),
  z.strictObject({ kind: z.literal("verifyCustody"), input: VerifyCustodyInputSchema }),
  z.strictObject({ kind: z.literal("selectArtifact"), input: SelectArtifactInputSchema }),
  z.strictObject({ kind: z.literal("cancelActiveOperation"), input: CancelActiveOperationInputSchema }),
]);

const CompiledDomainCommand = z.compile(DomainCommandSchema);

export type WorkspaceStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Workspace;
  getServerSnapshot(): Workspace;
  dispatch(command: DomainCommand): Promise<Envelope>;
  appendCapability(capability: "webmcp_native" | "simulator_only"): void;
};

/** The kernel + engine + clock the mutation path drives; tests inject fakes (ARCHITECTURE.md). */
export interface WorkspaceStorePorts {
  readonly kernel?: CustodyKernel;
  readonly engine?: WorkspaceEngine;
  readonly now?: () => string;
}

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

/** The checked-in presets (ARCHITECTURE.md): activation binds this catalog to the workspace. */
const CATALOG: Record<"saas_churn" | "healthcare_pii", (typeof saasChurnPreset | typeof healthcarePiiPreset)> = {
  saas_churn: saasChurnPreset,
  healthcare_pii: healthcarePiiPreset,
};

/** §3.3 bounded ring; the map rules it to the §4.6 context budget (ticket 35's call). */
const EVENT_RING_LIMIT = 20;

/** §10: the idempotency cache holds the last 100 mutation keys, FIFO, silent eviction. */
const IDEMPOTENCY_CACHE_LIMIT = 100;

/** Error codes that are deterministic functions of the input (grilling 33) — cached. */
const DETERMINISTIC_CODES: ReadonlySet<EnvelopeFailure["error"]["code"]> = new Set([
  "VALIDATION_ERROR",
  "UNSAFE_SQL",
  "POLICY_DENIED",
  "BUDGET_EXCEEDED",
  "ARTIFACT_UNAVAILABLE",
]);

/** The redacted form a redacted binding takes everywhere downstream of the kernel (§4.3). */
const REDACTED = "[redacted]";

/** Stable stringify with sorted keys — the idempotency fingerprint (grilling 33). */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${stableStringify(member)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function createRev0Workspace(pageMemory: PageMemory): Workspace {
  const workspace: Workspace = {
    workspaceId: WORKSPACE_ID,
    revision: 0,
    schemaVersion: "duckstudio.webmcp/v1",
    capabilities: [...BOOTSTRAP_CAPABILITIES],
    activeDatasetId: null,
    activeDataset: null,
    selectedArtifactId: null,
    budgets: { ...DEFAULT_BUDGETS },
    operations: [],
    recentArtifactIds: [],
    artifacts: [],
    evictedArtifactIds: [],
  };
  bindPageMemory(workspace, pageMemory);
  // Frozen so accidental snapshot mutation fails loudly instead of leaking
  // into the next projection; the store replaces snapshots whole.
  Object.freeze(workspace.capabilities);
  Object.freeze(workspace.budgets);
  Object.freeze(workspace.operations);
  Object.freeze(workspace.recentArtifactIds);
  Object.freeze(workspace.artifacts);
  Object.freeze(workspace.evictedArtifactIds);
  return Object.freeze(workspace);
}

/** Engine failures cross the seam as §9-shaped rejects; anything else is a thrown value. */
function asEngineFailure(raw: unknown): EngineFailure | null {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "code" in raw &&
    "message" in raw &&
    "retryable" in raw &&
    "details" in raw
  ) {
    return raw as EngineFailure;
  }
  return null;
}

/**
 * One tab, one workspace. The app instance is the exported binding below;
 * tests drive fresh stores headlessly through this factory without mounting
 * React (ADR 0004 am4) and inject the kernel/engine seams.
 */
export function createWorkspaceStore(ports: WorkspaceStorePorts = {}): WorkspaceStore {
  const kernel = ports.kernel ?? custodyKernel;
  const engine = ports.engine ?? workspaceEngine;
  const now = ports.now ?? (() => new Date().toISOString());

  const listeners = new Set<() => void>();
  const pageMemory = createPageMemory();
  let workspace = createRev0Workspace(pageMemory);
  const graph: ArtifactGraph = createArtifactGraph();
  const eventRing: WorkspaceEvent[] = [];
  const idempotencyCache = new Map<string, { fingerprint: string; envelope: Envelope }>();
  /** The single-flight slot (grilling 31): one mutating operation at a time. */
  let activeOperation: { operationId: string; kind: "activate_dataset" | "run_analysis" } | null = null;
  let operationCounter = 0;
  /** Set by a cancel command; the targeted op checks it after every awaited phase. */
  let cancelRequested = false;

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function cacheSet(key: string, fingerprint: string, envelope: Envelope): void {
    if (idempotencyCache.size >= IDEMPOTENCY_CACHE_LIMIT) {
      const oldest = idempotencyCache.keys().next().value;
      if (oldest !== undefined) idempotencyCache.delete(oldest);
    }
    // Frozen so a replayed envelope cannot be mutated into a forked history.
    idempotencyCache.set(key, { fingerprint, envelope: Object.freeze(envelope) });
  }

  function appendEvents(events: WorkspaceEvent[]): void {
    eventRing.push(...events);
    while (eventRing.length > EVENT_RING_LIMIT) {
      eventRing.shift();
    }
  }

  function replaceWorkspace(next: Workspace): void {
    bindPageMemory(next, pageMemory);
    Object.freeze(next.capabilities);
    Object.freeze(next.budgets);
    Object.freeze(next.operations);
    Object.freeze(next.recentArtifactIds);
    Object.freeze(next.artifacts);
    Object.freeze(next.evictedArtifactIds);
    workspace = Object.freeze(next);
    notify();
  }

  /** Accepts a mutating operation into the single-flight slot, recorded `queued` (grilling 31). */
  function acceptOperation(kind: "activate_dataset" | "run_analysis", sourceId?: string): string {
    operationCounter += 1;
    const operationId = `op_${String(operationCounter).padStart(2, "0")}`;
    activeOperation = { operationId, kind };
    replaceWorkspace({
      ...workspace,
      operations: [
        ...workspace.operations,
        {
          operationId,
          kind,
          status: "queued",
          ...(sourceId === undefined ? {} : { sourceId }),
          startedAt: now(),
        },
      ],
    });
    return operationId;
  }

  function markRunning(operationId: string): void {
    replaceWorkspace({
      ...workspace,
      operations: workspace.operations.map((operation) =>
        operation.operationId === operationId ? { ...operation, status: "running" } : operation,
      ),
    });
  }

  function finishOperation(
    operationId: string,
    status: "succeeded" | "failed" | "cancelled",
    errorCode?: ErrorCode,
  ): void {
    replaceWorkspace({
      ...workspace,
      operations: workspace.operations.map((operation) =>
        operation.operationId === operationId
          ? {
              ...operation,
              status,
              finishedAt: now(),
              ...(errorCode === undefined ? {} : { errorCode }),
            }
          : operation,
      ),
    });
  }

  function releaseSlot(): void {
    activeOperation = null;
  }

  /**
   * Terminal failure of an accepted operation: the operation records
   * `failed`, the `analysis_failed` lifecycle event fires, and the slot
   * releases — but nothing commits (grilling 31): revision, artifacts, and
   * selection are untouched. The §9 recovery table names the next actions.
   */
  function failOperation(operationId: string, failure: CustodyFailure): Envelope {
    finishOperation(operationId, "failed", failure.code);
    appendEvents([
      { revision: workspace.revision, at: now(), kind: "analysis_failed", operationId, errorCode: failure.code },
    ]);
    releaseSlot();
    return failureEnvelope(workspace, failure, recoveryActions(failure, workspace));
  }

  /**
   * The cancelled operation's own settle path (grilling 31): the cancel
   * command already committed, so the op leaves zero trace — no failure
   * status, no event, no cleanup on the (already dead) worker.
   */
  function settleCancelled(operationId: string): Envelope {
    cancelRequested = false;
    releaseSlot();
    const error: EnvelopeFailure["error"] = {
      code: "OPERATION_CANCELLED",
      message: "The operation was cancelled at the human's request; reconfirm intent before retrying.",
      retryable: true,
      details: { operationId },
    };
    return failureEnvelope(workspace, error, recoveryActions(error, workspace));
  }

  /** The mutation check order (grilling 31/33): schema → cache → staleness → single-flight. */
  function dispatchMutation(
    kind: "activateDataset" | "runAnalysis" | "selectArtifact" | "cancelActiveOperation",
    input: { idempotencyKey: string; expectedRevision: number } & Record<string, unknown>,
  ): Promise<Envelope> {
    const cached = idempotencyCache.get(input.idempotencyKey);
    const fingerprint = stableStringify(input);
    if (cached) {
      if (cached.fingerprint === fingerprint) {
        // Exact replay: the original envelope verbatim — staleness never applies.
        return Promise.resolve(cached.envelope);
      }
      return Promise.resolve(
        failureEnvelope(
          workspace,
          {
            code: "IDEMPOTENCY_CONFLICT",
            message: "The idempotency key was already used for a different input; use a new key or resend the original command exactly.",
            retryable: false,
            details: { idempotencyKey: input.idempotencyKey },
          },
          [],
        ),
      );
    }
    if (input.expectedRevision !== workspace.revision) {
      const error: EnvelopeFailure["error"] = {
        code: "STALE_REVISION",
        message: `Expected revision ${input.expectedRevision}; current revision is ${workspace.revision}.`,
        retryable: true,
        details: { expectedRevision: input.expectedRevision, currentRevision: workspace.revision },
      };
      return Promise.resolve(failureEnvelope(workspace, error, recoveryActions(error, workspace)));
    }
    // Single-flight (§9): one mutating operation at a time. Reads,
    // `selectArtifact` (not an operation), and cancel (it targets the
    // running operation) never take or collide with the slot.
    if (activeOperation && (kind === "activateDataset" || kind === "runAnalysis")) {
      const error: EnvelopeFailure["error"] = {
        code: "OPERATION_CONFLICT",
        message: `Operation ${activeOperation.operationId} (${activeOperation.kind}) is running; wait for it or cancel it.`,
        retryable: true,
        details: { runningOperationId: activeOperation.operationId, runningKind: activeOperation.kind },
      };
      return Promise.resolve(failureEnvelope(workspace, error, recoveryActions(error, workspace)));
    }

    // Deterministic validation failures inside the phases below are cached
    // (grilling 33) so an exact retry re-answers instead of re-burning work.
    if (kind === "activateDataset") {
      return runActivate(input as unknown as ActivateDatasetInput, fingerprint);
    }
    if (kind === "runAnalysis") {
      return runAnalysis(input as unknown as RunAnalysisInput, fingerprint);
    }
    if (kind === "selectArtifact") {
      return runSelectArtifact(input as unknown as SelectArtifactInput, fingerprint);
    }
    return runCancel(input as unknown as CancelActiveOperationInput, fingerprint);
  }

  /**
   * Activation is an in-memory commit — the presets materialize at warm, so
   * the whole lifecycle (accept → succeed) is one synchronous step with no
   * awaits. Re-activating the active dataset is a uniform commit (grilling 31).
   */
  function runActivate(input: ActivateDatasetInput, fingerprint: string): Promise<Envelope> {
    const before = projectWorkspace(workspace);
    const operationId = acceptOperation("activate_dataset", input.datasetId);
    const catalog = CATALOG[input.datasetId];
    const revision = workspace.revision + 1;
    const activeDataset = Object.freeze({ ...catalog });
    replaceWorkspace({
      ...workspace,
      revision,
      activeDatasetId: catalog.datasetId,
      activeDataset,
      operations: workspace.operations.map((operation) =>
        operation.operationId === operationId
          ? { ...operation, status: "succeeded", finishedAt: now() }
          : operation,
      ),
    });
    appendEvents([{ revision, at: now(), kind: "dataset_activated", operationId, datasetId: catalog.datasetId }]);
    releaseSlot();
    const envelope = successEnvelope(
      workspace,
      {
        datasetId: catalog.datasetId,
        schemaDigest: catalog.schemaDigest,
        rowCount: catalog.rowCount,
        byteSizeEstimate: catalog.byteSizeEstimate,
        policy: catalog.policy,
        minimumCohortSize: catalog.minimumCohortSize,
      },
      {
        contextDelta: contextDelta(before, projectWorkspace(workspace)),
        nextActions: forwardAction("activateDataset", workspace, catalog.datasetId),
      },
    );
    cacheSet(input.idempotencyKey, fingerprint, envelope);
    return Promise.resolve(envelope);
  }

  /** Human-only selection: a mutation, never an operation — the slot stays free (§4.4). */
  function runSelectArtifact(input: SelectArtifactInput, fingerprint: string): Promise<Envelope> {
    const availability = graph.availability(input.artifactId);
    if (availability !== "available") {
      const error: EnvelopeFailure["error"] = {
        code: "ARTIFACT_UNAVAILABLE",
        message:
          availability === "relation_evicted"
            ? "The artifact's materialized relation was evicted by retention; its metadata remains."
            : "No artifact with that id exists.",
        retryable: true,
        details:
          availability === "relation_evicted"
            ? { artifactId: input.artifactId, reason: "relation_evicted" }
            : { artifactId: input.artifactId },
      };
      const failure: Envelope = failureEnvelope(workspace, error, recoveryActions(error, workspace));
      cacheSet(input.idempotencyKey, fingerprint, failure);
      return Promise.resolve(failure);
    }
    const before = projectWorkspace(workspace);
    const revision = workspace.revision + 1;
    replaceWorkspace({
      ...workspace,
      revision,
      selectedArtifactId: input.artifactId,
      recentArtifactIds: [input.artifactId, ...workspace.recentArtifactIds.filter((id) => id !== input.artifactId)],
    });
    appendEvents([{ revision, at: now(), kind: "artifact_selected", artifactId: input.artifactId }]);
    const envelope = successEnvelope(workspace, { artifactId: input.artifactId }, {
      contextDelta: contextDelta(before, projectWorkspace(workspace)),
    });
    cacheSet(input.idempotencyKey, fingerprint, envelope);
    return Promise.resolve(envelope);
  }

  /** Cancel = respawn + `cancelled` + revision bump; the cancelled op resolves `OPERATION_CANCELLED` (grilling 31). */
  function runCancel(input: CancelActiveOperationInput, fingerprint: string): Promise<Envelope> {
    const running = activeOperation;
    if (!running || (input.operationId !== undefined && input.operationId !== running.operationId)) {
      const error: EnvelopeFailure["error"] = {
        code: "VALIDATION_ERROR",
        message: input.operationId
          ? `Operation ${input.operationId} is not the running operation.`
          : "No operation is running to cancel.",
        retryable: false,
        details: { operationId: input.operationId ?? running?.operationId ?? null },
      };
      const failure: Envelope = failureEnvelope(workspace, error, recoveryActions(error, workspace));
      cacheSet(input.idempotencyKey, fingerprint, failure);
      return Promise.resolve(failure);
    }
    const before = projectWorkspace(workspace);
    cancelRequested = true;
    engine.respawn();
    const revision = workspace.revision + 1;
    replaceWorkspace({
      ...workspace,
      revision,
      operations: workspace.operations.map((operation) =>
        operation.operationId === running.operationId
          ? { ...operation, status: "cancelled", finishedAt: now() }
          : operation,
      ),
    });
    appendEvents([{ revision, at: now(), kind: "operation_cancelled", operationId: running.operationId }]);
    const envelope = successEnvelope(workspace, { operationId: running.operationId }, {
      contextDelta: contextDelta(before, projectWorkspace(workspace)),
    });
    cacheSet(input.idempotencyKey, fingerprint, envelope);
    return Promise.resolve(envelope);
  }

  /**
   * The atomic path (ticket 37): authorize → execute → materialize → release
   * confirm are the awaited phases; everything after release confirmation is
   * one synchronous in-memory commit (artifact + events + selection +
   * revision), then post-commit retention eviction.
   */
  async function runAnalysis(input: RunAnalysisInput, fingerprint: string): Promise<Envelope> {
    const operationId = acceptOperation("run_analysis", input.source.id);
    const identity = graph.previewIdentity();
    let source: GovernedSource;
    let sourceRowCount: number;

    if (input.source.kind === "dataset") {
      const dataset = workspace.activeDatasetId === input.source.id ? workspace.activeDataset : null;
      if (!dataset) {
        return settleFailure(operationId, input.idempotencyKey, fingerprint, {
          code: "DATASET_UNAVAILABLE",
          message: `Dataset ${input.source.id} is not active; activate it first.`,
          retryable: true,
          details: { datasetId: input.source.id, activeDatasetId: workspace.activeDatasetId },
        });
      }
      source = governedSource(dataset);
      sourceRowCount = dataset.rowCount;
    } else {
      const availability = graph.availability(input.source.id);
      const record = graph.find(input.source.id);
      if (!record || availability !== "available") {
        return settleFailure(operationId, input.idempotencyKey, fingerprint, {
          code: "ARTIFACT_UNAVAILABLE",
          message:
            availability === "relation_evicted"
              ? "The artifact's relation was evicted by retention; recompute it to refine."
              : "No artifact with that id exists.",
          retryable: true,
          details:
            availability === "relation_evicted"
              ? { artifactId: input.source.id, reason: "relation_evicted" }
              : { artifactId: input.source.id },
        });
      }
      source = {
        relation: record.artifact.relationName,
        policy: record.artifact.policy,
        minimumCohortSize: record.artifact.release.cohortMinimum,
        columns: record.artifact.schema,
      };
      sourceRowCount = record.artifact.rowCount;
    }

    markRunning(operationId);

    // authorize (custody, synchronous)
    const authorized = kernel.authorize({
      source,
      sql: input.sql,
      bindings: input.bindings,
      requestedBudget: input.budget,
    });
    if (!authorized.ok) {
      return settleFailure(operationId, input.idempotencyKey, fingerprint, authorized.failure);
    }

    // execute (engine, awaited) — rejection is the §9-shaped EngineFailure.
    // A cancel landing between phases leaves zero trace: the worker died
    // with its relations, so there is nothing to clean up.
    let result: ExecutionResult;
    try {
      result = await engine.execute(authorized.decision);
    } catch (raw) {
      if (cancelRequested) return settleCancelled(operationId);
      const failure = asEngineFailure(raw) ?? internalFailure();
      return settleFailure(operationId, input.idempotencyKey, fingerprint, failure);
    }
    if (cancelRequested) return settleCancelled(operationId);

    // materialize the artifact relation under the generated name (grilling 32)
    try {
      await engine.materializeRelation(identity.relationName, result);
    } catch (raw) {
      if (cancelRequested) return settleCancelled(operationId);
      await engine.dropRelation(identity.relationName).catch(() => undefined);
      const failure = asEngineFailure(raw) ?? internalFailure();
      return settleFailure(operationId, input.idempotencyKey, fingerprint, failure);
    }
    if (cancelRequested) return settleCancelled(operationId);

    // release confirm (custody) — the point of no return. One kernel entry
    // owns the differencing guard and the decision (CONTEXT.md: the kernel's
    // pieces are never invoked directly); the store only runs its probe.
    const release = await kernel.confirmRelease({
      source,
      decision: authorized.decision,
      sql: input.sql,
      bindings: input.bindings,
      resultSchema: result.schema,
      materializedRows: result.metrics.materializedRows,
      sourceRowCount,
      executeProbe: async (probeDecision) => {
        const read = await engine.execute(probeDecision);
        const value = read.batches[0]?.values.min_cohort?.[0];
        return value === undefined || value === null ? null : Number(value);
      },
    });
    if (cancelRequested) return settleCancelled(operationId);
    if (!release.ok) {
      await engine.dropRelation(identity.relationName).catch(() => undefined);
      return settleFailure(operationId, input.idempotencyKey, fingerprint, release.failure);
    }

    // presentation: inference is policy-aware; supplied elements deny over strip (grilling 34)
    const classifiedSchema = classifyResultSchema(source, result.schema);
    const presentation = resolvePresentation({
      policy: source.policy,
      resultSchema: classifiedSchema,
      omittedColumns: release.release.omittedDirectIdentifiers,
      supplied: input.presentation,
    });
    if (!presentation.ok) {
      await engine.dropRelation(identity.relationName).catch(() => undefined);
      const failure = "denial" in presentation ? presentation.denial : presentation.validation;
      return settleFailure(operationId, input.idempotencyKey, fingerprint, failure);
    }

    // chart downsampling discloses {requested, emitted}; the spec is unchanged
    const downsample = downsampleChartPoints(presentation.spec, result.metrics.chartPoints);
    const metrics = {
      executionMs: result.metrics.executionMs,
      materializedRows: result.metrics.materializedRows,
      chartPoints: downsample.emitted,
    };
    const summary = measureSummary(presentation.spec, result, downsample.emitted);

    // ---- POINT OF NO RETURN: one synchronous in-memory commit, zero awaits ----
    const before = projectWorkspace(workspace);
    const record = graph.append({
      source: input.source,
      sourceRevision: workspace.revision,
      sql: input.sql,
      sqlHash: sha256Hex(input.sql),
      bindings: redactBindings(input.bindings, authorized.decision.redactedBindingKeys),
      schema: classifiedSchema,
      rowCount: result.metrics.materializedRows,
      policy: source.policy,
      release: release.release,
      presentation: presentation.spec,
      metrics,
      createdAt: now(),
      summary,
    });
    const revision = workspace.revision + 1;
    const artifactId = record.artifact.artifactId;
    // Page memory lands with the commit (grilling 51): the bounded row
    // cache and the §8.4 evidence snapshot the Custody view and the
    // suppression counters merge synchronously from the projection.
    pageMemory.captureRows(
      artifactId,
      captureRows(
        result,
        Math.min(
          authorized.decision.budget.resultRows,
          presentation.spec.grid?.maxRows ?? authorized.decision.budget.resultRows,
        ),
      ),
    );
    pageMemory.captureEvidence(artifactId, {
      ...kernel.evidence({ kind: "artifact", id: artifactId }, record.artifact.policy),
      lineage: [...record.artifact.lineage, { kind: "artifact", id: artifactId }],
    });
    replaceWorkspace({
      ...workspace,
      revision,
      selectedArtifactId: artifactId,
      recentArtifactIds: [artifactId, ...workspace.recentArtifactIds],
      artifacts: [...workspace.artifacts, record],
      operations: workspace.operations.map((operation) =>
        operation.operationId === operationId
          ? { ...operation, status: "succeeded", artifactId, finishedAt: now() }
          : operation,
      ),
    });
    appendEvents([
      { revision, at: now(), kind: "analysis_succeeded", operationId, artifactId },
      { revision, at: now(), kind: "artifact_selected", operationId, artifactId },
    ]);
    releaseSlot();

    const warnings: Extract<Envelope, { ok: true }>["warnings"] = authorized.warnings.map((budgetWarning) => ({
      code: budgetWarning.code,
      message: budgetWarning.message,
      details: { ...budgetWarning.details },
    }));
    if (downsample.warning) {
      warnings.push({
        code: "CHART_DOWNSAMPLED",
        message: `The chart was downsampled from ${downsample.warning.requested} to ${downsample.warning.emitted} points.`,
        details: { requested: downsample.warning.requested, emitted: downsample.warning.emitted },
      });
    }
    const envelope = {
      ...successEnvelope(
        workspace,
        {
          operationId,
          artifact: {
            artifactId: record.artifact.artifactId,
            relationName: record.artifact.relationName,
            source: record.artifact.source,
            rowCount: record.artifact.rowCount,
            schema: record.artifact.schema,
            lineage: record.artifact.lineage,
            release: record.artifact.release,
          },
          summary: record.summary,
          metrics,
        },
        {
          warnings,
          contextDelta: contextDelta(before, projectWorkspace(workspace)),
          nextActions: forwardAction("runAnalysis", workspace, artifactId),
        },
      ),
    };
    cacheSet(input.idempotencyKey, fingerprint, envelope);

    // Post-commit retention (grilling 32): relation-only DROP after the
    // commit landed; the newest artifact is always retained. A failed drop
    // keeps the metadata and retries on a later commit.
    for (const evictedId of graph.retentionDrops(workspace.budgets.retainedArtifacts)) {
      const relationName = graph.find(evictedId)?.artifact.relationName;
      if (!relationName) continue;
      try {
        await engine.dropRelation(relationName);
        graph.markEvicted(evictedId);
        // The ring dropped the relation; its page memory goes with it —
        // released here, where the eviction is decided. A failed drop
        // leaves the artifact retained — the cache stays so the retry on a
        // later commit (grilling 32) still finds its rows.
        pageMemory.release(evictedId);
      } catch {
        continue;
      }
    }
    const evictedIds = graph
      .all()
      .map((entry) => entry.artifact.artifactId)
      .filter((id) => graph.availability(id) === "relation_evicted");
    if (evictedIds.length !== workspace.evictedArtifactIds.length) {
      replaceWorkspace({ ...workspace, evictedArtifactIds: evictedIds });
    }

    return envelope;
  }

  function settleFailure(
    operationId: string,
    key: string,
    fingerprint: string,
    failure: CustodyFailure,
  ): Envelope {
    const envelope = failOperation(operationId, failure);
    if (DETERMINISTIC_CODES.has(failure.code)) {
      cacheSet(key, fingerprint, envelope);
    }
    return envelope;
  }

  function classifyResultSchema(source: GovernedSource, schema: ExecutionResult["schema"]): ResultColumn[] {
    const byName = new Map(source.columns.map((column) => [column.name, column]));
    return schema.map((column) => {
      const known = byName.get(column.name);
      return {
        name: column.name,
        type: column.type,
        classification: known?.classification ?? "public",
        ...(known?.classification === "direct_identifier" ? { omitted: true } : {}),
      };
    });
  }

  function redactBindings(
    bindings: RunAnalysisInput["bindings"],
    redactedKeys: readonly string[],
  ): Record<string, string | number | boolean | null> {
    const redacted: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(bindings)) {
      redacted[key] = redactedKeys.includes(key) ? REDACTED : value;
    }
    return redacted;
  }

  /**
   * The bounded row cache capture (grilling 51 item 3): the commit's batches
   * flatten into page memory, capped at `min(resultRows, grid.maxRows)` —
   * the projection merges them synchronously, so no view ever fetches from
   * the engine at render.
   */
  function captureRows(result: ExecutionResult, limit: number): GridRows {
    const columns = result.schema.map((column) => column.name);
    const rows: GridCell[][] = [];
    let remaining = limit;
    for (const batch of result.batches) {
      for (let index = 0; index < batch.rowCount && remaining > 0; index += 1, remaining -= 1) {
        rows.push(columns.map((column) => (batch.values[column]?.[index] as GridCell) ?? null));
      }
      if (remaining <= 0) break;
    }
    return rows;
  }

  function internalFailure(): CustodyFailure {
    return {
      code: "INTERNAL_ERROR",
      message: "The analysis failed inside the engine; read context and retry.",
      retryable: true,
      details: { phase: "execute" },
    };
  }

  function executeGetContext(current: Workspace, input: GetContextInput): Envelope {
    switch (input.scope) {
      case "summary": {
        const vm = projectWorkspace(current);
        return successEnvelope(current, {
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
      case "schema": {
        const dataset = current.activeDatasetId === input.datasetId ? current.activeDataset : null;
        if (!dataset) {
          const error: EnvelopeFailure["error"] = {
            code: "DATASET_UNAVAILABLE",
            message: `Dataset ${input.datasetId} is not active; activate it to read its safe column schema.`,
            retryable: true,
            details: { datasetId: input.datasetId as string, activeDatasetId: current.activeDatasetId },
          };
          return failureEnvelope(current, error, recoveryActions(error, current));
        }
        return successEnvelope(current, {
          datasetId: dataset.datasetId,
          policy: dataset.policy,
          minimumCohortSize: dataset.minimumCohortSize,
          schema: dataset.columns.map((column) =>
            column.classification === "direct_identifier" ? { ...column, omitted: true } : column,
          ),
        });
      }
      case "artifact": {
        const artifactId = input.artifactId as string;
        const availability = graph.availability(artifactId);
        const record = graph.find(artifactId);
        if (availability !== "available" || !record) {
          const error: EnvelopeFailure["error"] = {
            code: "ARTIFACT_UNAVAILABLE",
            message:
              availability === "relation_evicted"
                ? "The artifact's materialized relation was evicted by retention; its metadata remains in the graph."
                : "No artifact with that id exists; artifacts arrive with the first analysis.",
            retryable: true,
            details:
              availability === "relation_evicted"
                ? { artifactId, reason: "relation_evicted" }
                : { artifactId },
          };
          return failureEnvelope(current, error, recoveryActions(error, current));
        }
        return successEnvelope(current, { artifact: record.artifact, summary: record.summary });
      }
      case "events": {
        const oldestRetainedRevision = eventRing.length > 0 ? (eventRing[0] as WorkspaceEvent).revision : 0;
        const since = input.sinceRevision;
        if (since !== undefined && since < oldestRetainedRevision) {
          return {
            ...successEnvelope(current, {
              events: [...eventRing],
              oldestRetainedRevision,
            }),
            warnings: [
              {
                code: "DELTA_WINDOW_EXPIRED",
                message: `Revision ${since} is older than the retained event window; the full retained log follows.`,
                details: { sinceRevision: since, oldestRetainedRevision },
              },
            ],
          };
        }
        const events = since === undefined ? [...eventRing] : eventRing.filter((event) => event.revision > since);
        return successEnvelope(current, { events, oldestRetainedRevision });
      }
    }
  }

  function executeVerifyCustody(current: Workspace, input: VerifyCustodyInput): Envelope {
    if (input.scope === "workspace") {
      return successEnvelope(
        current,
        kernel.evidence({ kind: "workspace", id: current.workspaceId }, current.activeDataset?.policy ?? null),
      );
    }
    if (input.scope === "operation") {
      const operation = current.operations.find((entry) => entry.operationId === input.operationId);
      if (!operation) {
        const error: EnvelopeFailure["error"] = {
          code: "VALIDATION_ERROR",
          message: `No operation ${input.operationId} exists in this tab session.`,
          retryable: false,
          details: { operationId: input.operationId as string },
        };
        return failureEnvelope(current, error, recoveryActions(error, current));
      }
      const record = operation.artifactId ? graph.find(operation.artifactId) : undefined;
      const evidence = kernel.evidence(
        { kind: "operation", id: operation.operationId },
        record?.artifact.policy ?? current.activeDataset?.policy ?? null,
      );
      return successEnvelope(current, {
        ...evidence,
        lineage: record
          ? [...record.artifact.lineage, { kind: "artifact" as const, id: record.artifact.artifactId }]
          : [],
      });
    }
    const artifactId = input.artifactId as string;
    const record = graph.find(artifactId);
    if (!record) {
      const error: EnvelopeFailure["error"] = {
        code: "ARTIFACT_UNAVAILABLE",
        message: "No artifact with that id exists; artifacts arrive with the first analysis.",
        retryable: true,
        details: { artifactId },
      };
      return failureEnvelope(current, error, recoveryActions(error, current));
    }
    // Evicted artifacts keep their metadata disclosed — evidence survives
    // the relation-only eviction (grilling 32).
    const evidence = kernel.evidence({ kind: "artifact", id: artifactId }, record.artifact.policy);
    return successEnvelope(current, {
      ...evidence,
      lineage: [...record.artifact.lineage, { kind: "artifact" as const, id: artifactId }],
    });
  }

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
      // Synchronous seam: validation, cache, staleness, and single-flight
      // decide before a promise exists, so a malformed or stale command
      // costs one microtask, never a round trip (ADR 0004 am4).
      const parsed = CompiledDomainCommand.safeParse(command);
      if (!parsed.success) {
        return Promise.resolve(validationFailure(workspace, parsed.error));
      }
      const parsedCommand = parsed.data;
      if (parsedCommand.kind === "getContext") {
        return Promise.resolve(executeGetContext(workspace, parsedCommand.input));
      }
      if (parsedCommand.kind === "verifyCustody") {
        return Promise.resolve(executeVerifyCustody(workspace, parsedCommand.input));
      }
      return dispatchMutation(parsedCommand.kind, parsedCommand.input);
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
      bindPageMemory(next, pageMemory);
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
 * and the header render can never hold two different workspaces. It wires
 * the real custody kernel and engine singleton; tests inject fakes through
 * {@link createWorkspaceStore}'s ports.
 */
export const workspaceStore: WorkspaceStore = createWorkspaceStore();
