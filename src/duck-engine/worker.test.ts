import { describe, expect, it, vi } from "vitest";
import { createEngineClient, type EngineResponse, type EngineTransport } from "./protocol";
import { createEngineSingleton } from "./worker";

/**
 * The main-thread engine surface (ticket 25): the singleton is idempotent
 * and StrictMode-proof, and crash-respawn is internal — a terminated worker
 * rejects pending requests with a retryable §9 failure and the next request
 * spawns a fresh engine. No browser, no DuckDB: transports are fakes.
 */

function fakeTransport() {
  const respond: Array<(response: EngineResponse) => void> = [];
  const terminateHandlers: Array<() => void> = [];
  const transport: EngineTransport & { postCount: () => number; reply: (response: EngineResponse) => void; crash: () => void } = {
    postMessage: () => {},
    setMessageHandler: (handler) => respond.push(handler),
    onTerminated: (handler) => terminateHandlers.push(handler),
    postCount: () => 0,
    reply: (response) => respond.forEach((resolve) => resolve(response)),
    crash: () => terminateHandlers.forEach((handler) => handler()),
  };
  return transport;
}

describe("engine client correlation", () => {
  it("routes responses to their own request by id", async () => {
    const transport = fakeTransport();
    const client = createEngineClient(transport);
    const first = client.warm();
    const second = client.execute({
      authorizedRelation: "saas_churn",
      positionalSql: "SELECT 1",
      positionalBindings: [],
      budget: { executionMs: 5_000, resultRows: 10_000, chartPoints: 2_000 },
      redactedBindingKeys: [],
      releasePolicy: "public_synthetic",
    });

    transport.reply({
      id: 2,
      kind: "execute",
      ok: true,
      result: { schema: [], batches: [], metrics: { executionMs: 1, materializedRows: 0, chartPoints: 0 } },
    });
    transport.reply({
      id: 1,
      kind: "warm",
      ok: true,
      result: { materializedRelations: [], warmMs: 1, materializationMs: 1 },
    });

    const [warm, execute] = await Promise.all([first, second]);
    expect(warm.materializedRelations).toEqual([]);
    expect(execute.metrics.executionMs).toBe(1);
  });

  it("rejects everything pending when the transport dies, with a retryable failure", async () => {
    const transport = fakeTransport();
    const client = createEngineClient(transport);
    const pending = client.warm();
    transport.crash();
    await expect(pending).rejects.toMatchObject({ code: "INTERNAL_ERROR", retryable: true });
  });
});

describe("engine singleton (ADR 0002 worker singleton)", () => {
  it("resolves concurrent callers to the same client with exactly one spawn", async () => {
    const spawn = vi.fn(() => fakeTransport());
    const singleton = createEngineSingleton(spawn as () => EngineTransport);
    const [a, b] = await Promise.all([singleton.get(), singleton.get()]);
    expect(b).toBe(a);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("respawns a fresh engine after a crash; the old pending callers are rejected", async () => {
    const transports: ReturnType<typeof fakeTransport>[] = [];
    const spawn = vi.fn(() => {
      const transport = fakeTransport();
      transports.push(transport);
      return transport;
    });
    const singleton = createEngineSingleton(spawn as () => EngineTransport);
    const first = await singleton.get();

    const inFlight = first.warm();
    transports[0]?.crash();
    await expect(inFlight).rejects.toMatchObject({ code: "INTERNAL_ERROR" });

    const second = await singleton.get();
    expect(second).not.toBe(first);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("survives a spawn failure: the next call retries instead of caching the rejection", async () => {
    let attempts = 0;
    const spawn = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("worker construction failed");
      return fakeTransport();
    });
    const singleton = createEngineSingleton(spawn as () => EngineTransport);
    await expect(singleton.get()).rejects.toThrow("worker construction failed");
    const second = await singleton.get();
    expect(second).toBeTruthy();
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
