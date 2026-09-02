import { z } from "zod";

/**
 * URL search-param contract for the workspace route (ADR 0001 am5: workspace
 * vocabulary is owned here, never re-declared in the router).
 *
 * Strict about unknown params so junk URLs surface in the route
 * errorComponent instead of being stripped silently. Empty at rev 0 — no
 * search param is read by anyone; `rev` rejoins only when Slice 3's STALE
 * story gives it a reader to reconcile against `workspace.revision`
 * (ARCHITECTURE.md: no backward compatibility, no dead params).
 * Uncompiled by decision — compilation is the tool-schema seam, not the URL
 * seam.
 */
export const workspaceSearchSchema = z.strictObject({});

export type WorkspaceSearch = z.infer<typeof workspaceSearchSchema>;

/**
 * §9 error taxonomy. Owned here rather than in the envelope because §3.3
 * workspace events and §4.4 operation summaries carry `errorCode`; the
 * envelope re-exports it, so the 12 codes stay encoded once.
 */
export const ErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "STALE_REVISION",
  "IDEMPOTENCY_CONFLICT",
  "POLICY_DENIED",
  "UNSAFE_SQL",
  "BUDGET_EXCEEDED",
  "DATASET_UNAVAILABLE",
  "ARTIFACT_UNAVAILABLE",
  "OPERATION_CONFLICT",
  "OPERATION_CANCELLED",
  "UNSUPPORTED_CAPABILITY",
  "INTERNAL_ERROR",
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** §4.1 capability negotiation: enums, not prose. */
export const CapabilitySchema = z.enum([
  "activate_local_preset",
  "run_readonly_sql",
  "present_artifact",
  "verify_custody",
  "cancel_active_operation",
  "select_artifact",
  "webmcp_native",
  "simulator_only",
]);

export type Capability = z.infer<typeof CapabilitySchema>;

/** §4.2 dataset policy vocabulary — one spelling for the workspace summary and the preset catalog. */
export const PolicySchema = z.enum(["public_synthetic", "sensitive_aggregate_only"]);

export type Policy = z.infer<typeof PolicySchema>;

/** §4.6 budget knobs; the hard maxima are custody-kernel enforcement, not schema bounds. */
export const BudgetLimitsSchema = z.strictObject({
  executionMs: z.number().int().nonnegative(),
  resultRows: z.number().int().nonnegative(),
  chartPoints: z.number().int().nonnegative(),
  toolSummaryBytes: z.number().int().nonnegative(),
  retainedArtifacts: z.number().int().nonnegative(),
  contextItems: z.number().int().nonnegative(),
});

export type BudgetLimits = z.infer<typeof BudgetLimitsSchema>;

/** §4.4 left-pane operation card. */
export const OperationSummarySchema = z.strictObject({
  operationId: z.string(),
  kind: z.enum(["activate_dataset", "run_analysis"]),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  sourceId: z.string().optional(),
  artifactId: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  errorCode: ErrorCodeSchema.optional(),
});

export type OperationSummary = z.infer<typeof OperationSummarySchema>;

/** §4.1 workspace snapshot. */
export const WorkspaceSchema = z.strictObject({
  workspaceId: z.string(),
  revision: z.number().int().nonnegative(),
  schemaVersion: z.literal("duckstudio.webmcp/v1"),
  capabilities: z.array(CapabilitySchema),
  activeDatasetId: z.string().nullable(),
  selectedArtifactId: z.string().nullable(),
  budgets: BudgetLimitsSchema,
  operations: z.array(OperationSummarySchema),
  recentArtifactIds: z.array(z.string()),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

/** §8.1 input contract for `duckdb_get_context`. */
export const GetContextInputSchema = z
  .strictObject({
    scope: z
      .enum(["summary", "schema", "artifact", "events"])
      .describe(
        "Which slice to read: workspace summary, one dataset's schema, one artifact, or the event log since a revision.",
      ),
    datasetId: z
      .string()
      .max(80)
      .describe("Required when scope is schema: the dataset whose safe column digest to read.")
      .optional(),
    artifactId: z
      .string()
      .max(80)
      .describe("Required when scope is artifact: the artifact to summarize.")
      .optional(),
    sinceRevision: z
      .number()
      .int()
      .min(0)
      .describe(
        "Optional with scope events: return only workspace events appended after this revision.",
      )
      .optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .describe("Maximum items returned per read, 1-50. Defaults to 20.")
      .default(20),
  })
  .superRefine((input, ctx) => {
    if (input.scope === "schema" && input.datasetId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "datasetId is required when scope is schema",
        path: ["datasetId"],
      });
    }
    if (input.scope === "artifact" && input.artifactId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "artifactId is required when scope is artifact",
        path: ["artifactId"],
      });
    }
  });

/**
 * The flat strict object plus refinement — not a union — so a legal
 * `schema` + `datasetId` combination still parses (§8.6).
 */
export const CompiledGetContextInput = z.compile(GetContextInputSchema);

export type GetContextInput = z.infer<typeof GetContextInputSchema>;

/** §8.1 verbatim; the §8.6 500-character cap is contract-tested. */
export const GET_CONTEXT_TOOL_DESCRIPTION =
  "Read the smallest sufficient workspace context or revision delta before acting. Has no side effects and never returns raw rows.";

/**
 * §8.1 compact bootstrap `data`. Budgets carry the full six-key §4.6 shape —
 * the doc example's 3-key fork is not encoded. `activeOperation` joins in
 * Slice 2.
 */
export const GetContextSummaryDataSchema = z.strictObject({
  capabilities: z.array(CapabilitySchema),
  activeDataset: z
    .strictObject({
      datasetId: z.string(),
      policy: PolicySchema,
      rowCount: z.number().int().nonnegative(),
    })
    .nullable(),
  budgets: BudgetLimitsSchema,
  selectedArtifactId: z.string().nullable(),
  recentArtifacts: z.array(z.never()),
});

export type GetContextSummaryData = z.infer<typeof GetContextSummaryDataSchema>;

/**
 * §3.3 workspace event — the ring-buffer element, encoded now so
 * `scope: "events"` carries its domain shape before the first mutation can
 * append anything (ticket 04).
 */
export const WorkspaceEventSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  at: z.string(),
  kind: z.enum([
    "dataset_activated",
    "analysis_succeeded",
    "analysis_failed",
    "artifact_selected",
    "operation_cancelled",
  ]),
  operationId: z.string().optional(),
  artifactId: z.string().optional(),
  datasetId: z.string().optional(),
  errorCode: ErrorCodeSchema.optional(),
});

export type WorkspaceEvent = z.infer<typeof WorkspaceEventSchema>;

/**
 * §8.1 `scope: "events"` data. At rev 0 the buffer is empty by construction —
 * nothing can append, so nothing can truncate, and every legal `sinceRevision`
 * is inside the window (ticket 04).
 */
export const GetContextEventsDataSchema = z.strictObject({
  events: z.array(WorkspaceEventSchema),
  oldestRetainedRevision: z.number().int().nonnegative(),
});

export type GetContextEventsData = z.infer<typeof GetContextEventsDataSchema>;
