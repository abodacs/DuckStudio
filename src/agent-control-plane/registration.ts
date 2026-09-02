import { z } from "zod";
import {
  ACTIVATE_DATASET_TOOL_DESCRIPTION,
  EXECUTE_SQL_TO_CANVAS_TOOL_DESCRIPTION,
  GET_CONTEXT_TOOL_DESCRIPTION,
  ActivateDatasetInputSchema,
  RunAnalysisInputSchema,
  VERIFY_ZERO_EGRESS_TOOL_DESCRIPTION,
  ToolNameSchema,
  deriveGetContextInputJsonSchema,
  deriveVerifyCustodyInputJsonSchema,
  type ActivateDatasetInput,
  type Envelope,
  type GetContextInput,
  type RunAnalysisInput,
  type VerifyCustodyInput,
} from "./envelope";
import { invokeTool, startSimulator } from "./simulator";
import type { WorkspaceStore } from "../revisioned-workspace/store";

/**
 * WebMCP registration for the four canonical tools (ticket 05/14/45). The
 * pure factories are what make the parity test possible — jsdom/node has no
 * `document.modelContext`, so the test invokes `def.execute` directly. The
 * imperative side is the only caller of `registerTool`;
 * `navigator.modelContext` is deliberately absent (deprecated in Chromium
 * 150) and there is no `unregisterTool`.
 *
 * Lifecycle ruling (ticket 45): the module-owned AbortController is never
 * aborted in the MLP — one page, one lifetime. `started` idempotency lives
 * at the caller seam (`boot.ts`'s `app ??=` memo), which together with
 * registration-after-mount satisfies PRD §4.3 (registration survives
 * mount/unmount without duplicates; StrictMode cannot double-fire it). The
 * signal remains the test/HMR handle, and there is no unmount teardown path.
 */

/** A JSON Schema document, as derived by `z.toJSONSchema` for agent discovery. */
export type JsonSchema = z.core.JSONSchema.BaseSchema;

/** Minimal hand-declared shape of a WebMCP tool definition (field order per 05). */
export interface WebMCPToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
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
 * has a teardown: per the ticket-45 ruling it stays live for the page's
 * whole life; aborting it is the test/HMR handle, not an app path.
 */
const registrationAbortController = new AbortController();

/** The four canonical names, exact (CONTEXT.md: no aliases, ever). */
export const CANONICAL_TOOL_NAMES: readonly z.infer<typeof ToolNameSchema>[] = ToolNameSchema.options;

/**
 * Tool description text is §8 verbatim (≤500 chars, §8.6 contract-tested);
 * `inputSchema` is derived from the one schema module — never hand-duplicated;
 * `execute` is one line and never throws: the raw agent input crosses
 * straight into `store.dispatch` — the single typed cast *is* the seam
 * (JSON-Schema-shaped input, zod validation inside). Failures come back as
 * `EnvelopeFailure`, not exceptions. `readOnlyHint` marks the two reads.
 */
export function buildGetContextTool(store: WorkspaceStore): WebMCPToolDefinition {
  return {
    name: "duckdb_get_context",
    description: GET_CONTEXT_TOOL_DESCRIPTION,
    inputSchema: deriveGetContextInputJsonSchema(),
    execute(input: unknown) {
      return store.dispatch({ kind: "getContext", input: input as GetContextInput });
    },
    annotations: { readOnlyHint: true },
  };
}

export function buildActivateDatasetTool(store: WorkspaceStore): WebMCPToolDefinition {
  return {
    name: "duckdb_activate_dataset",
    description: ACTIVATE_DATASET_TOOL_DESCRIPTION,
    inputSchema: z.toJSONSchema(ActivateDatasetInputSchema, { io: "input" }),
    execute(input: unknown) {
      return store.dispatch({ kind: "activateDataset", input: input as ActivateDatasetInput });
    },
    annotations: { readOnlyHint: false },
  };
}

