import type { ClampedBudget } from "./schemas";

/**
 * §4.6 budget defaults and hard maxima (agent-requestable axes only) — the
 * one home of the numbers. This leaf exists so the envelope schemas can pin
 * the same maxima without a schema-layering cycle: it imports nothing at
 * runtime, `dataset-custody/schemas` re-exports it as the public home, and
 * every other surface imports it from there.
 */

export const BUDGET_DEFAULTS: ClampedBudget = {
  executionMs: 5_000,
  resultRows: 10_000,
  chartPoints: 2_000,
} as const;

export const BUDGET_HARD_MAX: ClampedBudget = {
  executionMs: 15_000,
  resultRows: 50_000,
  chartPoints: 5_000,
} as const;
