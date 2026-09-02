/**
 * Arrow decimal cells (HUGEINT/DECIMAL results) are not first-class JS
 * numbers: vectors expose 128-bit little-endian two's-complement words, and
 * the arrow type strings render as `Decimal[precision e scale]`. The engine
 * worker uses these decoders so bounded rows, INSERT bindings, and measured
 * summaries stay plain numbers (the dbxlite adapter's type-converters
 * recipe, adapted to this engine's batch reader).
 */

/** Decode 128/256-bit little-endian words at a decimal scale into a number. */
export function decimalWordsToNumber(words: Uint32Array, scale: number): number {
  let value = 0n;
  for (let index = words.length - 1; index >= 0; index -= 1) {
    value = (value << 32n) | BigInt(words[index] ?? 0);
  }
  const signBit = 1n << BigInt(words.length * 32 - 1);
  if (value >= signBit) {
    value -= 1n << BigInt(words.length * 32);
  }
  return Number(value) / 10 ** scale;
}

/**
 * One decimal cell to a number: words, bigint, or unscaled number — every
 * shape carries the value at the column's scale, so the scale always
 * applies; null otherwise.
 */
export function decimalCellToNumber(value: unknown, scale: number): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint32Array) return decimalWordsToNumber(value, scale);
  if (typeof value === "bigint") return Number(value) / 10 ** scale;
  if (typeof value === "number") return value / 10 ** scale;
  return null;
}

/**
 * True when the arrow field's type is a Decimal (HUGEINT/DECIMAL results).
 * Structural first: arrow decimals carry `scale` + `bitWidth`/`precision`
 * regardless of minification — a prod build renames the class, so the
 * constructor-name check alone misses real decimals (the Impacted-MRR
 * regression) and survives only as the dev-build fallback.
 */
export function isDecimalField(fieldType: unknown): fieldType is { scale: number } {
  const type = fieldType as {
    scale?: unknown;
    bitWidth?: unknown;
    precision?: unknown;
    constructor?: { name?: string };
  } | null | undefined;
  if (typeof type?.scale !== "number") return false;
  if (typeof type.bitWidth === "number" || typeof type.precision === "number") return true;
  return typeof type.constructor?.name === "string" && type.constructor.name.includes("Decimal");
}
