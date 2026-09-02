import { z } from "zod";
import { ErrorCodeSchema, PolicySchema } from "../revisioned-workspace/schemas";

/**
 * Custody-kernel schemas (§4.2, §4.6, §5; ARCHITECTURE.md puts the kernel
 * here). The authorized-execution decision is the one object the engine
 * consumes verbatim (grilling 22): authorized relation, prepared positional
 * SQL, clamped budget, redaction keys, release policy — the engine
 * re-derives none of it.
 */

export type BindingValue = string | number | boolean | null;

/** §4.6 budget axes an agent may request; defaults and hard maxima below. */
export const BudgetRequestSchema = z.strictObject({
  executionMs: z.number().int().positive().optional(),
  resultRows: z.number().int().positive().optional(),
  chartPoints: z.number().int().positive().optional(),
});

export type BudgetRequest = z.infer<typeof BudgetRequestSchema>;

/** §4.6 clamped budget: the three agent-requestable axes, bounded. */
export const ClampedBudgetSchema = z.strictObject({
  executionMs: z.number().int().positive(),
  resultRows: z.number().int().positive(),
  chartPoints: z.number().int().positive(),
});

export type ClampedBudget = z.infer<typeof ClampedBudgetSchema>;

/** §4.6 defaults and hard maxima (agent-requestable axes only). */
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

/** The single authorized-execution decision (grilling 22) — engine input, verbatim. */
export interface AuthorizedDecision {
  readonly authorizedRelation: string;
  readonly positionalSql: string;
  readonly positionalBindings: readonly BindingValue[];
  readonly budget: ClampedBudget;
  readonly redactedBindingKeys: readonly string[];
  readonly releasePolicy: z.infer<typeof PolicySchema>;
}

/**
 * Kernel failure — structurally the envelope's `error` member (§7), so a
 * custody denial becomes an envelope failure without translation.
 */
export const CustodyFailureSchema = z.strictObject({
  code: ErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export type CustodyFailure = z.infer<typeof CustodyFailureSchema>;

/** §4.3 ReleaseDecision — decided post-materialization, attached to artifacts in Slice 3. */
export const ReleaseDecisionSchema = z.strictObject({
  status: z.enum(["allowed", "downgraded"]),
  rawRowsToAgent: z.literal(0),
  rawRowsToSharedCanvas: z.number().int().nonnegative(),
  omittedDirectIdentifiers: z.array(z.string()),
  cohortMinimum: z.number().int().positive(),
  redactedBindingKeys: z.array(z.string()),
});

export type ReleaseDecision = z.infer<typeof ReleaseDecisionSchema>;

/** §8.4 evidence snapshot — scoped, timestamped, honest. */
export const EvidenceSnapshotSchema = z.strictObject({
  observedAt: z.string().min(1),
  scope: z.strictObject({
    kind: z.enum(["workspace", "operation", "artifact"]),
    id: z.string().min(1),
  }),
  datasetBytesUploaded: z.number().int().nonnegative(),
  rawSensitiveValuesReleasedToTools: z.number().int().nonnegative(),
  rawSensitiveValuesReleasedToSharedCanvas: z.number().int().nonnegative(),
  monitoredTransports: z.array(z.string()),
  policy: PolicySchema.nullable(),
  lineage: z.array(z.strictObject({ kind: z.enum(["dataset", "artifact"]), id: z.string().min(1) })),
  limitations: z.array(z.string()),
});

export type EvidenceSnapshot = z.infer<typeof EvidenceSnapshotSchema>;

/** §8.4 limitation strings, pinned by grilling 24 — copy is contract, never reworded. */
export const EVIDENCE_LIMITATIONS = [
  "Application shell traffic is outside dataset-upload accounting.",
  "Runtime interception is operational evidence, not a formal proof.",
] as const;

/** The five transports PRD §6 / grilling 24 pin as monitored. */
export const MONITORED_TRANSPORTS = ["fetch", "XMLHttpRequest", "sendBeacon", "WebSocket", "WebTransport"] as const;
