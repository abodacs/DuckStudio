import { z } from "zod";
import { PolicySchema } from "../revisioned-workspace/schemas";

/**
 * Preset catalog metadata (ticket 04): the seeded datasets live here as
 * catalog entries, never as workspace state — the envelope's `activeDataset`
 * stays null until a real activation (Slice 2). The catalog is the dataset's
 * release policy made explicit and checked in (§4.2); name-based detection is
 * only defense in depth.
 */

/** §4.2 ColumnClassification: enums, not prose. */
export const ColumnClassificationSchema = z.enum([
  "public",
  "quasi_identifier",
  "direct_identifier",
  "sensitive",
]);

export type ColumnClassification = z.infer<typeof ColumnClassificationSchema>;

/** Preset column metadata — the pre-release schema, before custody omissions. */
export const PresetColumnSchema = z.strictObject({
  name: z.string().min(1),
  type: z.string().min(1),
  classification: ColumnClassificationSchema,
});

export type PresetColumn = z.infer<typeof PresetColumnSchema>;

/**
 * The seeded dataset's self-described metadata. `schemaDigest` is the 64-hex
 * SHA-256 of `canonicalSchemaJson(columns)` — pinned as a static constant and
 * verified by test (ticket 12). Runtime `crypto.subtle` re-derivation joins
 * when a real relation exists to digest (Slice 2); a static catalog cannot
 * drift because the digest test fails on any column edit.
 */
export const PresetMetadataSchema = z.strictObject({
  datasetId: z.string().min(1),
  policy: PolicySchema,
  minimumCohortSize: z.number().int().min(1),
  rowCount: z.number().int().nonnegative(),
  byteSizeEstimate: z.number().int().nonnegative(),
  schemaDigest: z.string().regex(/^[0-9a-f]{64}$/),
  columns: z.array(PresetColumnSchema),
});

export type PresetMetadata = z.infer<typeof PresetMetadataSchema>;

/**
 * The canonical serialization the digest pins: the columns array serialized in
 * authored key order. This function is the single definition of "canonical
 * schema JSON"; the catalog test hashes through it, so the constant and the
 * columns cannot drift apart.
 */
export function canonicalSchemaJson(columns: PresetColumn[]): string {
  return JSON.stringify(columns);
}
