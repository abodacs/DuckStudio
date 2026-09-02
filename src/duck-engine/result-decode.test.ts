import { describe, expect, it } from "vitest";
import { decodeEngineCell, duckDbType, shapeResult } from "./result-decode";

/**
 * The one result-decode boundary: both runtime adapters return identically
 * shaped bounded reads, so decimal decode is pinned here for both input
 * mechanisms — the browser's structural Arrow field types (the path that
 * shipped the Impacted-MRR regression) and the node's DuckDB type-name
 * strings — against the real shapes each engine surfaces.
 */

describe("decodeEngineCell (decimal family, by column type)", () => {
  it("decodes raw Arrow words at the field's structural scale", () => {
    expect(decodeEngineCell(Uint32Array.of(142, 0, 0, 0), { scale: 2, bitWidth: 128 })).toBe(1.42);
    expect(decodeEngineCell(Uint32Array.of(0xffffff6c, 0xffffffff, 0xffffffff, 0xffffffff), { scale: 1, precision: 38 })).toBe(-14.8);
  });

  it("decodes unscaled bigints off the DuckDB type name", () => {
    expect(decodeEngineCell(18_240_000n, "DECIMAL(38,2)")).toBe(182_400);
    expect(decodeEngineCell(1420n, "DECIMAL(10,4)")).toBe(0.142);
  });

  it("decodes DuckDB's exact string forms (node rows) without re-scaling", () => {
    expect(decodeEngineCell({ toString: () => "182400.00" }, "DECIMAL(38,2)")).toBe(182_400);
    expect(decodeEngineCell("182400.00", "DECIMAL(38,2)")).toBe(182_400);
    expect(decodeEngineCell(182_400, "DECIMAL(38,2)")).toBe(182_400);
  });

  it("keeps non-decimal cells JSON-safe without touching their values", () => {
    expect(decodeEngineCell(42n, "BIGINT")).toBe(42);
    expect(decodeEngineCell("182400.00", "VARCHAR")).toBe("182400.00");
    expect(decodeEngineCell(true, "BOOLEAN")).toBe(true);
    expect(decodeEngineCell(null, "DECIMAL(10,2)")).toBeNull();
  });
});

describe("duckDbType (Arrow → DuckDB DDL names)", () => {
  it("maps Arrow names and parses Arrow decimal renderings into DECIMAL(p,s)", () => {
    expect(duckDbType({ toString: () => "Utf8" })).toBe("VARCHAR");
    expect(duckDbType({ toString: () => "Int64" })).toBe("BIGINT");
    expect(duckDbType({ toString: () => "Decimal[38e+2]" })).toBe("DECIMAL(38,2)");
    expect(duckDbType({ toString: () => "Decimal(10,4)" })).toBe("DECIMAL(10,4)");
  });
});

describe("shapeResult (decoded reads, pinned result shape)", () => {
  it("passes decoded rows through and null-fills absent cells", () => {
    const result = shapeResult(
      {
        schema: [
          { name: "tickets", type: "INTEGER" },
          { name: "avg_billed", type: "DECIMAL(38,2)" },
        ],
        rows: [{ tickets: 1, avg_billed: 182_400 }, { tickets: 2 }, { tickets: 3, avg_billed: null }],
        executionMs: 5,
      },
      2_000,
    );
    expect(result.batches[0]?.values.tickets).toEqual([1, 2, 3]);
    expect(result.batches[0]?.values.avg_billed).toEqual([182_400, null, null]);
    expect(result.metrics).toEqual({ executionMs: 5, materializedRows: 3, chartPoints: 3 });
  });
});
