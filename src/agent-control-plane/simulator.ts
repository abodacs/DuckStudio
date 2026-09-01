import type { Envelope, GetContextInput } from "./envelope";
import type { WorkspaceStore } from "../revisioned-workspace/store";

/**
 * The built-in agent simulator (§14, ticket 05): a scripted client of the
 * revisioned workspace that serves the same tool surface when native WebMCP
 * is absent. It manufactures no transcript, holds no private state, and its
 * cards come from `projectWorkspace` — never a mock registry.
 */

/** The one store this simulator serves; unbound until `startSimulator` runs. */
let bound: WorkspaceStore | undefined;

/**
 * Takes over the tool surface on non-secure contexts or when the native
 * registration throws. Called only from `registration.ts`, which guarantees
 * exactly one surface ends up serving the tool.
 */
export function startSimulator(store: WorkspaceStore): void {
  bound = store;
  store.appendCapability("simulator_only");
}

/**
 * The same signature shape the native path serves. Unknown tool names and
 * calls before `startSimulator` are caller bugs and throw loudly; tool
 * inputs cross into `dispatch` unvalidated — the compiled schema inside is
 * the trust seam, so failures come back as `EnvelopeFailure`, not throws.
 */
export function invokeTool(name: string, input: unknown): Promise<Envelope> {
  if (!bound) {
    throw new Error("simulator: invokeTool before startSimulator — no workspace store is bound");
  }
  if (name !== "duckdb_get_context") {
    throw new Error(`simulator: unknown tool "${name}"`);
  }
  return bound.dispatch({ kind: "getContext", input: input as GetContextInput });
}
