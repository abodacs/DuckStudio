import { zodValidator } from "@tanstack/zod-adapter";
import { describe, expect, it } from "vitest";
import { workspaceSearchSchema } from "./schemas";

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
