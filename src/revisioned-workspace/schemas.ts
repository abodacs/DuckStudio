import { z } from "zod";
import { PolicySchema, type Policy } from "../demo-presets/schemas";
import {
  AnalysisArtifactSchema,
  AnalysisRecordSchema,
  ArtifactSummarySchema,
  PresentationSpecSchema,
  ResultColumnSchema,
} from "../analysis-artifacts/schemas";
import { PresetMetadataSchema } from "../demo-presets/schemas";

/**
 * URL search-param contract for the workspace route (ADR 0001 am5: workspace
 * vocabulary is owned here, never re-declared in the router).
 *
 * Strict about unknown params so junk URLs surface in the route
 * errorComponent instead of being stripped silently. Slice 3 gives the two
 * pinned params their readers: `rev` pins the revision the link was captured
 * at (`beforeLoad` rejects a pin that no longer matches the live workspace),
 * and `artifact` deep-links a selected artifact. `view` stays out — the
 * canvas tab is the human evidence plane's call (Slice 5).
 * Uncompiled by decision — compilation is the tool-schema seam, not the URL
 * seam.
 */
export const workspaceSearchSchema = z.strictObject({
  rev: z.coerce.number().int().min(0).optional(),
  artifact: z.string().max(80).optional(),
});

export type WorkspaceSearch = z.infer<typeof workspaceSearchSchema>;

/**
 * Slice-1's `{rev}` pin vs the live workspace (04's resolved plan): a pin is
 * only renderable while it names the revision the URL was captured at. A
 * mismatch — behind or ahead of the live workspace — is stale and rejected
 * by the route's `beforeLoad` (redirect that strips the pin); junk params
 * never get this far, the strict schema throws into `errorComponent`.
 */
export function staleRevisionPin(search: WorkspaceSearch, currentRevision: number): boolean {
  return search.rev !== undefined && search.rev !== currentRevision;
}

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

/**
 * §4.2 dataset policy vocabulary — one spelling, owned where the policy
 * lives (demo-presets: policy travels with its dataset) and re-exported so
 * the envelope surface keeps a single binding (ADR 0004 am4 import-equality).
 */
export { PolicySchema, type Policy };

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

/**
 * §4.1 workspace snapshot. Slice 3 adds the two fields the projection needs
 * to serve artifact-bearing views without a second state store: the active
 * dataset's governing metadata (policy, cohort floor, safe schema) and the
 * committed artifact records (§4.3 + measured summary). Everything else is
 * §4.1 verbatim; the envelope reports only §4.1 fields.
 */
