import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ACTIVATE_DATASET_TOOL_DESCRIPTION,
  CompiledEnvelopeFailure,
  CompiledEnvelopeSuccess,
  EXECUTE_SQL_TO_CANVAS_TOOL_DESCRIPTION,
  GET_CONTEXT_TOOL_DESCRIPTION,
  ActivateDatasetInputSchema,
  RunAnalysisInputSchema,
  VERIFY_ZERO_EGRESS_TOOL_DESCRIPTION,
  deriveGetContextInputJsonSchema,
  deriveVerifyCustodyInputJsonSchema,
} from "./envelope";
import { CANONICAL_TOOL_NAMES, registerTools } from "./registration";
import { invokeTool } from "./simulator";
import { createWorkspaceStore } from "../revisioned-workspace/store";
/**
 * Idempotency lives at the caller seam (ADR 0001 am6): `start()`'s memo is
 * the one double-registration guard, so these tests cross `registerTools`
 * directly — no `vi.resetModules()` module-identity surgery. The node env
 * has no `document` / `isSecureContext`; `vi.stubGlobal` supplies exactly
 * what the gate reads.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

const DERIVED_SCHEMAS: Record<string, z.core.JSONSchema.BaseSchema> = {
  duckdb_get_context: deriveGetContextInputJsonSchema(),
  duckdb_activate_dataset: z.toJSONSchema(ActivateDatasetInputSchema, { io: "input" }),
  duckdb_execute_sql_to_canvas: z.toJSONSchema(RunAnalysisInputSchema, { io: "input" }),
  duckdb_verify_zero_egress: deriveVerifyCustodyInputJsonSchema(),
};

const DESCRIPTIONS: Record<string, string> = {
  duckdb_get_context: GET_CONTEXT_TOOL_DESCRIPTION,
  duckdb_activate_dataset: ACTIVATE_DATASET_TOOL_DESCRIPTION,
  duckdb_execute_sql_to_canvas: EXECUTE_SQL_TO_CANVAS_TOOL_DESCRIPTION,
  duckdb_verify_zero_egress: VERIFY_ZERO_EGRESS_TOOL_DESCRIPTION,
};

const READ_ONLY: Record<string, boolean> = {
  duckdb_get_context: true,
  duckdb_activate_dataset: false,
  duckdb_execute_sql_to_canvas: false,
  duckdb_verify_zero_egress: true,
};

describe("registerTools native path (ticket 14/45)", () => {
  it("registers exactly the four canonical tools with derived definitions, appends webmcp_native once, and leaves the simulator unbound", async () => {
    const registerTool = vi.fn();
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("document", { modelContext: { registerTool } });

    const store = createWorkspaceStore();
    await registerTools(store);

    expect(registerTool).toHaveBeenCalledTimes(4);
    const registeredNames = registerTool.mock.calls.map((call) => call[0].name);
    expect(registeredNames).toEqual(CANONICAL_TOOL_NAMES);
    // Human-only workspace commands are never registration candidates (§8.5).
    expect(registeredNames).not.toContain("selectArtifact");
    expect(registeredNames).not.toContain("cancelActiveOperation");

    for (const call of registerTool.mock.calls) {
      const [def, options] = call;
      expect(def.description).toBe(DESCRIPTIONS[def.name]);
      expect(def.inputSchema).toEqual(DERIVED_SCHEMAS[def.name]);
      expect(def.annotations).toEqual({ readOnlyHint: READ_ONLY[def.name] });
      expect(options).toEqual({ signal: expect.any(AbortSignal) });
    }

    const capabilities = store.getSnapshot().capabilities;
    expect(capabilities).toContain("webmcp_native");
    expect(capabilities).not.toContain("simulator_only");

    // Every registered definition is live: each answers through the same
    // store — the engine-backed analysis answers with a §9 failure envelope
    // here (no warmed worker in the headless env), never a throw.
    for (const call of registerTool.mock.calls) {
      const [def] = call;
      const input =
        def.name === "duckdb_activate_dataset"
          ? { datasetId: "saas_churn", expectedRevision: 0, idempotencyKey: "native-activate-01" }
          : def.name === "duckdb_execute_sql_to_canvas"
            ? {
                source: { kind: "dataset", id: "saas_churn" },
                sql: "SELECT COUNT(*) AS n FROM saas_churn",
                bindings: {},
                expectedRevision: 1,
                idempotencyKey: "native-analysis-01",
              }
            : def.name === "duckdb_verify_zero_egress"
              ? { scope: "workspace" }
              : { scope: "summary" };
      const envelope = await def.execute(input);
      if (envelope.ok) {
        CompiledEnvelopeSuccess.parse(envelope);
      } else {
        CompiledEnvelopeFailure.parse(envelope);
      }
    }

    // Exactly one surface — the simulator never took over.
    expect(() => invokeTool("duckdb_get_context", { scope: "summary" })).toThrow();
  });
});

describe("registerTools simulator fallback (ticket 14/45)", () => {
  it("absent API: the simulator serves and simulator_only is appended", async () => {
    const store = createWorkspaceStore();

    await registerTools(store);

    expect(store.getSnapshot().capabilities).toContain("simulator_only");
    const envelope = await invokeTool("duckdb_get_context", { scope: "summary" });
    expect(envelope.ok).toBe(true);
  });

  it("insecure context: registerTool is never called and the simulator serves", async () => {
    const registerTool = vi.fn();
    vi.stubGlobal("isSecureContext", false);
    vi.stubGlobal("document", { modelContext: { registerTool } });

    const store = createWorkspaceStore();

    await registerTools(store);

    expect(registerTool).not.toHaveBeenCalled();
    expect(store.getSnapshot().capabilities).toContain("simulator_only");
    const envelope = await invokeTool("duckdb_get_context", { scope: "summary" });
    expect(envelope.ok).toBe(true);
  });

  it("registerTool throwing falls through to the simulator — exactly one surface serves", async () => {
    const registerTool = vi.fn(() => {
      throw new Error("registration exploded");
    });
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("document", { modelContext: { registerTool } });

    const store = createWorkspaceStore();

    await expect(registerTools(store)).resolves.toBeUndefined();

    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().capabilities).toContain("simulator_only");
    expect(store.getSnapshot().capabilities).not.toContain("webmcp_native");
    const envelope = await invokeTool("duckdb_get_context", { scope: "summary" });
    expect(envelope.ok).toBe(true);
  });

  it("unsupported browser (document present, modelContext absent — Firefox/Safari today): the simulator serves", async () => {
    // The realistic no-WebMCP shape is a full DOM without the API — not the
    // bare node env — so this pins the gate's `!!document.modelContext` leg.
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("document", {});

    const store = createWorkspaceStore();

    await expect(registerTools(store)).resolves.toBeUndefined();

    expect(store.getSnapshot().capabilities).toContain("simulator_only");
    const envelope = await invokeTool("duckdb_get_context", { scope: "summary" });
    expect(envelope.ok).toBe(true);
  });

  it("modelContext present without registerTool (partial implementation): the simulator serves without touching the native path", async () => {
    // A future/partial implementation could ship the namespace before the
    // method; the gate's `"registerTool" in registry` leg must reject it.
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("document", { modelContext: {} });

    const store = createWorkspaceStore();

    await expect(registerTools(store)).resolves.toBeUndefined();

    expect(store.getSnapshot().capabilities).toContain("simulator_only");
    const envelope = await invokeTool("duckdb_get_context", { scope: "summary" });
    expect(envelope.ok).toBe(true);
  });
});
