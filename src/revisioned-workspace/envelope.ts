import { z } from "zod";
import { EvidenceSnapshotSchema } from "../dataset-custody/schemas";
import { HEALTHCARE_PII_CANONICAL_SQL, SAAS_CHURN_CANONICAL_SQL } from "../demo-presets/canonical-sql";
import type { WorkspaceViewModel } from "./projection";
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

/** Optional success decorations a command may attach (§7); omissions stay absent, never `undefined`. */
export type SuccessExtras = Partial<
  Pick<Extract<Envelope, { ok: true }>, "contextDelta" | "warnings" | "nextActions">
>;

export function successEnvelope(
  workspace: Workspace,
  data: EnvelopeSuccessData,
  extras: SuccessExtras = {},
): Extract<Envelope, { ok: true }> {
  return {
    ok: true,
    schemaVersion: workspace.schemaVersion,
    workspaceId: workspace.workspaceId,
    revision: workspace.revision,
    data,
    ...(extras.contextDelta === undefined ? {} : { contextDelta: extras.contextDelta }),
    warnings: extras.warnings ?? [],
    nextActions: extras.nextActions ?? [],
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

// --- Emission policy (grilling 42): the tables both builders draw from ---

/**
 * §9's required-recovery column as executable `nextActions` — floor equals
 * ceiling: a failure carries exactly the actions the table names, in table
 * order, least-cost as tie-break. Only rows whose recovery is expressible as
 * a tool call or the named human gesture emit an entry; the rest recover
 * through `error.details` alone. Every suggested mutation input is complete
 * (full schema-shaped input, fresh deterministic key) so the agent can fire
 * it verbatim.
 */
export function recoveryActions(
  error: EnvelopeFailure["error"],
  workspace: Workspace,
): EnvelopeFailure["nextActions"] {
  switch (error.code) {
    case "STALE_REVISION":
      // The delta read from the revision the caller prepared against (§12:
      // recover from stale state), not a second full summary.
      return [
        {
          kind: "tool",
          tool: "duckdb_get_context",
          input: { scope: "events", sinceRevision: error.details.expectedRevision },
        },
      ];
    case "DATASET_UNAVAILABLE":
      return [
        {
          kind: "tool",
          tool: "duckdb_activate_dataset",
          input: {
            datasetId: error.details.datasetId,
            expectedRevision: workspace.revision,
            idempotencyKey: `recover-activate-r${workspace.revision}`,
          },
        },
        { kind: "human_action", action: "select_local_file" },
      ];
    case "ARTIFACT_UNAVAILABLE":
      // §9: read recent artifacts; recompute only if necessary.
      return [{ kind: "tool", tool: "duckdb_get_context", input: { scope: "summary" } }];
    case "OPERATION_CONFLICT":
      // §9: read events (the executable half; cancel is a human command).
      return [{ kind: "tool", tool: "duckdb_get_context", input: { scope: "events" } }];
    case "INTERNAL_ERROR":
      // §9: read current context; do not expose sensitive stack data.
      return [{ kind: "tool", tool: "duckdb_get_context", input: { scope: "summary" } }];
    default:
      // VALIDATION_ERROR, IDEMPOTENCY_CONFLICT, POLICY_DENIED, UNSAFE_SQL,
      // BUDGET_EXCEEDED, OPERATION_CANCELLED, UNSUPPORTED_CAPABILITY: the
      // recovery runs through `error.details`, not a tool call.
      return [];
  }
}

/** The preset each datasetId activates to, for the forward analysis action. */
const CANONICAL_PRESET_SQL: Record<string, string> = {
  saas_churn: SAAS_CHURN_CANONICAL_SQL,
  healthcare_pii: HEALTHCARE_PII_CANONICAL_SQL,
};

/**
 * The one forward action a successful mutation suggests (grilling 42: at
 * most one): `activate_dataset` → run the preset's canonical SQL;
 * `run_analysis` → verify the artifact it just committed (the custody
 * story). Human-only successes carry none.
 */
export function forwardAction(
  command: "activateDataset" | "runAnalysis",
  workspace: Workspace,
  subjectId: string,
): Extract<Envelope, { ok: true }>["nextActions"] {
  if (command === "activateDataset") {
    const sql = CANONICAL_PRESET_SQL[subjectId];
    // §7: nextActions are legal, executable suggestions — no known canonical
    // analysis, no suggestion (never an input the schema would reject).
    if (sql === undefined) {
      return [];
    }
    return [
      {
        kind: "tool",
        tool: "duckdb_execute_sql_to_canvas",
        input: {
          source: { kind: "dataset", id: subjectId },
          sql,
          bindings: {},
          expectedRevision: workspace.revision,
          idempotencyKey: `analyze-${subjectId}-r${workspace.revision}`,
        },
      },
    ];
  }
  return [
    {
      kind: "tool",
      tool: "duckdb_verify_zero_egress",
      input: { scope: "artifact", artifactId: subjectId },
    },
  ];
}

/**
 * §7's `contextDelta` (grilling 42): the `projectWorkspace` output
 * immediately before the commit diffed against the output after, restricted
 * to changed top-level fields — never a second model. Projection fields are
 * plain JSON, so per-field stringify equality is the change test.
 */
export function contextDelta(
  before: WorkspaceViewModel,
  after: WorkspaceViewModel,
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    const previous = before[key as keyof WorkspaceViewModel];
    if (previous !== value && JSON.stringify(previous) !== JSON.stringify(value)) {
      delta[key] = value;
    }
  }
  return delta;
}
