import { z } from "zod";
import {
  GET_CONTEXT_TOOL_DESCRIPTION,
  GetContextInputSchema,
  type Envelope,
  type GetContextInput,
} from "./envelope";
import { startSimulator } from "./simulator";
import type { WorkspaceStore } from "../revisioned-workspace/store";

/**
 * WebMCP registration for the one tool (ticket 05/14). The pure factory is
 * what makes the parity test possible — jsdom/node has no
 * `document.modelContext`, so the test invokes `def.execute` directly. The
 * imperative side is the only caller of `registerTool`; `navigator.modelContext`
 * is deliberately absent (deprecated in Chromium 150) and there is no
 * `unregisterTool` — tools leave the registry when their signal aborts, and
 * the skeleton never aborts (one page, one lifetime).
 */

/** Minimal hand-declared shape of a WebMCP tool definition (field order per 05). */
export interface WebMCPToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
  execute(input: unknown): Promise<Envelope>;
  annotations: { readOnlyHint: boolean };
}

/** Minimal hand-declared shape of `document.modelContext` (Chromium 146+). */
export interface ModelContextRegistry {
  registerTool(tool: WebMCPToolDefinition, options: { signal: AbortSignal }): Promise<void> | void;
}

declare global {
  interface Document {
    readonly modelContext?: ModelContextRegistry;
  }
}

/**
 * Module-owned because the API requires a signal, not because the skeleton
 * has a teardown: aborting it is Slice 2+ lifecycle work hanging off the
 * same handle.
 */
const registrationAbortController = new AbortController();

/** A second registration would claim the tool twice — a defect, never silent (ARCHITECTURE.md). */
let registered = false;

/**
 * The tool definition agents see. `execute` is one line and never throws:
 * the raw agent input crosses straight into `store.dispatch` — the single
 * typed cast *is* the seam (JSON-Schema-shaped input, zod validation
 * inside). Failures come back as `EnvelopeFailure`, not exceptions.
 */
export function buildGetContextTool(store: WorkspaceStore): WebMCPToolDefinition {
  return {
    name: "duckdb_get_context",
    description: GET_CONTEXT_TOOL_DESCRIPTION,
    inputSchema: z.toJSONSchema(GetContextInputSchema, { io: "input" }),
    execute(input: unknown) {
      return store.dispatch({ kind: "getContext", input: input as GetContextInput });
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * The secure-context gate (05): `document.modelContext` only, feature-detected for `registerTool`.
 * Browsers without the API — Firefox/Safari today, any pre-146 Chromium —
 * fail a leg here and fall to the simulator; `registerTool` is invoked at
 * exactly one call site, behind this gate and a try/catch.
 */
export function nativeModelContextAvailable(): boolean {
  return (
    typeof isSecureContext !== "undefined" &&
    isSecureContext &&
    typeof document !== "undefined" &&
    !!document.modelContext &&
    "registerTool" in document.modelContext
  );
}

/**
 * Registers the tool natively or hands the surface to the simulator —
 * exactly one of the two paths serves the tool. The `nativeAvailable`
 * parameter is the boot-time gate read, injectable so tests can drive both
 * paths without a DOM.
 */
export async function registerTools(
  store: WorkspaceStore,
  nativeAvailable: boolean = nativeModelContextAvailable(),
): Promise<void> {
  if (registered) {
    throw new Error("registration: registerTools called twice — duplicate registration is a defect");
  }
  registered = true;

  const registry = nativeAvailable ? document.modelContext : undefined;
  if (registry && "registerTool" in registry) {
    try {
      await registry.registerTool(buildGetContextTool(store), {
        signal: registrationAbortController.signal,
      });
      store.appendCapability("webmcp_native");
      return;
    } catch {
      // Native registration failed; the simulator serves the tool instead (05).
    }
  }
  startSimulator(store);
}
