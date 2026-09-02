import type { PresentationSpec } from "../analysis-artifacts/schemas";

/**
 * The preset-matched presentations the canonical-run chips supply with
 * `runAnalysis` (PRD slice 6). Every column they name is produced by the
 * preset's canonical SQL, so `resolvePresentation` accepts them verbatim;
 * inference stays the agent-path default — these are the human adapter's
 * readable labels and axes, not a second contract.
 */

export const SAAS_CHURN_ANALYSIS_PRESENTATION: PresentationSpec = {
  kpis: [
    { label: "Churn Rate", column: "churn_rate", format: "percent" },
    { label: "Avg Tickets", column: "avg_tickets", format: "decimal" },
    { label: "Impacted MRR", column: "impacted_mrr", format: "currency_usd" },
  ],
  chart: {
    type: "scatter",
    x: "tickets",
    y: "churn_rate_pct",
    title: "Churn rate by support tickets",
    threshold: { column: "tickets", value: 5, label: "churn accelerates above 5 tickets" },
  },
};

export const HEALTHCARE_PII_ANALYSIS_PRESENTATION: PresentationSpec = {
  kpis: [
    { label: "Patients", column: "patients", format: "integer" },
    { label: "Avg Visits", column: "avg_visits", format: "decimal" },
    { label: "Avg Billed", column: "avg_billed_amount", format: "currency_usd" },
  ],
  chart: {
    type: "bar",
    x: "diagnosis",
    y: "patients",
    title: "Cohort sizes by diagnosis (every cohort k ≥ 10)",
  },
};
