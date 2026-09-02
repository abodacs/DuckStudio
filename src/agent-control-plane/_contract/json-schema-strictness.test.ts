import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ACTIVATE_DATASET_TOOL_DESCRIPTION,
  EXECUTE_SQL_TO_CANVAS_TOOL_DESCRIPTION,
  GET_CONTEXT_TOOL_DESCRIPTION,
  ActivateDatasetInputSchema,
  RunAnalysisInputSchema,
  VERIFY_ZERO_EGRESS_TOOL_DESCRIPTION,
  VerifyCustodyInputSchema,
  deriveGetContextInputJsonSchema,
  deriveVerifyCustodyInputJsonSchema,
} from "../envelope";

/**
 * The JSON-Schema strictness contract (§8, ADR 0004 am1/am4; ticket 46):
 * the schema module's derivation must reproduce the §8 canonical input
 * schemas — a diff fails this test — with the §8.6 adopted descriptions
 * riding each parameter. The §8.1/§8.4 `allOf`/`if`/`then` scoped-dependency
 * conditionals ride the advertised copy verbatim; the runtime `.superRefine`
 * refinement stays the enforcement seam (§8.6). One divergence from the
 * doc's human copy remains deliberate: code-side refine bounds (≤40
 * bindings) are absent — runtime `.parse()` enforces them, discoverability
 * does not duplicate every rule.
 */

// Tool inputs are advertised to agents, so the derivation uses `io: "input"`:
// optional-with-default fields stay optional instead of joining `required`.
const DERIVED = {
  duckdb_get_context: deriveGetContextInputJsonSchema(),
  duckdb_activate_dataset: z.toJSONSchema(ActivateDatasetInputSchema, { io: "input" }),
  duckdb_execute_sql_to_canvas: z.toJSONSchema(RunAnalysisInputSchema, { io: "input" }),
  duckdb_verify_zero_egress: deriveVerifyCustodyInputJsonSchema(),
} as const;

/** Tool descriptions, §8 verbatim — the ≤500-cap audit rides the same table. */
const DESCRIPTIONS: Record<keyof typeof DERIVED, string> = {
  duckdb_get_context: GET_CONTEXT_TOOL_DESCRIPTION,
  duckdb_activate_dataset: ACTIVATE_DATASET_TOOL_DESCRIPTION,
  duckdb_execute_sql_to_canvas: EXECUTE_SQL_TO_CANVAS_TOOL_DESCRIPTION,
  duckdb_verify_zero_egress: VERIFY_ZERO_EGRESS_TOOL_DESCRIPTION,
};

/** zod's int check emits the MAX_SAFE_INTEGER ceiling on unbounded integers. */
const UNBOUNDED_INT = { type: "integer", minimum: 0, maximum: 9007199254740991 };

/** The §8.6 caps, asserted for every tool: names ≤30, descriptions ≤150, tool text ≤500. */
function assertCaps(tool: keyof typeof DERIVED): void {
  expect(tool.length).toBeLessThanOrEqual(30);
  expect(DESCRIPTIONS[tool].length).toBeLessThanOrEqual(500);
  const walk = (node: object): void => {
    const properties = (node as { properties?: Record<string, { description?: unknown }> }).properties;
    for (const [name, property] of Object.entries(properties ?? {})) {
      expect(name.length).toBeLessThanOrEqual(30);
      expect(typeof property.description).toBe("string");
      expect((property.description as string).length).toBeLessThanOrEqual(150);
      walk(property);
    }
  };
  walk(DERIVED[tool]);
}

