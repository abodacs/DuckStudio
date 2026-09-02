import type { ErrorCode } from "../revisioned-workspace/schemas";
import type { AuthorizedDecision } from "../dataset-custody/schemas";

/**
 * The engine protocol (ADR 0002; grilling 21): one typed request/response
 * union over a message transport, one monotonic correlation counter — no
 * `Date.now()` ad-hoc ids — and one translation point where engine failures
 * become §9 codes (resolution 21). The main-thread client and the worker
 * handler are the two ends; `duck-engine/worker.ts` binds the browser end,
 * tests bind fakes.
 *
 * The custody decision type is owned by `dataset-custody/` (ARCHITECTURE.md:
 * the engine consumes it verbatim and re-derives nothing).
 */

/** Result column description, mirroring the schema digest's name/type pair. */
export interface EngineColumn {
  readonly name: string;
  readonly type: string;
}

/** One bounded, columnar result batch (structured-clone safe). */
export interface EngineBatch {
  readonly columns: readonly EngineColumn[];
  readonly rowCount: number;
  /** Column values; length equals `rowCount` for every entry. */
  readonly values: Readonly<Record<string, unknown[]>>;
}

/** §4.3 ExecutionMetrics — measured, never request echoes. */
export interface ExecutionMetrics {
  readonly executionMs: number;
  readonly materializedRows: number;
  readonly chartPoints: number;
}

/** Resolution 21's `ExecutionResult`: schema, bounded batches, measured metrics. */
export interface ExecutionResult {
  readonly schema: readonly EngineColumn[];
  readonly batches: readonly EngineBatch[];
  readonly metrics: ExecutionMetrics;
}

/** Measured warm outcome: preset relations materialized in the worker at boot. */
export interface WarmResult {
  readonly materializedRelations: readonly {
    readonly relationName: string;
    readonly rowCount: number;
  }[];
  readonly warmMs: number;
  readonly materializationMs: number;
}

/**
 * §9 EngineFailure — the single translation of anything that went wrong
 * inside the engine. Messages and details carry recovery hints only: no raw
 * rows, no sensitive bindings, no stack traces (§9; SECURITY.md).
 */
export interface EngineFailure {
  readonly code: Extract<ErrorCode, "BUDGET_EXCEEDED" | "INTERNAL_ERROR" | "VALIDATION_ERROR">;
  readonly message: string;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

/** Request union. `decision` is the custody kernel's object, consumed verbatim. */
export type EngineRequest =
  | { readonly id: number; readonly kind: "warm" }
  | {
      readonly id: number;
      readonly kind: "execute";
      readonly decision: AuthorizedDecision;
    };

/** Response union — the `kind` echoes the request `kind`. */
export type EngineResponse =
  | { readonly id: number; readonly kind: "warm"; readonly ok: true; readonly result: WarmResult }
  | { readonly id: number; readonly kind: "warm"; readonly ok: false; readonly failure: EngineFailure }
  | { readonly id: number; readonly kind: "execute"; readonly ok: true; readonly result: ExecutionResult }
  | { readonly id: number; readonly kind: "execute"; readonly ok: false; readonly failure: EngineFailure };

/**
 * The transport both ends agree on. A `Worker` in the browser, an in-process
 * fake in tests; `onTerminated` fires when the worker dies while requests
 * are pending (crash-respawn is the singleton's job, not the client's).
 */
export interface EngineTransport {
  postMessage(message: EngineRequest): void;
  setMessageHandler(handler: (response: EngineResponse) => void): void;
  onTerminated(handler: () => void): void;
}

/** Client-side safety net: the worker enforces budgets itself, so the client timeout only bounds a dead transport. */
const CLIENT_TIMEOUT_MS = 30_000;

/**
 * The main-thread client end. Requests are correlated by a monotonic id;
 * a worker crash or timeout rejects every pending request with an
 * `INTERNAL_ERROR` failure — never a hang, never a raw event.
 */
export interface EngineClient {
  warm(): Promise<WarmResult>;
  execute(decision: AuthorizedDecision): Promise<ExecutionResult>;
}

/** Distributive `Omit` so the request union stays a union without `id`. */
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

/** Request shape before the client assigns the correlation id. */
export type EngineRequestInput = WithoutId<EngineRequest>;

export function createEngineClient(transport: EngineTransport): EngineClient {
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: never) => void; reject: (reason: EngineFailure) => void; timer: ReturnType<typeof setTimeout> }
  >();

  function failAll(failure: EngineFailure): void {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(failure);
    }
    pending.clear();
  }

  transport.setMessageHandler((response) => {
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    clearTimeout(entry.timer);
    if (response.ok) {
      (entry.resolve as (value: WarmResult | ExecutionResult) => void)(response.result);
    } else {
      entry.reject(response.failure);
    }
  });

  transport.onTerminated(() => {
    failAll({
      code: "INTERNAL_ERROR",
      message: "The engine worker terminated while a request was in flight; the next request respawns it.",
      retryable: true,
      details: { phase: "transport" },
    });
  });

  function request<T extends WarmResult | ExecutionResult>(
    message: EngineRequestInput,
  ): Promise<T> {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject({
          code: "INTERNAL_ERROR",
          message: "The engine worker did not answer in time; the request was dropped, not partially applied.",
          retryable: true,
          details: { phase: "transport", timeoutMs: CLIENT_TIMEOUT_MS },
        });
      }, CLIENT_TIMEOUT_MS);
      pending.set(id, { resolve: resolve as (value: never) => void, reject, timer });
      transport.postMessage({ ...message, id } as EngineRequest);
    });
  }

  return {
    warm: () => request<WarmResult>({ kind: "warm" }),
    execute: (decision) => request<ExecutionResult>({ kind: "execute", decision }),
  };
}
