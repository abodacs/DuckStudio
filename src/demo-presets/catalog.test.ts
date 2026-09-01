import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PresetMetadataSchema, canonicalSchemaJson } from "./schemas";
import { saasChurnPreset } from "./catalog";

describe("saas_churn catalog entry", () => {
  it("parses against PresetMetadataSchema", () => {
    expect(PresetMetadataSchema.parse(saasChurnPreset)).toEqual(saasChurnPreset);
  });

  it("carries the prd.md §6.1 preset contract values", () => {
    expect(saasChurnPreset.datasetId).toBe("saas_churn");
    expect(saasChurnPreset.policy).toBe("public_synthetic");
    expect(saasChurnPreset.rowCount).toBe(250000);
    expect(saasChurnPreset.minimumCohortSize).toBe(10);
    // PRD: "approximately 14.2 MB".
    expect(saasChurnPreset.byteSizeEstimate).toBe(14_200_000);
  });

  it("pins the fourteen columns including the four the PRD names", () => {
    expect(saasChurnPreset.columns).toHaveLength(14);
    const names = saasChurnPreset.columns.map((column) => column.name);
    for (const name of ["tickets", "churned", "churn_rate", "mrr"]) {
      expect(names).toContain(name);
    }
  });
});

// The digest is load-bearing, not decorative: it pins the schema the Slice 2
// generator must produce. Editing a column without re-pinning the digest fails
// here, the same way the preset contract test holds the demo numbers.
describe("schemaDigest value strategy (ticket 12: static constant, test-verified)", () => {
  it("equals the SHA-256 of the canonical schema JSON", () => {
    const digest = createHash("sha256")
      .update(canonicalSchemaJson(saasChurnPreset.columns))
      .digest("hex");
    expect(saasChurnPreset.schemaDigest).toBe(digest);
  });
});