export function buildExecuteSqlToCanvasTool(store: WorkspaceStore): WebMCPToolDefinition {
  return {
    name: "duckdb_execute_sql_to_canvas",
    description: EXECUTE_SQL_TO_CANVAS_TOOL_DESCRIPTION,
    inputSchema: z.toJSONSchema(RunAnalysisInputSchema, { io: "input" }),
    execute(input: unknown) {
      return store.dispatch({ kind: "runAnalysis", input: input as RunAnalysisInput });
    },
    annotations: { readOnlyHint: false },
  };
}

export function buildVerifyZeroEgressTool(store: WorkspaceStore): WebMCPToolDefinition {
  return {
    name: "duckdb_verify_zero_egress",
    description: VERIFY_ZERO_EGRESS_TOOL_DESCRIPTION,
    inputSchema: deriveVerifyCustodyInputJsonSchema(),
    execute(input: unknown) {
      return store.dispatch({ kind: "verifyCustody", input: input as VerifyCustodyInput });
    },
    annotations: { readOnlyHint: true },
  };
}

/** All four definitions, in the canonical order agents discover them. */
export function buildTools(store: WorkspaceStore): WebMCPToolDefinition[] {
  return [
    buildGetContextTool(store),
    buildActivateDatasetTool(store),
    buildExecuteSqlToCanvasTool(store),
    buildVerifyZeroEgressTool(store),
  ];
}

/**
 * The page-level QA seam for the served tool surface (slice-4 e2e and the
 * manual audit; the browser agent itself invokes the registered `execute`
 * closures directly). `tools` is the exact registration list — the two
 * human-only workspace commands are never on it. Assigned once, at boot,
 * by the same decision that picks the surface.
 */
export interface AgentSurfaceDiagnostics {
  readonly surface: "webmcp_native" | "simulator_only";
  readonly tools: readonly string[];
  invoke(name: string, input: unknown): Promise<Envelope>;
}

declare global {
  // Ambient because `globalThis.__duckstudioAgentSurface` is the one page-level handle.
  var __duckstudioAgentSurface: AgentSurfaceDiagnostics | undefined;
}

function exposeSurfaceDiagnostics(diagnostics: AgentSurfaceDiagnostics): void {
  // The `app ??=` boot memo makes this a once-per-page assignment; tests
  // that drive `registerTools` directly simply overwrite the handle.
  globalThis.__duckstudioAgentSurface = diagnostics;
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
 * Registers the four tools natively or hands the surface to the simulator —
 * exactly one of the two paths serves them, and the capability enum is
 * appended exactly once by this same decision (grilling 41: fixed at boot,
 * never flipped post-boot). Idempotency is a contract of the caller:
 * `start()`'s `app ??=` memo is the one real guard, so this runs once per
 * page (ADR 0001 am6); a second call would claim the tools twice — a caller
 * defect, not a state this module hides. The `nativeAvailable` parameter is
 * the boot-time gate read, injectable so tests can drive both paths without
 * a DOM.
 */
export async function registerTools(
  store: WorkspaceStore,
  nativeAvailable: boolean = nativeModelContextAvailable(),
): Promise<void> {
  const registry = nativeAvailable ? document.modelContext : undefined;
  if (registry && "registerTool" in registry) {
    const tools = buildTools(store);
    try {
      for (const tool of tools) {
        await registry.registerTool(tool, {
          signal: registrationAbortController.signal,
        });
      }
      store.appendCapability("webmcp_native");
      exposeSurfaceDiagnostics({
        surface: "webmcp_native",
        tools: CANONICAL_TOOL_NAMES,
        invoke(name, input) {
          const tool = tools.find((definition) => definition.name === name);
          if (!tool) {
            throw new Error(`registration: "${name}" is not a registered WebMCP tool`);
          }
          return tool.execute(input);
        },
      });
      return;
    } catch {
      // Native registration failed; the simulator serves the tools instead (05).
    }
  }
  startSimulator(store);
  exposeSurfaceDiagnostics({
    surface: "simulator_only",
    tools: CANONICAL_TOOL_NAMES,
    invoke: invokeTool,
  });
}
