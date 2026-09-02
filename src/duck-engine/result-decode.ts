import type { EngineBatch, ExecutionResult } from "./protocol";
import type { BoundedRead } from "./worker-handler";
import { decimalCellToNumber, decimalWordsToNumber, isDecimalField } from "./decimal-cells";

/**
 * The one result-decode boundary behind the `DuckEngineRuntime` seam: every
 * runtime adapter returns identically shaped bounded reads — DuckDB type
 * names in the schema, plain JSON-safe cells in the rows. Decimal knowledge
 * lives here once (decimal-cells.ts is its internal math): the browser wasm
 * path decodes raw Arrow words structurally off the field type, the node
 * path decodes DuckDB's exact string/bigint forms off the reported type
 * name, and both share the Arrow→DuckDB DDL map — so a prod-only Arrow
 * rename or a decimal shape change is decoded, or caught, in one place,
 * not per adapter.
 */

/** Values crossing the worker boundary are JSON-safe: bigints and decimals become numbers/strings. */
function normalizeCell(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value !== null && typeof value === "object" && "toString" in value) {
    // DuckDB decimal values surface as objects with exact string forms.
    const text = String(value);
    const numeric = Number(text);
    return Number.isNaN(numeric) ? text : numeric;
  }
  return value;
}

/** The numeric reading of an already-scaled string form; text that reads as text stays text. */
function numberOrText(text: string): number | string {
  const numeric = Number(text);
  return Number.isNaN(numeric) ? text : numeric;
}

/** The column's decimal scale, from an Arrow field type or a DuckDB type string; null when not decimal. */
function decimalScaleOf(fieldType: unknown): number | null {
  if (typeof fieldType === "string") {
    const decimal = /^DECIMAL\((\d+),\s*(\d+)\)$/.exec(fieldType.trim());
    return decimal ? Number(decimal[2]) : null;
  }
  return isDecimalField(fieldType) ? fieldType.scale : null;
}

/**
 * One cell to its bounded-read shape, by column type. Decimal-family cells
 * decode at the column's scale — Arrow words and bigints carry the value
 * unscaled, while string forms and bare numbers are already scaled at this
 * boundary — and everything else is normalized JSON-safe.
 */
export function decodeEngineCell(value: unknown, fieldType: unknown): unknown {
  const scale = decimalScaleOf(fieldType);
  if (scale === null) return normalizeCell(value);
  if (typeof value === "string") return numberOrText(value);
  if (value !== null && typeof value === "object" && !(value instanceof Uint32Array)) {
    return numberOrText(String(value));
  }
  if (typeof value === "number") return value;
  return decimalCellToNumber(value, scale);
}

/**
 * duckdb-wasm surfaces result types as Arrow type names ("Utf8", "Int64"),
 * while every DuckDB consumer of the schema — the artifact digest (§4.3),
 * the presentation inference, and the worker's own `CREATE TABLE` in
 * `materialize` — speaks DuckDB type names. The node runtime reports DuckDB
 * names natively; this map gives the browser runtime the same vocabulary.
 * Arrow decimals render as `Decimal[precision e scale]` (e.g. `Decimal[38e+2]`
 * for DECIMAL(38,2)) and must become parseable `DECIMAL(p,s)` DDL.
 */
const ARROW_TO_DUCKDB_TYPES: Readonly<Record<string, string>> = {
  Utf8: "VARCHAR",
  LargeUtf8: "VARCHAR",
  Bool: "BOOLEAN",
  Int8: "TINYINT",
  Int16: "SMALLINT",
  Int32: "INTEGER",
  Int64: "BIGINT",
  Int128: "HUGEINT",
  Uint8: "UTINYINT",
  Uint16: "USMALLINT",
  Uint32: "UINTEGER",
  Uint64: "UBIGINT",
  Float32: "FLOAT",
  Float64: "DOUBLE",
  DateDay: "DATE",
  Timestamp: "TIMESTAMP",
  TimeMicrosecond: "TIME",
  Binary: "BLOB",
};

export function duckDbType(fieldType: { toString(): string }): string {
  const name = String(fieldType);
  const decimal = /^Decimal\((\d+),\s*(\d+)\)$/.exec(name) ?? /^Decimal\[(\d+)e\+?(-?\d+)\]$/.exec(name);
  if (decimal) return `DECIMAL(${decimal[1]},${decimal[2]})`;
  return ARROW_TO_DUCKDB_TYPES[name] ?? name;
}

/** Shapes a decoded bounded read into the pinned `{schema, batches, metrics}` result with measured metrics. */
export function shapeResult(read: BoundedRead, chartPointsBudget: number): ExecutionResult {
  const values: Record<string, unknown[]> = {};
  for (const column of read.schema) {
    values[column.name] = read.rows.map((row) => row[column.name] ?? null);
  }
  const batch: EngineBatch = {
    columns: read.schema,
    rowCount: read.rows.length,
    values,
  };
  return {
    schema: read.schema,
    batches: [batch],
    metrics: {
      executionMs: read.executionMs,
      materializedRows: read.rows.length,
      chartPoints: Math.min(read.rows.length, chartPointsBudget),
    },
  };
}
