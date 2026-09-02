/**
 * Arrow decimal cells (HUGEINT/DECIMAL results) are not first-class JS
 * numbers: vectors expose 128-bit little-endian two's-complement words, and
 * the arrow type strings render as `Decimal[precision e scale]`. The engine
 * worker uses these decoders so bounded rows, INSERT bindings, and measured
 * summaries stay plain numbers (the dbxlite adapter's type-converters
 * recipe, adapted to this engine's batch reader).
 *
 * Detection reads the type's `toString()` contract, never
 * `constructor.name` — the shipped worker bundle minifies class names.
 */

/**
 * The decimal scale of an arrow field type, or null when it is not a
 * decimal. Prefers the type's own `scale` property and falls back to parsing
 * the rendered string (`Decimal[38e+2]` → 2).
 */
export function decimalScale(fieldType: unknown): number | null {
  if (fieldType === null || typeof fieldType !== "object") return null;
  const name = String(fieldType);
  const decimalShape = /^Decimal\[(\d+)e\+?(-?\d+)\]$/.exec(name) ?? /^Decimal\((\d+),\s*(\d+)\)$/.exec(name);
  if (!decimalShape) return null;
  const property = (fieldType as { scale?: unknown }).scale;
  if (typeof property === "number") return property;
  return Number(decimalShape[2]);
}

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
