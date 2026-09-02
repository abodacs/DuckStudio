import { describe, expect, it } from "vitest";
import { decimalCellToNumber, decimalScale, decimalWordsToNumber } from "./decimal-cells";

/**
 * The decimal-cell decoders (dbxlite's type-converters recipe): HUGEINT and
 * DECIMAL results must reach rows, INSERT bindings, and measured summaries
 * as plain numbers — never as raw Arrow words or unparseable type strings.
 * Detection rides the type's `toString()` contract because the shipped
 * worker bundle minifies constructor names.
 */

describe("decimalScale", () => {
  it("reads the scale property off decimal type objects", () => {
    const type = {
      toString: () => "Decimal[38e+2]",
      precision: 38,
      scale: 2,
    };
    expect(decimalScale(type)).toBe(2);
  });

  it("parses the rendered string when no scale property survives", () => {
    expect(decimalScale({ toString: () => "Decimal[38e+2]" })).toBe(2);
    expect(decimalScale({ toString: () => "Decimal[38e0]" })).toBe(0);
    expect(decimalScale({ toString: () => "Decimal(38, 2)" })).toBe(2);
    expect(decimalScale({ toString: () => "Decimal[38e-3]" })).toBe(-3);
  });

  it("returns null for non-decimal types", () => {
    expect(decimalScale(null)).toBeNull();
    expect(decimalScale("Utf8")).toBeNull();
    expect(decimalScale({ toString: () => "Float64" })).toBeNull();
    expect(decimalScale({ scale: 2 })).toBeNull(); // decimal-shaped name required
  });
});

describe("decimalWordsToNumber", () => {
  it("decodes little-endian 128-bit words with the scale applied", () => {
    expect(decimalWordsToNumber(Uint32Array.of(142, 0, 0, 0), 2)).toBe(1.42);
    expect(decimalWordsToNumber(Uint32Array.of(142, 0, 0, 0), 0)).toBe(142);
    expect(decimalWordsToNumber(Uint32Array.of(480, 0, 0, 0), 1)).toBe(48);
  });

  it("decodes negative two's-complement values", () => {
    expect(decimalWordsToNumber(Uint32Array.of(0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff), 0)).toBe(-1);
    expect(decimalWordsToNumber(Uint32Array.of(0xffffff6c, 0xffffffff, 0xffffffff, 0xffffffff), 0)).toBe(-148);
    expect(decimalWordsToNumber(Uint32Array.of(0xffffff6c, 0xffffffff, 0xffffffff, 0xffffffff), 1)).toBe(-14.8);
  });

  it("decodes values spread across words", () => {
    // 2^64 lands in the third little-endian word (bits 64–95).
    expect(decimalWordsToNumber(Uint32Array.of(0, 0, 1, 0), 0)).toBe(2 ** 64);
    expect(decimalWordsToNumber(Uint32Array.of(0, 1, 0, 0), 0)).toBe(2 ** 32);
  });
});

describe("decimalCellToNumber", () => {
  it("applies the scale to every shape, including plain unscaled numbers", () => {
    expect(decimalCellToNumber(7.5, 0)).toBe(7.5);
    expect(decimalCellToNumber(18240000, 2)).toBe(182400);
    expect(decimalCellToNumber(1420, 4)).toBe(0.142);
    expect(decimalCellToNumber(null, 2)).toBeNull();
    expect(decimalCellToNumber(undefined, 2)).toBeNull();
  });

  it("decodes word arrays and bigint cells", () => {
    expect(decimalCellToNumber(Uint32Array.of(250, 0, 0, 0), 1)).toBe(25);
    expect(decimalCellToNumber(14200n, 2)).toBe(142);
  });

  it("returns null for shapes it cannot read rather than guessing", () => {
    expect(decimalCellToNumber("142", 2)).toBeNull();
  });
});