export const WorkspaceSchema = z.strictObject({
  workspaceId: z.string(),
  revision: z.number().int().nonnegative(),
  schemaVersion: z.literal("duckstudio.webmcp/v1"),
  capabilities: z.array(CapabilitySchema),
  activeDatasetId: z.string().nullable(),
  activeDataset: PresetMetadataSchema.nullable(),
  selectedArtifactId: z.string().nullable(),
  budgets: BudgetLimitsSchema,
  operations: z.array(OperationSummarySchema),
  recentArtifactIds: z.array(z.string()),
  artifacts: z.array(AnalysisRecordSchema),
  /** Relation-evicted artifact ids (grilling 32): metadata stays, access discloses. */
  evictedArtifactIds: z.array(z.string()),
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

/** §8.2 verbatim. */
export const ACTIVATE_DATASET_TOOL_DESCRIPTION =
  "Activate one dataset already local to this tab. Changes workspace state atomically; use the current revision and an idempotency key.";

/** §8.3 verbatim; the negative phrase is a hard safety invariant (§8.6). */
export const EXECUTE_SQL_TO_CANVAS_TOOL_DESCRIPTION =
  "Run one bounded read-only analysis against a dataset or prior artifact, create an immutable result artifact, infer or apply a safe presentation, and select that artifact atomically. Returns only a safe summary and handles, never result rows.";

/** §8.4 verbatim; the negative phrase is a hard safety invariant (§8.6). */
export const VERIFY_ZERO_EGRESS_TOOL_DESCRIPTION =
  "Read a scoped, timestamped evidence snapshot for dataset uploads, sensitive releases, monitored transports, and operation lineage. Operational evidence only; not a formal proof.";

/**
 * §8.1 compact bootstrap `data`. Budgets carry the full six-key §4.6 shape —
 * the doc example's 3-key fork is not encoded. `activeOperation` joins in
 * Slice 2.
 */
export const RecentArtifactSchema = z.strictObject({
  artifactId: z.string(),
  evicted: z.boolean(),
});

export type RecentArtifact = z.infer<typeof RecentArtifactSchema>;

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
  /** Grilling 32: the summary still lists evicted artifacts, flagged. */
  recentArtifacts: z.array(RecentArtifactSchema),
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

// --- Mutation and evidence command inputs (§8.2, §8.3, §8.4, §8.5) ---

/** §8.1/§8.6: tool-facing inputs carry parameter descriptions (≤150 chars). */

/** §8.2 `duckdb_activate_dataset`. */
export const ActivateDatasetInputSchema = z
  .strictObject({
    datasetId: z
      .enum(["saas_churn", "healthcare_pii"])
      .describe("The preset to activate in this tab; it must already be materialized locally."),
    expectedRevision: z
      .number()
      .int()
      .min(0)
      .describe("The workspace revision this mutation was prepared against; stale values are rejected."),
    idempotencyKey: z
      .string()
      .min(8)
      .max(80)
      .describe("Unique key for this mutation; replaying it exactly returns the original envelope."),
  })
  .describe("Activate one dataset already local to this tab.");

export const CompiledActivateDatasetInput = z.compile(ActivateDatasetInputSchema);

export type ActivateDatasetInput = z.infer<typeof ActivateDatasetInputSchema>;

/** §8.3 `duckdb_execute_sql_to_canvas` presentation input: the committed spec plus the pass-through `initialView` hint, which is never stored (grilling 34). */
export const RunPresentationInputSchema = PresentationSpecSchema.extend({
  initialView: z
    .enum(["insights", "grid", "sql_lineage", "custody"])
    .describe("Human-evidence-plane hint for which tab to open after commit; never stored on the artifact.")
    .optional(),
}).describe(
  "KPI, chart, and grid spec to commit; gaps are inferred policy-aware and a supplied element that crosses policy denies.",
);

/** §8.3 `duckdb_execute_sql_to_canvas`. */
export const RunAnalysisInputSchema = z
  .strictObject({
    source: z
      .strictObject({
        kind: z.enum(["dataset", "artifact"]).describe("Whether the analysis reads a preset relation or a prior artifact."),
        id: z.string().max(80).describe("The datasetId, or the artifactId whose generated relation is the source."),
      })
      .describe("The one authorized relation the statement may reference."),
    sql: z
      .string()
      .min(1)
      .max(12000)
      .describe("Exactly one read-only SELECT or WITH statement; values belong in bindings, not literals."),
    bindings: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .describe("Named parameter values supplied separately from the SQL; pass {} if none; sensitive values are redacted downstream.")
      .refine((bindings) => Object.keys(bindings).length <= 40, "bindings carries at most 40 entries")
      .default({}),
    presentation: RunPresentationInputSchema.optional(),
    budget: z
      .strictObject({
        executionMs: z.number().int().min(100).max(15000).describe("Execution deadline in milliseconds.").optional(),
        resultRows: z.number().int().min(1).max(50000).describe("Maximum materialized rows.").optional(),
        chartPoints: z.number().int().min(10).max(5000).describe("Maximum chart points.").optional(),
      })
      .describe("Stricter budgets are honored; omitted axes fall back to workspace defaults; above-default requests are clamped and disclosed.")
      .optional(),
    expectedRevision: z
      .number()
      .int()
      .min(0)
      .describe("The workspace revision this mutation was prepared against; stale values are rejected."),
    idempotencyKey: z
      .string()
      .min(8)
      .max(80)
      .describe("Unique key for this mutation; replaying it exactly returns the original envelope."),
  })
  .describe("Run one bounded read-only analysis and create, present, and select one immutable artifact atomically.");

export const CompiledRunAnalysisInput = z.compile(RunAnalysisInputSchema);

export type RunAnalysisInput = z.infer<typeof RunAnalysisInputSchema>;

/** §8.4 `duckdb_verify_zero_egress`. */
export const VerifyCustodyInputSchema = z
  .strictObject({
    scope: z
      .enum(["workspace", "operation", "artifact"])
      .describe("Evidence scope: the whole workspace, one operation, or one artifact."),
    operationId: z
      .string()
      .max(80)
      .describe("Required when scope is operation: the operation whose evidence snapshot to read.")
      .optional(),
    artifactId: z
      .string()
      .max(80)
      .describe("Required when scope is artifact: the artifact whose evidence snapshot to read.")
      .optional(),
    sinceRevision: z
      .number()
      .int()
      .min(0)
      .describe("Optional: request evidence relevant to changes after this revision.")
      .optional(),
  })
  .superRefine((input, ctx) => {
    if (input.scope === "operation" && input.operationId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "operationId is required when scope is operation",
        path: ["operationId"],
      });
    }
    if (input.scope === "artifact" && input.artifactId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "artifactId is required when scope is artifact",
        path: ["artifactId"],
      });
    }
  })
  .describe("Read a scoped, timestamped custody evidence snapshot with its limitations.");

export const CompiledVerifyCustodyInput = z.compile(VerifyCustodyInputSchema);

