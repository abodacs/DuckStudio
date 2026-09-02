import type { Page } from "@playwright/test";

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

type SurfaceWindow = { __duckstudioAgentSurface?: AgentSurface };

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

/** Loads the shell and waits for boot to reach "register". */
export async function agentSurface(page: Page): Promise<AgentSurface> {
  await page.goto("/");
  // Cold boots (wasm compile + preset materialization) measured past 25s on
  // constrained machines; 120s absorbs the worst observed cold start (the
  // per-test timeout bounds it) without masking a genuinely stuck boot.
  await page.waitForFunction(() => (window as SurfaceWindow).__duckstudioAgentSurface !== undefined, undefined, {
    timeout: 120_000,
  });
  return page.evaluate(() => (window as SurfaceWindow).__duckstudioAgentSurface as AgentSurface);
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

export const CHURN_CANONICAL_SQL = `
SELECT
  tickets,
  COUNT(*) AS accounts,
  SUM(CASE WHEN churned THEN 1 ELSE 0 END) AS churned_accounts,
  SUM(CASE WHEN churned THEN mrr ELSE 0 END) AS churned_mrr
FROM saas_churn
GROUP BY tickets
ORDER BY tickets
`;

export function churnAnalysis(expectedRevision: number, idempotencyKey: string) {
  return {
    source: { kind: "dataset", id: "saas_churn" },
    sql: CHURN_CANONICAL_SQL,
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

export const HEALTHCARE_CANONICAL_SQL = `
SELECT
  diagnosis,
  COUNT(*) AS patients,
  ROUND(AVG(visit_count), 2) AS avg_visits,
  ROUND(AVG(billed_amount), 2) AS avg_billed_amount
FROM healthcare_pii
GROUP BY diagnosis
HAVING COUNT(*) >= 10
ORDER BY patients DESC
`;
