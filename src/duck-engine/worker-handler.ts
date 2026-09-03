import type { AuthorizedDecision } from "../dataset-custody/schemas";
import {
  healthcarePii,
  materializedColumns,
  saasChurn,
  type PresetTriple,
} from "../demo-presets/triples";
import type { HealthcarePiiRow } from "../demo-presets/healthcare-pii";
import type { SaasChurnRow } from "../demo-presets/saas-churn";
import { toCsv } from "../demo-presets/csv";
import { IntakeCeilingError } from "./intake";
import type { EngineRequest, EngineResponse, EngineColumn } from "./protocol";
import type { ExecutionResult, IntakeResult, MaterializedRelation, WarmResult } from "./protocol";
import { shapeResult } from "./result-decode";

/**
 * The worker side of the engine protocol (ADR 0002; grilling 21/23). The
 * handler owns warm-up (instantiate + preset materialization, idempotent so
 * a StrictMode double-call or a repeat `warm` cannot re-generate) and
 * execution — where the custody decision is consumed **verbatim**: no
 * re-inspection, no re-clamping, no re-derivation of relation, SQL, budget,
 * or redaction. Engine failures are translated to §9 codes here, once —
 * messages carry recovery hints only, never raw rows, bindings, or stacks.
 *
 * `DuckEngineRuntime` is the only platform seam: the browser worker binds
 * `@duckdb/duckdb-wasm`; headless tests bind real DuckDB through
 * `@duckdb/node-api` or fakes.
 */

/** Bounded read at the runtime seam: DuckDB type names, decoded JSON-safe cells. */
export interface BoundedRead {
  readonly schema: readonly EngineColumn[];
  readonly rows: Readonly<Record<string, unknown>>[];
  readonly executionMs: number;
}

export interface DuckEngineRuntime {
  /** Instantiates the database and materializes both presets as in-memory tables. */
  warm(): Promise<WarmResult>;
  /** Runs the given positional SQL bounded to `maxRows`; the caller drops the result when over budget. */
  runBounded(sql: string, positionalBindings: readonly unknown[], maxRows: number): Promise<BoundedRead>;
  /** Creates the artifact relation from a bounded result's batches (grilling 32). */
  materialize(relationName: string, result: ExecutionResult): Promise<MaterializedRelation>;
  /** Drops a relation by name; absent names resolve silently (idempotent cleanup). */
  drop(relationName: string): Promise<void>;
  /**
   * Slice 7 intake: registers the dropped file's bytes, materializes the
   * `local_*` relation minus direct identifiers, and describes the full
   * classified schema. Ceiling denials throw {@link IntakeCeilingError}.
   */
  intake(relation: string, name: string, bytes: Uint8Array): Promise<IntakeResult>;
}

/** The presets materialize in the worker at warm time (grilling 23). */
export const PRESET_TRIPLES: readonly (PresetTriple<SaasChurnRow> | PresetTriple<HealthcarePiiRow>)[] = [
  saasChurn,
  healthcarePii,
];

/**
 * CSV materialization shared with the contract test: the materialized
 * column list is the catalog schema minus direct identifiers (the custody
 * omission rule), with explicit types so no sniffer retypes a column.
 */
export function presetCsv(triple: Pick<PresetTriple, "metadata"> & { generate: () => unknown }): {
  name: string;
  csv: string;
  columns: readonly EngineColumn[];
} {
  const columns = materializedColumns(triple);
  const rows = triple.generate() as Record<string, unknown>[];
  return {
    name: triple.metadata.datasetId,
    csv: toCsv(
      columns.map((column) => column.name),
      rows,
    ),
    columns: columns.map((column) => ({ name: column.name, type: column.type })),
  };
}

export type WorkerHandler = (request: EngineRequest) => Promise<EngineResponse>;

/** Deadline sentinel: rejects the execution race when the budget elapses. */
class BudgetDeadline extends Error {}

function budgetFailure(id: number, elapsedMs: number, limitMs: number): EngineResponse {
  return {
    id,
    kind: "execute",
    ok: false,
    failure: {
      code: "BUDGET_EXCEEDED",
      message: `Execution exceeded the ${limitMs} ms budget; no partial materialization left the engine.`,
      retryable: true,
      details: { axis: "executionMs", elapsed: Math.round(elapsedMs), limit: limitMs },
    },
  };
}

