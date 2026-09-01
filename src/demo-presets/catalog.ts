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