describe("duckdb_get_context JSON Schema strictness (§8.1)", () => {
  it("derives the §8.1 object with §8.6 descriptions", () => {
    expect(DERIVED.duckdb_get_context).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["summary", "schema", "artifact", "events"],
          description:
            "Which slice to read: workspace summary, one dataset's schema, one artifact, or the event log since a revision.",
        },
        datasetId: {
          type: "string",
          maxLength: 80,
          description:
            "Required when scope is schema: the dataset whose safe column digest to read.",
        },
        artifactId: {
          type: "string",
          maxLength: 80,
          description: "Required when scope is artifact: the artifact to summarize.",
        },
        sinceRevision: {
          ...UNBOUNDED_INT,
          description:
            "Optional with scope events: return only workspace events appended after this revision.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 20,
          description: "Maximum items returned per read, 1-50. Defaults to 20.",
        },
      },
      required: ["scope"],
      additionalProperties: false,
      allOf: [
        {
          if: { properties: { scope: { const: "schema" } }, required: ["scope"] },
          // JSON Schema Draft 2020-12 conditional keyword, not a thenable.
          // oxlint-disable-next-line unicorn/no-thenable
          then: { required: ["datasetId"] },
        },
        {
          if: { properties: { scope: { const: "artifact" } }, required: ["scope"] },
          // JSON Schema Draft 2020-12 conditional keyword, not a thenable.
          // oxlint-disable-next-line unicorn/no-thenable
          then: { required: ["artifactId"] },
        },
      ],
    });
  });
});

describe("duckdb_activate_dataset JSON Schema strictness (§8.2)", () => {
  it("derives the §8.2 object with §8.6 descriptions", () => {
    expect(DERIVED.duckdb_activate_dataset).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        datasetId: {
          type: "string",
          enum: ["saas_churn", "healthcare_pii"],
          description: "The preset to activate in this tab; it must already be materialized locally.",
        },
        expectedRevision: {
          ...UNBOUNDED_INT,
          description: "The workspace revision this mutation was prepared against; stale values are rejected.",
        },
        idempotencyKey: {
          type: "string",
          minLength: 8,
          maxLength: 80,
          description: "Unique key for this mutation; replaying it exactly returns the original envelope.",
        },
      },
      required: ["datasetId", "expectedRevision", "idempotencyKey"],
      additionalProperties: false,
      description: "Activate one dataset already local to this tab.",
    });
  });
});

