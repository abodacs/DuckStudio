import { z } from "zod";
import { PolicySchema } from "../demo-presets/schemas";

/**
 * Artifact-graph schemas (§4.3, §8.3; ADR 0004 am4 places artifact and
 * lineage shapes here). `AnalysisArtifact` is §4.3 verbatim — the graph
 * computes `artifactId`, `relationName`, `lineage`, and `createdAt`; the
 * kernel provides policy, release, redacted bindings, and measured metrics.
 *
 * The committed unit in the workspace snapshot is the `AnalysisRecord`:
 * the §4.3 artifact plus its measured §8.3 summary. The summary carries the
 * KPI values measured at execution — values that exist only in the result
 * batches at commit time — so the envelope, the left-pane cards, and
 * Insights render one object (§15.15) without ever storing result rows.
 */

/** §4.3 lineage entry — dataset first, then ancestor artifacts, never self. */
export const LineageEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("dataset"), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal("artifact"), id: z.string().min(1) }),
]);

export type LineageEntry = z.infer<typeof LineageEntrySchema>;

/** §4.3 PresentationSpec — the committed KPI/chart/grid spec, never a view tab. Field descriptions are §8.6 contract copy (≤150 chars). */
export const PresentationSpecSchema = z.strictObject({
  kpis: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(60).describe("Human-readable KPI heading, 1-60 characters."),
        column: z.string().min(1).max(80).describe("Result column the KPI reads its value from."),
        format: z
          .enum(["percent", "decimal", "currency_usd", "integer"])
          .describe("How the UI renders the KPI value; the raw number never rounds in transit."),
      }),
    )
    .max(6)
    .describe("Up to six KPIs; committed verbatim or inferred policy-aware when omitted.")
    .optional(),
  chart: z
    .strictObject({
      type: z.enum(["bar", "line", "scatter"]).describe("Chart family; scatter is inferred for two numeric columns."),
      x: z.string().min(1).max(80).describe("Result column plotted on the x axis."),
      y: z.string().min(1).max(80).describe("Result column plotted on the y axis."),
      title: z.string().max(120).describe("Optional chart heading, at most 120 characters.").optional(),
      maxPoints: z
        .number()
        .int()
        .min(10)
        .max(5000)
        .describe("Requested point ceiling; values above the measured budget clamp with a warning.")
        .optional(),
    })
    .describe("Chart axes; the point count in summaries is always the measured value.")
    .optional(),
  grid: z
    .strictObject({
      visible: z.boolean().describe("Whether the data grid may paint; policy can still forbid it."),
      maxRows: z.number().int().min(1).max(50000).describe("Row ceiling for the grid view.").optional(),
    })
    .describe("Grid visibility request; a grid that crosses policy denies the request, never strips.")
    .optional(),
});

export type PresentationSpec = z.infer<typeof PresentationSpecSchema>;

/** §4.3 ColumnDigest — the artifact's committed result schema. */
export const ResultColumnSchema = z.strictObject({
  name: z.string().min(1),
  type: z.string().min(1),
  classification: z.enum(["public", "quasi_identifier", "direct_identifier", "sensitive"]),
  omitted: z.boolean().optional(),
});

export type ResultColumn = z.infer<typeof ResultColumnSchema>;

/** §4.3 AnalysisArtifact — immutable by construction (the graph freezes records). */
export const AnalysisArtifactSchema = z.strictObject({
  artifactId: z.string().min(1),
  relationName: z.string().min(1),
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("dataset"), id: z.string().min(1) }),
    z.strictObject({ kind: z.literal("artifact"), id: z.string().min(1) }),
  ]),
  sourceRevision: z.number().int().nonnegative(),
  sql: z.string().min(1),
  sqlHash: z.string().regex(/^[0-9a-f]{64}$/),
  bindings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  schema: z.array(ResultColumnSchema),
  rowCount: z.number().int().nonnegative(),
  lineage: z.array(LineageEntrySchema),
  policy: PolicySchema,
  release: z.strictObject({
    status: z.enum(["allowed", "downgraded"]),
    rawRowsToAgent: z.literal(0),
    rawRowsToSharedCanvas: z.number().int().nonnegative(),
    omittedDirectIdentifiers: z.array(z.string()),
    cohortMinimum: z.number().int().positive(),
    redactedBindingKeys: z.array(z.string()),
  }),
  presentation: PresentationSpecSchema,
  metrics: z.strictObject({
    executionMs: z.number(),
    materializedRows: z.number().int().nonnegative(),
    chartPoints: z.number().int().nonnegative(),
  }),
  createdAt: z.string().min(1),
});

export type AnalysisArtifact = z.infer<typeof AnalysisArtifactSchema>;

/** §8.3 measured summary: the projected presentation plus measured values. */
export const ArtifactSummarySchema = z.strictObject({
  kpis: z.array(
    z.strictObject({
      label: z.string().min(1).max(60),
      column: z.string().min(1).max(80),
      format: z.enum(["percent", "decimal", "currency_usd", "integer"]),
      value: z.number().nullable(),
    }),
  ),
  chart: z
    .strictObject({
      type: z.enum(["bar", "line", "scatter"]),
      x: z.string().min(1).max(80),
      y: z.string().min(1).max(80),
      title: z.string().max(120).optional(),
      pointCount: z.number().int().nonnegative(),
    })
    .optional(),
});

export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;

/** The committed unit (§15.15's one object): §4.3 artifact + its measured summary. */
export const AnalysisRecordSchema = z.strictObject({
  artifact: AnalysisArtifactSchema,
  summary: ArtifactSummarySchema,
});

export type AnalysisRecord = z.infer<typeof AnalysisRecordSchema>;
