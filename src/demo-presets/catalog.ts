import type { PresetMetadata } from "./schemas";

/**
 * The `saas_churn` catalog entry — the seeded public-synthetic preset
 * (prd.md §6.1). Catalog, not workspace state: nothing here is reachable
 * through the envelope until a real activation exists (Slice 2). The four
 * PRD-named columns ride among the fourteen; `region` and `tenant_id` are
 * quasi-identifiers, which custody may treat defensively even under
 * `public_synthetic`.
 */
export const saasChurnPreset: PresetMetadata = {
  datasetId: "saas_churn",
  policy: "public_synthetic",
  minimumCohortSize: 10,
  rowCount: 250_000,
  byteSizeEstimate: 14_200_000,
  schemaDigest: "68511e763ae0ef97a956849c7cba9be6c14bb5a5f111690ba80b70af0d9eab23",
  columns: [
    { name: "tenant_id", type: "VARCHAR", classification: "quasi_identifier" },
    { name: "plan", type: "VARCHAR", classification: "public" },
    { name: "seats", type: "INTEGER", classification: "public" },
    { name: "mrr", type: "DECIMAL(10,2)", classification: "public" },
    { name: "tickets", type: "INTEGER", classification: "public" },
    { name: "churned", type: "BOOLEAN", classification: "public" },
    { name: "churn_rate", type: "DECIMAL(6,4)", classification: "public" },
    { name: "tenure_months", type: "INTEGER", classification: "public" },
    { name: "last_login_days", type: "INTEGER", classification: "public" },
    { name: "feature_adoption_score", type: "DECIMAL(4,3)", classification: "public" },
    { name: "nps_score", type: "INTEGER", classification: "public" },
    { name: "industry", type: "VARCHAR", classification: "public" },
    { name: "region", type: "VARCHAR", classification: "quasi_identifier" },
    { name: "signup_channel", type: "VARCHAR", classification: "public" },
  ],
};

/**
 * The `healthcare_pii` catalog entry — the seeded sensitive preset
 * (prd.md §6.2). `mrn` is the direct identifier custody omits: it exists in
 * the pre-release schema so the release policy has something to suppress,
 * and the generator never materializes a value for it. Every grouping column
 * here is safe, which is what lets the canonical aggregate pass the
 * ten-record cohort floor under `sensitive_aggregate_only`.
 */
export const healthcarePiiPreset: PresetMetadata = {
  datasetId: "healthcare_pii",
  policy: "sensitive_aggregate_only",
  minimumCohortSize: 10,
  rowCount: 100_000,
  byteSizeEstimate: 6_000_000,
  schemaDigest: "76649d41c0945ce657d5d172e8aa5a46976caf78fe70b72380b2cc78c9503140",
  columns: [
    { name: "mrn", type: "VARCHAR", classification: "direct_identifier" },
    { name: "age_band", type: "VARCHAR", classification: "quasi_identifier" },
    { name: "region", type: "VARCHAR", classification: "quasi_identifier" },
    { name: "diagnosis", type: "VARCHAR", classification: "sensitive" },
    { name: "visit_count", type: "INTEGER", classification: "public" },
    { name: "length_of_stay_days", type: "INTEGER", classification: "public" },
    { name: "readmitted", type: "BOOLEAN", classification: "public" },
    { name: "billed_amount", type: "DECIMAL(10,2)", classification: "public" },
  ],
};
