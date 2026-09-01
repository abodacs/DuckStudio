import { zodValidator } from "@tanstack/zod-adapter";
import { describe, expect, it } from "vitest";
import { CompiledGetContextInput, workspaceSearchSchema } from "./schemas";

describe("workspaceSearchSchema", () => {
  it("parses an integer rev from its URL string form", () => {
    expect(workspaceSearchSchema.parse({ rev: "3" })).toEqual({ rev: 3 });
  });

  it("accepts an absent rev", () => {
    expect(workspaceSearchSchema.parse({})).toEqual({});
  });

  it("rejects a rev that is not an integer", () => {
    expect(() => workspaceSearchSchema.parse({ rev: "abc" })).toThrow();
    expect(() => workspaceSearchSchema.parse({ rev: "1.5" })).toThrow();
  });

  it("rejects unknown params instead of stripping them", () => {
    expect(() => workspaceSearchSchema.parse({ artifact: "a_01" })).toThrow();
  });
});

// Pins the ticket-01 risk: @tanstack/zod-adapter declares a zod ^3 peer but the
// scaffold runs zod 4. The router consumes the schema only through this adapter,
// so the adapter parsing at all is the contract.
describe("zod adapter against zod 4", () => {
  const validator = zodValidator(workspaceSearchSchema);

  it("parses the search schema", () => {
    expect(validator.parse({ rev: "3" })).toEqual({ rev: 3 });
  });
});

// Parsed through CompiledGetContextInput — the form adapters dispatch — so the
// refinement and strictness must survive the compile.
describe("GetContextInputSchema", () => {
  it("defaults limit to 20 and enforces the 1-50 bounds", () => {
    expect(CompiledGetContextInput.parse({ scope: "summary" })).toEqual({
      scope: "summary",
      limit: 20,
    });
    expect(CompiledGetContextInput.parse({ scope: "summary", limit: 1 })).toEqual({
      scope: "summary",
      limit: 1,
    });
    expect(CompiledGetContextInput.parse({ scope: "summary", limit: 50 })).toEqual({
      scope: "summary",
      limit: 50,
    });
    expect(() => CompiledGetContextInput.parse({ scope: "summary", limit: 0 })).toThrow();
    expect(() => CompiledGetContextInput.parse({ scope: "summary", limit: 51 })).toThrow();
  });

  it("rejects unknown parameters", () => {
    expect(() =>
      CompiledGetContextInput.parse({ scope: "summary", datasetIds: ["saas_churn"] }),
    ).toThrow();
  });

  it("rejects scope schema without a datasetId but parses schema with one", () => {
    expect(() => CompiledGetContextInput.parse({ scope: "schema" })).toThrow();
    expect(CompiledGetContextInput.parse({ scope: "schema", datasetId: "saas_churn" })).toEqual({
      scope: "schema",
      datasetId: "saas_churn",
      limit: 20,
    });
  });

  it("rejects scope artifact without an artifactId but parses artifact with one", () => {
    expect(() => CompiledGetContextInput.parse({ scope: "artifact" })).toThrow();
    expect(CompiledGetContextInput.parse({ scope: "artifact", artifactId: "a_01" })).toEqual({
      scope: "artifact",
      artifactId: "a_01",
      limit: 20,
    });
  });
});
