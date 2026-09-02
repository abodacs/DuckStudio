import { z } from "zod";
import { EvidenceSnapshotSchema } from "../dataset-custody/schemas";
import {
  ActivateDatasetDataSchema,
  CancelActiveOperationDataSchema,
  ErrorCodeSchema,
  GetContextArtifactDataSchema,
  GetContextEventsDataSchema,
  GetContextSchemaDataSchema,
  GetContextSummaryDataSchema,
  RunAnalysisDataSchema,
  SelectArtifactDataSchema,
  type Workspace,
} from "./schemas";

/**
 * The §7 uniform envelope, owned by the domain: it is the store's result
 * type (`dispatch(): Promise<Envelope>`), so it travels with the workspace
 * (ADR 0004 am5). One file tells the whole envelope story — transport
 * vocabulary, shape, builders, and the budget the response must honor — and
 * `agent-control-plane/envelope.ts` re-exports it as the adapter import
 * surface. Deleting `agent-control-plane/` removes no domain type.
 */

// --- Transport vocabulary (§7) ---

export const SchemaVersionSchema = z.literal("duckstudio.webmcp/v1");

export const ToolNameSchema = z.enum([
  "duckdb_get_context",
  "duckdb_activate_dataset",
  "duckdb_execute_sql_to_canvas",
  "duckdb_verify_zero_egress",
]);

/**
 * Ticket 34's deny-over-strip ruling removed `PRESENTATION_DOWNGRADED`: a
 * supplied presentation element that would cross release policy denies the
 * whole request (`POLICY_DENIED` + `permittedPresentation`) — it is never
 * silently removed, so the downgrade warning is unreachable and gone.
 */
export const WarningCodeSchema = z.enum(["DELTA_WINDOW_EXPIRED", "CHART_DOWNSAMPLED", "BUDGET_CLAMPED"]);

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

export const CompiledGetContextEventsEnvelopeSuccess = z.compile(
  EnvelopeSuccessSchema.extend({ data: GetContextEventsDataSchema }),
);

export const CompiledGetContextSchemaEnvelopeSuccess = z.compile(
  EnvelopeSuccessSchema.extend({ data: GetContextSchemaDataSchema }),
);

export const CompiledGetContextArtifactEnvelopeSuccess = z.compile(
  EnvelopeSuccessSchema.extend({ data: GetContextArtifactDataSchema }),
);

export const CompiledVerifyCustodyEnvelopeSuccess = z.compile(
  EnvelopeSuccessSchema.extend({ data: EvidenceSnapshotSchema }),
);

export const CompiledActivateDatasetEnvelopeSuccess = z.compile(
  EnvelopeSuccessSchema.extend({ data: ActivateDatasetDataSchema }),
);

export const CompiledRunAnalysisEnvelopeSuccess = z.compile(
  EnvelopeSuccessSchema.extend({ data: RunAnalysisDataSchema }),
);

export const CompiledSelectArtifactEnvelopeSuccess = z.compile(
  EnvelopeSuccessSchema.extend({ data: SelectArtifactDataSchema }),
);

export const CompiledCancelActiveOperationEnvelopeSuccess = z.compile(
  EnvelopeSuccessSchema.extend({ data: CancelActiveOperationDataSchema }),
);

/** The one awaited result type every adapter shares (ADR 0004 am4). */
export type Envelope =
  | z.infer<typeof EnvelopeSuccessSchema>
  | z.infer<typeof EnvelopeFailureSchema>;

export type EnvelopeFailure = z.infer<typeof EnvelopeFailureSchema>;
export type EnvelopeSuccessData =
  | z.infer<typeof GetContextSummaryDataSchema>
  | z.infer<typeof GetContextEventsDataSchema>
  | z.infer<typeof GetContextSchemaDataSchema>
  | z.infer<typeof GetContextArtifactDataSchema>
  | z.infer<typeof EvidenceSnapshotSchema>
  | z.infer<typeof ActivateDatasetDataSchema>
  | z.infer<typeof RunAnalysisDataSchema>
  | z.infer<typeof SelectArtifactDataSchema>
  | z.infer<typeof CancelActiveOperationDataSchema>;

// --- Builders: the one place a response is assembled ---

export function successEnvelope(
  workspace: Workspace,
  data: EnvelopeSuccessData,
): Extract<Envelope, { ok: true }> {
  return {
    ok: true,
    schemaVersion: workspace.schemaVersion,
    workspaceId: workspace.workspaceId,
    revision: workspace.revision,
    data,
    warnings: [],
    nextActions: [],
  };
}

export function failureEnvelope(
  workspace: Workspace,
  error: EnvelopeFailure["error"],
  nextActions: EnvelopeFailure["nextActions"],
): Envelope {
  return {
    ok: false,
    schemaVersion: workspace.schemaVersion,
    workspaceId: workspace.workspaceId,
    revision: workspace.revision,
    error,
    nextActions,
  };
}

export function validationFailure(workspace: Workspace, zodError: z.ZodError): Envelope {
  const details: EnvelopeFailure["error"]["details"] = {};
  for (const issue of zodError.issues) {
    const field = issue.path.length > 0 ? issue.path.map(String).join(".") : "(command)";
    if (!(field in details)) {
      details[field] = issue.message;
    }
  }
  return failureEnvelope(
    workspace,
    {
      code: "VALIDATION_ERROR",
      message: "Command failed schema validation; correct the fields named in details.",
      retryable: false,
      details,
    },
    [],
  );
}
