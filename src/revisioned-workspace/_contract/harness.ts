import { createCustodyKernel } from "../../dataset-custody/kernel";
import type { AuthorizedDecision } from "../../dataset-custody/schemas";
import type { ExecutionResult } from "../../duck-engine/protocol";
import type { WorkspaceEngine } from "../../duck-engine/worker";
import { createWorkspaceStore, type WorkspaceStore } from "../store";

/**
 * The headless store harness (ticket 38; ADR 0004 am4: tests drive the store
 * directly, no React mounting). The real custody kernel decides; the engine
 * is the injectable fake (ARCHITECTURE.md: engine tests run against fakes),
 * recording every call so the zero-trace and no-partial-commit properties
 * are assertable at the one seam every adapter shares.
 */

export const FIXED_NOW = "2026-09-02T12:00:00.000Z";

export type RespawnHook = (failure: unknown) => void;

export interface FakeEngine extends WorkspaceEngine {
  readonly decisions: AuthorizedDecision[];
  readonly materialized: string[];
  readonly dropped: string[];
  /** Registers a hook fired when the store respawns the engine (cancel). */
  onRespawn(hook: RespawnHook): void;
}

/** The default fake answers by statement shape: cohort probe, sensitive aggregate, churn buckets. */
export function defaultFakeExecute(decision: AuthorizedDecision): Promise<ExecutionResult> {
  const shape = (schema: { name: string; type: string }[], values: Record<string, unknown[]>, executionMs = 12.5): ExecutionResult => ({
    schema,
    batches: [{ columns: schema, rowCount: values[Object.keys(values)[0] as string]!.length, values }],
    metrics: { executionMs, materializedRows: values[Object.keys(values)[0] as string]!.length, chartPoints: 2 },
  });
  if (decision.positionalSql.includes("min_cohort")) {
    return Promise.resolve(
      shape([{ name: "min_cohort", type: "BIGINT" }], { min_cohort: [500] }, 1),
    );
  }
  if (decision.positionalSql.includes("healthcare_pii")) {
    return Promise.resolve(
      shape(
        [
          { name: "diagnosis", type: "VARCHAR" },
          { name: "patients", type: "BIGINT" },
        ],
        { diagnosis: ["migraine", "flu"], patients: [500, 300] },
      ),
    );
  }
  return Promise.resolve(
    shape(
      [
        { name: "tickets", type: "INTEGER" },
        { name: "accounts", type: "BIGINT" },
      ],
      { tickets: [3, 9], accounts: [120, 40] },
    ),
  );
}

export function fakeEngine(
  execute: (decision: AuthorizedDecision) => Promise<ExecutionResult> = defaultFakeExecute,
): FakeEngine {
  const decisions: AuthorizedDecision[] = [];
  const materialized: string[] = [];
  const dropped: string[] = [];
  const respawnHooks: RespawnHook[] = [];
  return {
    decisions,
    materialized,
    dropped,
    onRespawn(hook) {
      respawnHooks.push(hook);
    },
    execute(decision) {
      decisions.push(decision);
      return execute(decision);
    },
    materializeRelation(relationName, result) {
      materialized.push(relationName);
      return Promise.resolve({ relationName, rowCount: result.metrics.materializedRows });
    },
    dropRelation(relationName) {
      dropped.push(relationName);
      return Promise.resolve();
    },
    respawn() {
      for (const hook of respawnHooks) {
        hook({
          code: "INTERNAL_ERROR",
          message: "The engine worker terminated while a request was in flight; the next request respawns it.",
          retryable: true,
          details: { phase: "transport" },
        });
      }
    },
  };
}

export function createStore(engine: WorkspaceEngine): WorkspaceStore {
  return createWorkspaceStore({
    kernel: createCustodyKernel(() => FIXED_NOW),
    engine,
    now: () => FIXED_NOW,
  });
}

/** Activate `saas_churn` through the real seam; returns the post-activation revision (1). */
export async function activateSaasChurn(store: WorkspaceStore): Promise<void> {
  const envelope = await store.dispatch({
    kind: "activateDataset",
    input: { datasetId: "saas_churn", expectedRevision: 0, idempotencyKey: "activate-saas-01" },
  });
  if (!envelope.ok) throw new Error(`activation failed: ${JSON.stringify(envelope.error)}`);
}

/** The churn-by-tickets analysis (§6.1 buckets). */
export const CHURN_SQL =
  "SELECT tickets, COUNT(*) AS accounts FROM saas_churn GROUP BY tickets ORDER BY tickets";

export async function runChurn(
  store: WorkspaceStore,
  key: string,
  overrides: Record<string, unknown> = {},
) {
  return store.dispatch({
    kind: "runAnalysis",
    input: {
      source: { kind: "dataset", id: "saas_churn" },
      sql: CHURN_SQL,
      bindings: {},
      expectedRevision: store.getSnapshot().revision,
      idempotencyKey: key,
      ...overrides,
    },
  });
}