describe("duckdb_execute_sql_to_canvas JSON Schema strictness (§8.3)", () => {
  it("derives the §8.3 object with §8.6 descriptions", () => {
    expect(DERIVED.duckdb_execute_sql_to_canvas).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        source: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["dataset", "artifact"],
              description: "Whether the analysis reads a preset relation or a prior artifact.",
            },
            id: {
              type: "string",
              maxLength: 80,
              description: "The datasetId, or the artifactId whose generated relation is the source.",
            },
          },
          required: ["kind", "id"],
          additionalProperties: false,
          description: "The one authorized relation the statement may reference.",
        },
        sql: {
          type: "string",
          minLength: 1,
          maxLength: 12000,
          description: "Exactly one read-only SELECT or WITH statement; values belong in bindings, not literals.",
        },
        bindings: {
          type: "object",
          propertyNames: { type: "string" },
          additionalProperties: { type: ["string", "number", "boolean", "null"] },
          default: {},
          description: "Named parameter values supplied separately from the SQL; pass {} if none; sensitive values are redacted downstream.",
        },
        presentation: {
          type: "object",
          properties: {
            kpis: {
              maxItems: 6,
              type: "array",
              description: "Up to six KPIs; committed verbatim or inferred policy-aware when omitted.",
              items: {
                type: "object",
                properties: {
                  label: {
                    type: "string",
                    minLength: 1,
                    maxLength: 60,
                    description: "Human-readable KPI heading, 1-60 characters.",
                  },
                  column: {
                    type: "string",
                    minLength: 1,
                    maxLength: 80,
                    description: "Result column the KPI reads its value from.",
                  },
                  format: {
                    type: "string",
                    enum: ["percent", "decimal", "currency_usd", "integer"],
                    description: "How the UI renders the KPI value; the raw number never rounds in transit.",
                  },
                },
                required: ["label", "column", "format"],
                additionalProperties: false,
              },
            },
            chart: {
              type: "object",
              description: "Chart axes; the point count in summaries is always the measured value.",
              properties: {
                type: {
                  type: "string",
                  enum: ["bar", "line", "scatter"],
                  description: "Chart family; scatter is inferred for two numeric columns.",
                },
                x: { type: "string", minLength: 1, maxLength: 80, description: "Result column plotted on the x axis." },
                y: { type: "string", minLength: 1, maxLength: 80, description: "Result column plotted on the y axis." },
                title: {
                  type: "string",
                  maxLength: 120,
                  description: "Optional chart heading, at most 120 characters.",
                },
                maxPoints: {
                  type: "integer",
                  minimum: 10,
                  maximum: 5000,
                  description: "Requested point ceiling; values above the measured budget clamp with a warning.",
                },
                threshold: {
                  type: "object",
                  description:
                    "Emphasis zone above a threshold on the scatter's x axis; styling only, never a release rule.",
                  properties: {
                    column: {
                      type: "string",
                      minLength: 1,
                      maxLength: 80,
                      description: "X-axis column the threshold reads on; it must name the chart's x column.",
                    },
                    value: {
                      type: "number",
                      description: "X value where the emphasis zone begins; the zone covers plotted values above it.",
                    },
                    label: {
                      type: "string",
                      maxLength: 80,
                      description: "Optional zone caption, at most 80 characters.",
                    },
                  },
                  required: ["column", "value"],
                  additionalProperties: false,
                },
              },
              required: ["type", "x", "y"],
              additionalProperties: false,
            },
            grid: {
              type: "object",
              description: "Grid visibility request; a grid that crosses policy denies the request, never strips.",
              properties: {
                visible: {
                  type: "boolean",
                  description: "Whether the data grid may paint; policy can still forbid it.",
                },
                maxRows: { type: "integer", minimum: 1, maximum: 50000, description: "Row ceiling for the grid view." },
              },
              required: ["visible"],
              additionalProperties: false,
            },
            initialView: {
              type: "string",
              enum: ["insights", "grid", "sql_lineage", "custody"],
              description: "Human-evidence-plane hint for which tab to open after commit; never stored on the artifact.",
            },
          },
          additionalProperties: false,
          description:
            "KPI, chart, and grid spec to commit; gaps are inferred policy-aware and a supplied element that crosses policy denies.",
        },
        budget: {
          type: "object",
          properties: {
            executionMs: {
              type: "integer",
              minimum: 100,
              maximum: 15000,
              description: "Execution deadline in milliseconds.",
            },
            resultRows: {
              type: "integer",
              minimum: 1,
              maximum: 50000,
              description: "Maximum materialized rows.",
            },
            chartPoints: {
              type: "integer",
              minimum: 10,
              maximum: 5000,
              description: "Maximum chart points.",
            },
          },
          additionalProperties: false,
          description: "Stricter budgets are honored; omitted axes fall back to workspace defaults; above-default requests are clamped and disclosed.",
        },
        expectedRevision: {
          ...UNBOUNDED_INT,
          description: "The workspace revision this mutation was prepared against; stale values are rejected.",
        },
        idempotencyKey: {
          type: "string",
          minLength: 8,
          maxLength: 80,
          description: "Unique key for this mutation; replaying it exactly returns the original envelope.",
        },
      },
      required: ["source", "sql", "expectedRevision", "idempotencyKey"],
      additionalProperties: false,
      description:
        "Run one bounded read-only analysis and create, present, and select one immutable artifact atomically.",
    });
  });

  it("keeps the §8.6 negative safety phrase in the tool description", () => {
    expect(EXECUTE_SQL_TO_CANVAS_TOOL_DESCRIPTION).toContain("never result rows");
  });
});

