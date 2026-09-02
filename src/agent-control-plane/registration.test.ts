import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CompiledEnvelopeSuccess,
  GET_CONTEXT_TOOL_DESCRIPTION,
  GetContextInputSchema,
} from "./envelope";
import { registerTools } from "./registration";
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

describe("registerTools native path (ticket 14)", () => {
  it("registers exactly once with the derived definition, appends webmcp_native, and leaves the simulator unbound", async () => {
    const registerTool = vi.fn();
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("document", { modelContext: { registerTool } });

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
