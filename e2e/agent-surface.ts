import type { Page } from "@playwright/test";
import { SAAS_CHURN_CANONICAL_SQL } from "../src/demo-presets/canonical-sql";

/**
 * Shared QA-suite driver for the page's served agent surface
 * (`registration.ts` picks native WebMCP under the flagged e2e browser,
 * otherwise the simulator). The QA specs drive exactly what a browser agent
 * drives: discovery through `tools`, invocation through `invoke`.
 */

export type AgentSurface = {
  surface: "webmcp_native" | "simulator_only";
  tools: string[];
  invoke(name: string, input: unknown): Promise<unknown>;
};

export type SurfaceWindow = { __duckstudioAgentSurface?: AgentSurface };

export type EnvelopeSuccess = {
  ok: true;
  schemaVersion: string;
  workspaceId: string;
  revision: number;
  data: unknown;
  contextDelta?: Record<string, unknown>;
  warnings: unknown[];
  nextActions: { kind: string; tool?: string; input?: Record<string, unknown> }[];
};

export type EnvelopeFailure = {
  ok: false;
  schemaVersion: string;
  workspaceId: string;
  revision: number;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details: Record<string, string | number | boolean | null>;
  };
  nextActions: { kind: string; tool?: string; input?: Record<string, unknown> }[];
};

export type Envelope = EnvelopeSuccess | EnvelopeFailure;

/**
 * Waits for boot to reach "register" and returns the served surface. Cold
 * boots (wasm compile + preset materialization) measured past 25s on
 * constrained machines; 90s absorbs the worst observed cold start (the
 * per-test timeout bounds it) without masking a genuinely stuck boot.
 */
export async function waitForSurface(page: Page): Promise<AgentSurface> {
  await page.waitForFunction(() => (window as SurfaceWindow).__duckstudioAgentSurface !== undefined, undefined, {
    timeout: 90_000,
  });
  return page.evaluate(() => (window as SurfaceWindow).__duckstudioAgentSurface as AgentSurface);
}

/** Loads the shell and waits for boot to reach "register". */
export async function agentSurface(page: Page): Promise<AgentSurface> {
  await page.goto("/");
  return waitForSurface(page);
}

export async function invokeTool(page: Page, name: string, input: unknown): Promise<Envelope> {
  return page.evaluate(
    ({ name, input }) => {
      const surface = (window as SurfaceWindow).__duckstudioAgentSurface;
      if (!surface) throw new Error("the agent surface never registered");
      return surface.invoke(name, input) as Promise<Envelope>;
    },
    { name, input },
  );
}

/** Stringify that tolerates BigInt row values crossing the structured clone. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => (typeof entry === "bigint" ? Number(entry) : entry));
}

/** Recursively collects every object key in a JSON-safe value. */
export function collectKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, into);
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      into.add(key);
      collectKeys(entry, into);
    }
  }
  return into;
}

export const CHURN_ACTIVATE = {
  datasetId: "saas_churn",
  expectedRevision: 0,
  idempotencyKey: "qa-activate-churn-01",
} as const;

export function churnAnalysis(expectedRevision: number, idempotencyKey: string) {
  return {
    source: { kind: "dataset", id: "saas_churn" },
    sql: SAAS_CHURN_CANONICAL_SQL,
    bindings: {},
    expectedRevision,
    idempotencyKey,
  } as const;
}

export const HEALTHCARE_ACTIVATE = {
  datasetId: "healthcare_pii",
  expectedRevision: 0,
  idempotencyKey: "qa-activate-health-01",
} as const;