describe("duckdb_verify_zero_egress JSON Schema strictness (§8.4)", () => {
  it("derives the §8.4 object with §8.6 descriptions", () => {
    expect(DERIVED.duckdb_verify_zero_egress).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["workspace", "operation", "artifact"],
          description: "Evidence scope: the whole workspace, one operation, or one artifact.",
        },
        operationId: {
          type: "string",
          maxLength: 80,
          description: "Required when scope is operation: the operation whose evidence snapshot to read.",
        },
        artifactId: {
          type: "string",
          maxLength: 80,
          description: "Required when scope is artifact: the artifact whose evidence snapshot to read.",
        },
        sinceRevision: {
          ...UNBOUNDED_INT,
          description: "Optional: request evidence relevant to changes after this revision.",
        },
      },
      required: ["scope"],
      additionalProperties: false,
      allOf: [
        {
          if: { properties: { scope: { const: "operation" } }, required: ["scope"] },
          // JSON Schema Draft 2020-12 conditional keyword, not a thenable.
          // oxlint-disable-next-line unicorn/no-thenable
          then: { required: ["operationId"] },
        },
        {
          if: { properties: { scope: { const: "artifact" } }, required: ["scope"] },
          // JSON Schema Draft 2020-12 conditional keyword, not a thenable.
          // oxlint-disable-next-line unicorn/no-thenable
          then: { required: ["artifactId"] },
        },
      ],
      description: "Read a scoped, timestamped custody evidence snapshot with its limitations.",
    });
  });

  it("keeps the §8.6 negative safety phrase in the tool description", () => {
    expect(VERIFY_ZERO_EGRESS_TOOL_DESCRIPTION).toContain("not a formal proof");
  });
});

describe("§8 canonical example inputs parse (ticket 44)", () => {
  it("accepts each §8 canonical input snippet through the runtime schema", () => {
    expect(
      ActivateDatasetInputSchema.parse({
        datasetId: "saas_churn",
        expectedRevision: 0,
        idempotencyKey: "canonical-01",
      }),
    ).toBeTruthy();
    expect(
      RunAnalysisInputSchema.parse({
        source: { kind: "dataset", id: "saas_churn" },
        sql: "SELECT tickets, COUNT(*) AS accounts FROM saas_churn GROUP BY tickets",
        bindings: { ticket_min: 2 },
        presentation: {
          kpis: [{ label: "Churn Rate", column: "churn_rate", format: "percent" }],
          chart: { type: "scatter", x: "tickets", y: "churn_rate", title: "Churn", maxPoints: 2000 },
          grid: { visible: true, maxRows: 100 },
          initialView: "insights",
        },
        budget: { executionMs: 5000, resultRows: 10000, chartPoints: 2000 },
        expectedRevision: 0,
        idempotencyKey: "canonical-02",
      }),
    ).toBeTruthy();
    expect(
      VerifyCustodyInputSchema.parse({
        scope: "artifact",
        artifactId: "a_01",
        sinceRevision: 3,
      }),
    ).toBeTruthy();
  });

  it("defaults omitted bindings to {} and accepts a partial budget (§8.3)", () => {
    expect(
      RunAnalysisInputSchema.parse({
        source: { kind: "dataset", id: "saas_churn" },
        sql: "SELECT COUNT(*) AS accounts FROM saas_churn",
        expectedRevision: 0,
        idempotencyKey: "canonical-03",
      }).bindings,
    ).toEqual({});
    expect(
      RunAnalysisInputSchema.parse({
        source: { kind: "dataset", id: "saas_churn" },
        sql: "SELECT COUNT(*) AS accounts FROM saas_churn",
        budget: { executionMs: 5000 },
        expectedRevision: 0,
        idempotencyKey: "canonical-04",
      }).budget,
    ).toEqual({ executionMs: 5000 });
  });
});

describe("§8.6 conformance caps (ticket 44/46)", () => {
  for (const tool of Object.keys(DERIVED) as (keyof typeof DERIVED)[]) {
    it(`keeps ${tool} names, parameter descriptions, and tool description under the caps`, () => {
      assertCaps(tool);
    });
  }

  it("keeps the deliberate negative phrases as the only negative tool copy", () => {
    expect(GET_CONTEXT_TOOL_DESCRIPTION).toContain("never returns raw rows");
    expect(ACTIVATE_DATASET_TOOL_DESCRIPTION).not.toMatch(/\bnever\b|\bnot a\b/);
  });
});
