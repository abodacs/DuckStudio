import { describe, expect, it } from "vitest";
import { decimalCellToNumber, decimalWordsToNumber, isDecimalField } from "./decimal-cells";

/**
 * The decimal-cell decoders (dbxlite's type-converters recipe): HUGEINT and
 * DECIMAL results must reach rows, INSERT bindings, and measured summaries
 * as plain numbers — never as raw Arrow words or unparseable type strings.
 */

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

describe("isDecimalField", () => {
  class Decimal {
    constructor(
      public precision: number,
      public scale: number,
    ) {}
  }
  class Int64 {}

  it("recognizes arrow Decimal fields by their scale", () => {
    expect(isDecimalField(new Decimal(38, 2))).toBe(true);
    expect(isDecimalField(new Decimal(38, 0))).toBe(true);
  });

  it("recognizes decimals structurally when the build minifies the class name", () => {
    // The prod bundle renames classes: the Impacted-MRR tile went missing
    // because only the constructor name was checked. Structural shape wins.
    expect(isDecimalField({ scale: 2, bitWidth: 128 })).toBe(true);
    expect(isDecimalField({ scale: 4, precision: 38 })).toBe(true);
    expect(isDecimalField({ scale: 2, constructor: { name: "Q7e" } })).toBe(false);
  });

  it("rejects non-decimal fields and scale-less shapes", () => {
    expect(isDecimalField(new Int64())).toBe(false);
    expect(isDecimalField({ constructor: { name: "Decimal" } })).toBe(false);
    expect(isDecimalField(null)).toBe(false);
    expect(isDecimalField("Utf8")).toBe(false);
  });
});
