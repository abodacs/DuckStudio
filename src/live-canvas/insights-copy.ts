/**
 * The actionable empty-state copy (slice-7 plan stage 2): each state says
 * what to do next, not what is missing. The sample-analysis button exists
 * only while `saas_churn` is active — the one preset with a canonical run.
 * Lives apart from the view so the view file exports only components.
 */
export const INSIGHTS_EMPTY_STATE = {
  noDataset: "Activate a dataset on the left to begin.",
  datasetActive: "Run the sample analysis and results land here.",
} as const;
