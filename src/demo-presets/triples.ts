import type { PresetMetadata } from "./schemas";
import { healthcarePiiPreset, saasChurnPreset } from "./catalog";
import { generateSaasChurnRows, type SaasChurnRow } from "./saas-churn";
import { generateHealthcarePiiRows, type HealthcarePiiRow } from "./healthcare-pii";
import { HEALTHCARE_PII_CANONICAL_SQL, SAAS_CHURN_CANONICAL_SQL } from "./canonical-sql";

/**
 * The seed→relation triple (ARCHITECTURE.md): a preset's interface is its
 * dataset metadata carrying the release policy, its deterministic row
 * generator, and its canonical SQL — one typed object per preset, not five
 * imports joined by naming coincidence. Slice 2's custody activation and the
 * preset contract test (`_contract/preset-numbers.test.ts`) consume this
 * interface at their seam.
 */
export interface PresetTriple<Row = Record<string, unknown>> {
  metadata: PresetMetadata;
  generate: () => Row[];
  sql: string;
}

export const saasChurn: PresetTriple<SaasChurnRow> = {
  metadata: saasChurnPreset,
  generate: generateSaasChurnRows,
  sql: SAAS_CHURN_CANONICAL_SQL,
};

export const healthcarePii: PresetTriple<HealthcarePiiRow> = {
  metadata: healthcarePiiPreset,
  generate: generateHealthcarePiiRows,
  sql: HEALTHCARE_PII_CANONICAL_SQL,
};
