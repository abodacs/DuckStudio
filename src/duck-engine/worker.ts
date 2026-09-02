import type { AuthorizedDecision } from "../dataset-custody/schemas";
import { custodyKernel } from "../dataset-custody/kernel";
import { createEngineClient, type EngineClient, type EngineResponse, type EngineTransport } from "./protocol";
import type { ExecutionResult, MaterializedRelation } from "./protocol";

/**
 * The worker singleton (ADR 0002) and the public engine seam:
 * `executeAuthorized(decision): Promise<ExecutionResult>`. One worker per
 * session — concurrent callers and StrictMode double-mounts share one
 * promise — and crash-respawn is internal: a terminated worker clears the
 * memo so the next request spawns a fresh engine.
 *
 * Results received from the worker are registered as dataset payloads in
 * the custody kernel (grilling 24: dataset bytes = payload bytes derived
 * from preset relations or query results), so any later transport send of
 * those objects is accounted by the egress monitor.
 */

export type EngineTransportSpawner = () => EngineTransport;

export interface EngineSingleton {
  /** Idempotent; concurrent calls resolve the same client. */
  get(): Promise<EngineClient>;
  /** Cancel = respawn (grilling 31): kills the live transport, so pending
   * requests fail and the next request spawns a fresh engine. */
  respawn(): void;
}

export function createEngineSingleton(spawn: EngineTransportSpawner): EngineSingleton {
  let enginePromise: Promise<EngineClient> | null = null;
  let activeTransport: EngineTransport | null = null;
  return {
    get(): Promise<EngineClient> {
      if (!enginePromise) {
        const attempt = (async () => {
          const transport = spawn();
          activeTransport = transport;
          const client = createEngineClient(transport);
          // Crash-respawn (grilling 21): pending requests are rejected by the
          // client; the memo clears so the next request spawns a fresh worker.
          transport.onTerminated(() => {
            if (enginePromise === attempt) enginePromise = null;
          });
          return client;
        })();
        enginePromise = attempt;
        // A failed spawn must not poison the memo: the next request retries.
        void attempt.catch(() => {
          if (enginePromise === attempt) enginePromise = null;
        });
      }
      return enginePromise;
    },
    respawn() {
      // terminate() fires the terminated handlers (pending requests fail,
      // memo clears) — respawn is exactly one kill; get() does the rest.
      activeTransport?.terminate();
    },
  };
}

/**
 * The browser spawner: a module worker over `duckdb.worker.ts` (Vite
 * bundles the worker chunk). Worker errors and malformed messages count as
 * termination — the singleton respawns on the next request. An explicit
 * `terminate()` (cancel) also fires the terminated handlers, because
 * `worker.terminate()` itself raises no error event.
 */
export function spawnBrowserTransport(): EngineTransport {
  const worker = new Worker(new URL("./duckdb.worker.ts", import.meta.url), { type: "module" });
  let messageHandler: ((response: EngineResponse) => void) | null = null;
  let terminated = false;
  const terminatedHandlers: Array<() => void> = [];
  const fireTerminated = () => {
    if (terminated) return;
    terminated = true;
    for (const handler of terminatedHandlers) handler();
  };
  worker.onmessage = (event: MessageEvent) => {
    messageHandler?.(event.data as EngineResponse);
  };
  worker.onerror = () => fireTerminated();
  worker.onmessageerror = () => fireTerminated();
  return {
    postMessage: (message) => {
      worker.postMessage(message);
    },
    setMessageHandler: (handler) => {
      messageHandler = handler;
    },
    onTerminated: (handler) => {
      terminatedHandlers.push(handler);
    },
    terminate: () => {
      fireTerminated();
      worker.terminate();
    },
  };
}

/** The one app engine binding; boot warms it before the store can be used (ADR 0002 am3). */
const appEngine = createEngineSingleton(spawnBrowserTransport);

export async function warmEngine(): Promise<void> {
  const engine = await appEngine.get();
  await engine.warm();
}

/** Registers engine results so the egress monitor can account any later transport send. */
function noteResultPayloads(result: ExecutionResult): void {
  custodyKernel.noteDatasetPayload(result);
  for (const batch of result.batches) {
    custodyKernel.noteDatasetPayload(batch.values);
  }
}

/**
 * The engine seam (ARCHITECTURE.md; grilling 21): the authorized-execution
 * decision is consumed verbatim. Fails by rejecting with the §9-shaped
 * `EngineFailure` translated once at the seam — never a DuckDB error.
 */
export async function executeAuthorized(decision: AuthorizedDecision): Promise<ExecutionResult> {
  const engine = await appEngine.get();
  const result = await engine.execute(decision);
  noteResultPayloads(result);
  return result;
}

/**
 * The store's engine port (ticket 35): the four calls the mutation path
 * makes, over the one worker singleton. Injected with fakes in tests
 * (ARCHITECTURE.md: engine tests run against fakes); the app binding wires
 * the browser worker below.
 */
export interface WorkspaceEngine {
  execute(decision: AuthorizedDecision): Promise<ExecutionResult>;
  /** Creates the artifact relation from a bounded result (grilling 32). */
  materializeRelation(relationName: string, result: ExecutionResult): Promise<MaterializedRelation>;
  /** Relation-only DROP — denial cleanup and retention eviction. */
  dropRelation(relationName: string): Promise<void>;
  /** Cancel = respawn (grilling 31): kills the worker; the next request respawns it. */
  respawn(): void;
}

export const workspaceEngine: WorkspaceEngine = {
  execute: executeAuthorized,
  async materializeRelation(relationName, result) {
    const engine = await appEngine.get();
    return engine.materializeRelation(relationName, result);
  },
  async dropRelation(relationName) {
    const engine = await appEngine.get();
    await engine.dropRelation(relationName);
  },
  respawn: () => appEngine.respawn(),
};
