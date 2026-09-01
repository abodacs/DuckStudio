import { z } from "zod";
import { ErrorCodeSchema, GetContextSummaryDataSchema } from "../revisioned-workspace/schemas";

/**
 * Transport vocabulary for the §7 uniform envelope, plus re-exports of the
 * domain schemas (ADR 0004 am4). This is the single trust-seam import surface
 * for adapters and tests; it owns no domain-named schema, so deleting
 * `agent-control-plane/` removes no domain type.
 */

// --- Domain re-exports (import-equality is contract-tested in _contract/) ---

export {
  BudgetLimitsSchema,
  CapabilitySchema,
  CompiledGetContextInput,
  GET_CONTEXT_TOOL_DESCRIPTION,
  GetContextInputSchema,
  GetContextSummaryDataSchema,
  OperationSummarySchema,
  WorkspaceSchema,
} from "../revisioned-workspace/schemas";
export type {
  BudgetLimits,
  Capability,
  ErrorCode,
  GetContextInput,
  GetContextSummaryData,
  OperationSummary,
  Workspace,
} from "../revisioned-workspace/schemas";
export { ErrorCodeSchema };

// --- Transport vocabulary (§7) ---

export const SchemaVersionSchema = z.literal("duckstudio.webmcp/v1");

export const ToolNameSchema = z.enum([
  "duckdb_get_context",
  "duckdb_activate_dataset",
  "duckdb_run_analysis",
  "duckdb_verify_custody",
]);

export const WarningCodeSchema = z.enum([
  "DELTA_WINDOW_EXPIRED",
  "PRESENTATION_DOWNGRADED",
  "CHART_DOWNSAMPLED",
  "BUDGET_CLAMPED",
]);

export const WarningSchema = z.strictObject({
  code: WarningCodeSchema,
  message: z.string(),
  details: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
});

export const NextActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("tool"),
    tool: ToolNameSchema,
    input: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({ kind: z.literal("human_action"), action: z.literal("select_local_file") }),
]);

// --- Envelope (§7 verbatim) ---

export const EnvelopeSuccessSchema = z.strictObject({
  ok: z.literal(true),
  schemaVersion: SchemaVersionSchema,
  workspaceId: z.string().min(1).max(80),
  revision: z.number().int().nonnegative(),
  data: z.unknown(),
  contextDelta: z.record(z.string(), z.unknown()).optional(),
  warnings: z.array(WarningSchema),
  nextActions: z.array(NextActionSchema).max(3),
});

export const EnvelopeFailureSchema = z.strictObject({
  ok: z.literal(false),
  schemaVersion: SchemaVersionSchema,
  workspaceId: z.string().min(1).max(80),
  revision: z.number().int().nonnegative(),
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  }),
  nextActions: z.array(NextActionSchema).max(3),
});

export const CompiledEnvelopeSuccess = z.compile(EnvelopeSuccessSchema);
export const CompiledEnvelopeFailure = z.compile(EnvelopeFailureSchema);

/** Per-command composition: extend with the command's `data`, then re-compile — compose, never fork. */
export const CompiledGetContextEnvelopeSuccess = z.compile(
  EnvelopeSuccessSchema.extend({ data: GetContextSummaryDataSchema }),
);