function internalFailure(
  id: number,
  phase: "execute" | "warm" | "materialize" | "drop" | "intake",
): EngineResponse {
  return {
    id,
    kind: phase === "materialize" ? "materialize" : phase === "drop" ? "drop" : phase,
    ok: false,
    failure: {
      code: "INTERNAL_ERROR",
      message: "The engine failed to execute the authorized statement; read context and retry.",
      retryable: true,
      details: { phase },
    },
  };
}

export function createWorkerHandler(runtime: DuckEngineRuntime): WorkerHandler {
  let warmPromise: Promise<WarmResult> | null = null;

  return async (request) => {
    if (request.kind === "warm") {
      try {
        // Idempotent: concurrent or repeated warm calls share one materialization.
        warmPromise ??= runtime.warm();
        return { id: request.id, kind: "warm", ok: true, result: await warmPromise };
      } catch (error) {
        // The memo clears so the next warm call retries instantiation; the
        // diagnostic stays in the worker console (DevTools) — the §9-shaped
        // response below never quotes engine internals.
        warmPromise = null;
        console.error("duck-engine: warm failed; the next warm call retries instantiation", error);
        return {
          id: request.id,
          kind: "warm",
          ok: false,
          failure: {
            code: "INTERNAL_ERROR",
            message: "The engine failed to warm up; the next warm call retries instantiation.",
            retryable: true,
            details: { phase: "warm" },
          },
        };
      }
    }

    if (request.kind === "materialize" || request.kind === "drop" || request.kind === "intake") {
      // Artifact-relation mechanics (grilling 32) and slice-7 intake: no
      // policy here — the workspace decides what the relation may contain.
      // Drop is idempotent by contract so denial cleanup and eviction never
      // race a vanished name.
      try {
        if (request.kind === "materialize") {
          return {
            id: request.id,
            kind: "materialize",
            ok: true,
            result: await runtime.materialize(request.relationName, request.result),
          };
        }
        if (request.kind === "intake") {
          return {
            id: request.id,
            kind: "intake",
            ok: true,
            result: await runtime.intake(request.relation, request.name, request.bytes),
          };
        }
        await runtime.drop(request.relationName);
        return {
          id: request.id,
          kind: "drop",
          ok: true,
          result: { relationName: request.relationName, rowCount: 0 },
        };
      } catch (error) {
        // Intake ceilings are input facts, not engine defects: they cross as
        // VALIDATION_ERROR with the human sentence (EngineFailure is not
        // widened — the code was already in its union).
        if (error instanceof IntakeCeilingError) {
          return {
            id: request.id,
            kind: "intake",
            ok: false,
            failure: {
              code: "VALIDATION_ERROR",
              message: error.message,
              retryable: false,
              details: error.details,
            },
          };
        }
        return internalFailure(request.id, request.kind);
      }
    }

    // Execute: the custody decision verbatim. The engine re-derives nothing.
    const decision: AuthorizedDecision = request.decision;
    try {
      // Ensure warm: a respawned worker re-materializes the presets before
      // its first execute, so a cancel-then-retry self-heals (ADR 0002;
      // idempotent after the first call).
      warmPromise ??= runtime.warm();
      await warmPromise;
      const read = await Promise.race([
        runtime.runBounded(
          decision.positionalSql,
          decision.positionalBindings,
          decision.budget.resultRows,
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new BudgetDeadline()), decision.budget.executionMs),
        ),
      ]);
      if (read.executionMs > decision.budget.executionMs) {
        // §4.6: reaching an execution limit returns BUDGET_EXCEEDED and no
        // partial result — the read is dropped here, not partially shipped.
        return budgetFailure(request.id, read.executionMs, decision.budget.executionMs);
      }
      return {
        id: request.id,
        kind: "execute",
        ok: true,
        result: shapeResult(read, decision.budget.chartPoints),
      };
    } catch (error) {
      // Deadline: BUDGET_EXCEEDED — the read never resolved, so nothing
      // partial escapes. Any other engine error (DuckDB diagnostic included)
      // is unclassified → INTERNAL_ERROR, retryable, with no engine message
      // (it could quote SQL or values crossing custody).
      if (error instanceof BudgetDeadline) {
        return budgetFailure(request.id, decision.budget.executionMs, decision.budget.executionMs);
      }
      return internalFailure(request.id, "execute");
    }
  };
}
