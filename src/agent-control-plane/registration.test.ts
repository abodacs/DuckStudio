import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CompiledEnvelopeSuccess,
  GET_CONTEXT_TOOL_DESCRIPTION,
  GetContextInputSchema,
} from "./envelope";
import { createWorkspaceStore } from "../revisioned-workspace/store";

/**
 * `registerTools` carries module state (the `registered` flag, the
 * simulator's bound store), so every test re-imports fresh modules after
 * `vi.resetModules()` instead of sharing one instance. The node env has no
 * `document` / `isSecureContext`; `vi.stubGlobal` supplies exactly what the
 * gate reads.
 */
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function importAdapters() {
  const registration = await import("./registration");
  const simulator = await import("./simulator");
  return { ...registration, ...simulator };
}

describe("registerTools native path (ticket 14)", () => {
  it("registers exactly once with the derived definition, appends webmcp_native, and leaves the simulator unbound", async () => {
    const registerTool = vi.fn();
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("document", { modelContext: { registerTool } });

    const { registerTools, invokeTool } = await importAdapters();
    const store = createWorkspaceStore();
    await registerTools(store);

    expect(registerTool).toHaveBeenCalledTimes(1);
    const call = registerTool.mock.calls.at(0);
    expect(call).toBeDefined();
    if (!call) return;
    const [def, options] = call;
    expect(def.name).toBe("duckdb_get_context");
    expect(def.description).toBe(GET_CONTEXT_TOOL_DESCRIPTION);
    expect(def.inputSchema).toEqual(z.toJSONSchema(GetContextInputSchema, { io: "input" }));
    expect(def.annotations).toEqual({ readOnlyHint: true });
    expect(options).toEqual({ signal: expect.any(AbortSignal) });

    expect(store.getSnapshot().capabilities).toContain("webmcp_native");

    // The registered definition is live: it answers through the same store.
    const envelope = await def.execute({ scope: "summary" });
    expect(envelope.ok).toBe(true);
    CompiledEnvelopeSuccess.parse(envelope);

    // Exactly one surface — the simulator never took over.
    expect(() => invokeTool("duckdb_get_context", { scope: "summary" })).toThrow();
  });
});

describe("registerTools simulator fallback (ticket 14)", () => {
  it("absent API: the simulator serves and simulator_only is appended", async () => {
    const { registerTools, invokeTool } = await importAdapters();
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

    const { registerTools, invokeTool } = await importAdapters();
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

    const { registerTools, invokeTool } = await importAdapters();
    const store = createWorkspaceStore();

    await expect(registerTools(store)).resolves.toBeUndefined();

    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().capabilities).toContain("simulator_only");
    expect(store.getSnapshot().capabilities).not.toContain("webmcp_native");
    const envelope = await invokeTool("duckdb_get_context", { scope: "summary" });
    expect(envelope.ok).toBe(true);
  });
});

describe("duplicate registration (ticket 14)", () => {
  it("a second registerTools call throws loudly instead of being swallowed", async () => {
    const { registerTools } = await importAdapters();
    const store = createWorkspaceStore();

    await registerTools(store);

    await expect(registerTools(store)).rejects.toThrow(/duplicate registration/);
  });
});