export type VerifyCustodyInput = z.infer<typeof VerifyCustodyInputSchema>;

/**
 * §8.1/§8.4 advertise the scoped dependencies the runtime `.superRefine`
 * refinements enforce, as Draft 2020-12 `allOf`/`if`/`then` — one rule, two
 * layers: the browser-visible schema lets a client validator reject a scope
 * missing its id before a wasted call, while `.parse()` stays the trust
 * boundary (§8.6). Owned beside the schemas they mirror so the advertised
 * copy is derived from this module, never hand-duplicated by callers.
 */
function scopedRequiredConditional(scope: string, requiredKey: string) {
  return {
    if: { properties: { scope: { const: scope } }, required: ["scope"] },
    // JSON Schema Draft 2020-12 conditional keyword, not a thenable.
    // oxlint-disable-next-line unicorn/no-thenable
    then: { required: [requiredKey] },
  };
}

export function deriveGetContextInputJsonSchema() {
  return {
    ...z.toJSONSchema(GetContextInputSchema, { io: "input" }),
    allOf: [
      scopedRequiredConditional("schema", "datasetId"),
      scopedRequiredConditional("artifact", "artifactId"),
    ],
  };
}

export function deriveVerifyCustodyInputJsonSchema() {
  return {
    ...z.toJSONSchema(VerifyCustodyInputSchema, { io: "input" }),
    allOf: [
      scopedRequiredConditional("operation", "operationId"),
      scopedRequiredConditional("artifact", "artifactId"),
    ],
  };
}

/** §8.5 human-only `selectArtifact` — never a WebMCP tool. */
export const SelectArtifactInputSchema = z.strictObject({
  artifactId: z.string().max(80),
  expectedRevision: z.number().int().min(0),
  idempotencyKey: z.string().min(8).max(80),
});

export const CompiledSelectArtifactInput = z.compile(SelectArtifactInputSchema);

export type SelectArtifactInput = z.infer<typeof SelectArtifactInputSchema>;

/** §8.5 human-only `cancelActiveOperation` — never a WebMCP tool. */
export const CancelActiveOperationInputSchema = z.strictObject({
  operationId: z.string().max(80).optional(),
  expectedRevision: z.number().int().min(0),
  idempotencyKey: z.string().min(8).max(80),
});

export const CompiledCancelActiveOperationInput = z.compile(CancelActiveOperationInputSchema);

export type CancelActiveOperationInput = z.infer<typeof CancelActiveOperationInputSchema>;

// --- Response data (§8.2, §8.3, §8.5) ---

/** §8.2 response data. */
export const ActivateDatasetDataSchema = z.strictObject({
  datasetId: z.string(),
  schemaDigest: z.string().regex(/^[0-9a-f]{64}$/),
  rowCount: z.number().int().nonnegative(),
  byteSizeEstimate: z.number().int().nonnegative(),
  policy: PolicySchema,
  minimumCohortSize: z.number().int().positive(),
});

export type ActivateDatasetData = z.infer<typeof ActivateDatasetDataSchema>;

/** §8.3 response data — safe handle, projected summary, measured metrics; zero rows. */
export const RunAnalysisDataSchema = z.strictObject({
  operationId: z.string(),
  artifact: AnalysisArtifactSchema.pick({
    artifactId: true,
    relationName: true,
    source: true,
    rowCount: true,
    schema: true,
    lineage: true,
    release: true,
  }),
  summary: ArtifactSummarySchema,
  metrics: z.strictObject({
    executionMs: z.number(),
    materializedRows: z.number().int().nonnegative(),
    chartPoints: z.number().int().nonnegative(),
  }),
});

export type RunAnalysisData = z.infer<typeof RunAnalysisDataSchema>;

/** §8.5 `selectArtifact` response data. */
export const SelectArtifactDataSchema = z.strictObject({
  artifactId: z.string(),
});

export type SelectArtifactData = z.infer<typeof SelectArtifactDataSchema>;

/** §8.5 `cancelActiveOperation` response data. */
export const CancelActiveOperationDataSchema = z.strictObject({
  operationId: z.string(),
});

export type CancelActiveOperationData = z.infer<typeof CancelActiveOperationDataSchema>;

/** §8.1 `scope: "artifact"` data — the committed record and its measured summary. */
export const GetContextArtifactDataSchema = AnalysisRecordSchema;

export type GetContextArtifactData = z.infer<typeof GetContextArtifactDataSchema>;

/** §8.1 `scope: "schema"` data — the governed source's column digest with custody omissions marked. */
export const GetContextSchemaDataSchema = z.strictObject({
  datasetId: z.string(),
  policy: PolicySchema,
  minimumCohortSize: z.number().int().positive(),
  schema: z.array(ResultColumnSchema),
});

export type GetContextSchemaData = z.infer<typeof GetContextSchemaDataSchema>;
