import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GET_CONTEXT_TOOL_DESCRIPTION, GetContextInputSchema } from "../envelope";

// Tool inputs are advertised to agents, so the derivation uses `io: "input"`:
// `limit` stays optional-with-default instead of joining `required`.
const derived = z.toJSONSchema(GetContextInputSchema, { io: "input" });

describe("duckdb_get_context JSON Schema strictness (§8.1)", () => {
  it("derives the §8.1 object with §8.6 descriptions", () => {
    expect(derived).toEqual({
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
          // zod's int check emits the MAX_SAFE_INTEGER ceiling on unbounded integers.
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
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
    });
  });

  it("deliberately omits the §8.1 allOf/if/then copy — the refinement is the seam (§8.6)", () => {
    expect(derived).not.toHaveProperty("allOf");
    expect(derived).not.toHaveProperty("if");
    expect(derived).not.toHaveProperty("then");
  });

  it("keeps parameter names and descriptions under the §8.6 caps", () => {
    const properties = derived.properties as Record<string, { description?: unknown }>;
    for (const [name, property] of Object.entries(properties)) {
      expect(name.length).toBeLessThanOrEqual(30);
      expect(typeof property.description).toBe("string");
      expect((property.description as string).length).toBeLessThanOrEqual(150);
    }
  });

  it("keeps the tool description under the §8.6 500-character cap", () => {
    expect(GET_CONTEXT_TOOL_DESCRIPTION.length).toBeLessThanOrEqual(500);
  });
});
