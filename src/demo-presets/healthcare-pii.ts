import { intBetween, mulberry32, pickWeighted } from "./prng";

/**
 * The `healthcare_pii` deterministic row generator (prd.md §6.2). The direct
 * identifier `mrn` is an omitted column: it exists in the catalog schema and
 * is classified `direct_identifier`, but the generator never materializes a
 * value for it — context reports the omission instead of returning values.
 * Everything else is safe grouping or aggregate-measurable columns, and the
 * `sensitive_aggregate_only` policy (minimum cohort ten) is what makes the
 * canonical aggregate releasable.
 */

export const HEALTHCARE_PII_ROW_COUNT = 100_000;
export const HEALTHCARE_PII_SEED = 0x0beef11;

const AGE_BANDS = ["0-17", "18-34", "35-49", "50-64", "65+"] as const;
const AGE_BAND_WEIGHTS = [60, 220, 260, 250, 210];
const REGIONS = ["north", "south", "east", "west"] as const;
const DIAGNOSES = [
  "hypertension",
  "type_2_diabetes",
  "asthma",
  "copd",
  "chronic_kidney_disease",
  "depression",
  "osteoarthritis",
  "migraine",
] as const;
const DIAGNOSIS_WEIGHTS = [180, 150, 140, 90, 70, 140, 120, 110];

/** One `healthcare_pii` row; field order mirrors the catalog minus `mrn`. */
export interface HealthcarePiiRow {
  age_band: string;
  region: string;
  diagnosis: string;
  visit_count: number;
  length_of_stay_days: number;
  readmitted: boolean;
  billed_amount: number;
}

export function generateHealthcarePiiRows(): HealthcarePiiRow[] {
  const rand = mulberry32(HEALTHCARE_PII_SEED);
  const rows: HealthcarePiiRow[] = Array.from({ length: HEALTHCARE_PII_ROW_COUNT }, () => {
    const chronic = rand() < 0.4;
    return {
      age_band: AGE_BANDS[pickWeighted(rand, AGE_BAND_WEIGHTS)] as string,
      region: REGIONS[Math.floor(rand() * REGIONS.length)] as string,
      diagnosis: DIAGNOSES[pickWeighted(rand, DIAGNOSIS_WEIGHTS)] as string,
      visit_count: chronic ? intBetween(rand, 3, 12) : intBetween(rand, 1, 5),
      length_of_stay_days: chronic ? intBetween(rand, 0, 14) : intBetween(rand, 0, 3),
      readmitted: rand() < (chronic ? 0.18 : 0.07),
      billed_amount: Math.round((40 + rand() * 2960) * 100) / 100,
    };
  });
  return rows;
}
