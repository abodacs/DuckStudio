import type { Envelope } from "./envelope";
import type { DomainCommand, WorkspaceStore } from "../revisioned-workspace/store";

/**
 * The built-in agent simulator (§14, ticket 05): a scripted client of the
 * revisioned workspace that serves the whole tool surface when native WebMCP
 * is absent. It manufactures no transcript, holds no private state, and its
 * cards come from `projectWorkspace` — never a mock registry.
 *
 * Slice 4 (ticket 45): the simulator serves all four tools plus the two
 * human-only workspace commands (`selectArtifact`, `cancelActiveOperation`)
 * — §8.5 lets the simulator dispatch them, while registration never lists
 * them as tools. Command names stay the domain spellings (CONTEXT.md: tools
 * and commands are two vocabularies for one seam).
 */

/** Tool name → domain command kind. Human-only commands ride their own names. */
const COMMAND_FOR_NAME: Record<string, DomainCommand["kind"]> = {
  duckdb_get_context: "getContext",
  duckdb_activate_dataset: "activateDataset",
  duckdb_execute_sql_to_canvas: "runAnalysis",
  duckdb_verify_zero_egress: "verifyCustody",
  selectArtifact: "selectArtifact",
  cancelActiveOperation: "cancelActiveOperation",
};

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
 * The same invocation shape the native path serves. Unknown tool names and
 * calls before `startSimulator` are caller bugs and throw loudly; tool
 * inputs cross into `dispatch` unvalidated — the compiled schema inside is
 * the trust seam, so failures come back as `EnvelopeFailure`, not throws.
 */
export function invokeTool(name: string, input: unknown): Promise<Envelope> {
  if (!bound) {
    throw new Error("simulator: invokeTool before startSimulator — no workspace store is bound");
  }
  const kind = COMMAND_FOR_NAME[name];
  if (!kind) {
    throw new Error(`simulator: unknown tool "${name}"`);
  }
  return bound.dispatch({ kind, input } as DomainCommand);
}
