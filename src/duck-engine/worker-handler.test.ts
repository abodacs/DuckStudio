import { afterAll, describe, expect, it, vi } from "vitest";
import { createNodeDuckRuntime } from "./node-duckdb";
import { createWorkerHandler, type DuckEngineRuntime } from "./worker-handler";
import type { AuthorizedDecision } from "../dataset-custody/schemas";

/**
 * The worker handshake, headlessly (ticket 25): the same handler the browser
 * worker entry binds runs against real DuckDB (the node runtime). Warm-up
 * materializes both presets as in-memory tables with measured — never
 * assumed — metrics; execution consumes the custody decision verbatim;
 * budget failure leaves no partial materialization.
 */

const runtime = await createNodeDuckRuntime();
const handler = createWorkerHandler(runtime);
afterAll(async () => {
  await runtime.dispose();
});

function decision(overrides: Partial<AuthorizedDecision> = {}): AuthorizedDecision {
  return {
    authorizedRelation: "saas_churn",
    positionalSql: "SELECT 42 AS answer",
    positionalBindings: [],
    budget: { executionMs: 5_000, resultRows: 10_000, chartPoints: 2_000 },
    redactedBindingKeys: [],
    releasePolicy: "public_synthetic",
    ...overrides,
  };
}

const execute = (d: AuthorizedDecision) => handler({ id: 1, kind: "execute", decision: d });

describe("warm handshake (grilling 23: presets materialize at warm time)", () => {
  it("materializes both presets with measured metrics", { timeout: 120_000 }, async () => {
    const response = await handler({ id: 1, kind: "warm" });
    expect(response.ok).toBe(true);
    if (response.kind === "warm" && response.ok) {
      expect(response.result.materializedRelations).toEqual([
        { relationName: "saas_churn", rowCount: 250_000 },
        { relationName: "healthcare_pii", rowCount: 100_000 },
      ]);
      expect(response.result.warmMs).toBeGreaterThan(0);
      expect(response.result.materializationMs).toBeGreaterThan(0);
    }
  });

  it("is idempotent: a second warm answers from the same materialization", { timeout: 120_000 }, async () => {
    const [first, second] = await Promise.all([
      handler({ id: 1, kind: "warm" }),
      handler({ id: 2, kind: "warm" }),
    ]);
    if (first.ok && second.ok) {
      expect(second.result).toBe(first.result);
    } else {
      throw new Error("both warms must succeed");
    }
  });
});

describe("execute handshake (trivial bounded query, measured metrics)", () => {
  it("answers a trivial query with measured, never-defaulted metrics", async () => {
    const response = await execute(decision());
    expect(response.kind === "execute" && response.ok).toBe(true);
    if (response.kind === "execute" && response.ok) {
      const { schema, batches, metrics } = response.result;
      expect(schema).toEqual([{ name: "answer", type: expect.stringContaining("INTEGER") }]);
      expect(batches[0]?.rowCount).toBe(1);
      expect(batches[0]?.values.answer).toEqual([42]);
      expect(metrics.executionMs).toBeGreaterThan(0);
      expect(metrics.materializedRows).toBe(1);
      expect(metrics.chartPoints).toBe(1);
    }
  });

  it("bounds materialization to the decision's resultRows budget", async () => {
    const response = await execute(
      decision({ positionalSql: "SELECT tickets FROM saas_churn", budget: { executionMs: 15_000, resultRows: 25, chartPoints: 25 } }),
    );
    if (response.kind === "execute" && response.ok) {
      expect(response.result.metrics.materializedRows).toBe(25);
      expect(response.result.batches[0]?.rowCount).toBe(25);
    } else {
      throw new Error(`expected success, got ${JSON.stringify(response)}`);
    }
  });

  it("runs the canonical SQL against the materialized preset (pinned shape, measured metrics)", { timeout: 120_000 }, async () => {
    const response = await execute(
      decision({
        positionalSql:
          "SELECT tickets, COUNT(*) AS accounts FROM saas_churn GROUP BY tickets ORDER BY tickets",
      }),
    );
    expect(response.kind === "execute" && response.ok).toBe(true);
    if (response.kind === "execute" && response.ok) {
      expect(response.result.schema.map((column) => column.name)).toEqual(["tickets", "accounts"]);
      expect(response.result.metrics.materializedRows).toBeGreaterThan(10);
    }
  });
});

describe("verbatim consumption (ARCHITECTURE.md: the engine re-derives nothing)", () => {
  it("passes the decision's SQL, bindings, and budget straight to the runtime", async () => {
    const spyRuntime: DuckEngineRuntime = {
      warm: () => Promise.resolve({ materializedRelations: [], warmMs: 0, materializationMs: 0 }),
      runBounded: vi.fn(() =>
        Promise.resolve({ schema: [], rows: [], executionMs: 1 }),
      ),
    };
    const spyHandler = createWorkerHandler(spyRuntime);
    const d = decision({
      positionalSql: "SELECT * FROM saas_churn WHERE tickets > $1",
      positionalBindings: [5],
      budget: { executionMs: 3_333, resultRows: 77, chartPoints: 21 },
    });
    await spyHandler({ id: 1, kind: "execute", decision: d });
    expect(spyRuntime.runBounded).toHaveBeenCalledWith("SELECT * FROM saas_churn WHERE tickets > $1", [5], 77);
  });
});

describe("engine failures translate at the seam (§9)", () => {
  it("drops the result when execution exceeds the budget — nothing partial escapes", async () => {
    // Deterministic: the runtime finishes after the budget elapses, so the
    // deadline fires and the (complete-but-over-budget) read is discarded.
    const slow: DuckEngineRuntime = {
      warm: () => Promise.resolve({ materializedRelations: [], warmMs: 0, materializationMs: 0 }),
      runBounded: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ schema: [{ name: "tickets", type: "INTEGER" }], rows: [{ tickets: 1 }], executionMs: 50 }), 50),
        ),
    };
    const slowHandler = createWorkerHandler(slow);
    const response = await slowHandler({
      id: 1,
      kind: "execute",
      decision: decision({ budget: { executionMs: 10, resultRows: 10, chartPoints: 10 } }),
    });
    expect(response.kind === "execute" && !response.ok).toBe(true);
    if (response.kind === "execute" && !response.ok) {
      expect(response.failure.code).toBe("BUDGET_EXCEEDED");
      expect(response.failure.retryable).toBe(true);
      expect(response.failure.details).toMatchObject({ axis: "executionMs" });
      expect(JSON.stringify(response.failure).includes("tickets")).toBe(false);
    }
  });

  it("classifies an engine error as retryable INTERNAL_ERROR without leaking engine messages", async () => {
    const throwing: DuckEngineRuntime = {
      warm: () => Promise.resolve({ materializedRelations: [], warmMs: 0, materializationMs: 0 }),
      runBounded: () =>
        Promise.reject(new Error('Binder Error: no such column "secret_value" in "mrn"')),
    };
    const throwingHandler = createWorkerHandler(throwing);
    const response = await throwingHandler({
      id: 1,
      kind: "execute",
      decision: decision({ positionalSql: "SELECT secret_value FROM saas_churn" }),
    });
    expect(response.kind === "execute" && !response.ok).toBe(true);
    if (response.kind === "execute" && !response.ok) {
      expect(response.failure.code).toBe("INTERNAL_ERROR");
      expect(response.failure.retryable).toBe(true);
      // The DuckDB message could quote values crossing custody — it never ships.
      expect(JSON.stringify(response.failure).includes("secret_value")).toBe(false);
      expect(JSON.stringify(response.failure).includes("Binder")).toBe(false);
    }
  });
});
