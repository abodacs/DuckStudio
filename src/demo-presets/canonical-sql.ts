/**
 * Canonical SQL — the relation half of the seed→relation triple
 * (ARCHITECTURE.md). These statements are the only blessed analyses for the
 * presets; the contract test executes them in real DuckDB against generated
 * rows and holds the pinned prd.md §6 values.
 */

/**
 * The prd.md §6.1 churn-vs-tickets analysis: one bucket per ticket count.
 * The trailing window columns repeat the rollup on every row, so a summary's
 * first-row KPI read (§8.3) yields the pinned headline values from this one
 * statement — `churn_rate` as a fraction for the percent renderer,
 * `churn_rate_pct` per bucket for the scatter's y axis.
 */
export const SAAS_CHURN_CANONICAL_SQL = `
SELECT
  tickets,
  COUNT(*) AS accounts,
  SUM(CASE WHEN churned THEN 1 ELSE 0 END) AS churned_accounts,
  SUM(CASE WHEN churned THEN mrr ELSE 0 END) AS churned_mrr,
  ROUND(100.0 * SUM(CASE WHEN churned THEN 1 ELSE 0 END) / COUNT(*), 1) AS churn_rate_pct,
  ROUND(SUM(SUM(CASE WHEN churned THEN 1 ELSE 0 END)) OVER () / SUM(COUNT(*)) OVER (), 4) AS churn_rate,
  ROUND(SUM(tickets * COUNT(*)) OVER () / SUM(COUNT(*)) OVER (), 4) AS avg_tickets,
  ROUND(SUM(SUM(CASE WHEN churned THEN mrr ELSE 0 END)) OVER (), 2) AS impacted_mrr
FROM saas_churn
GROUP BY tickets
ORDER BY tickets
`;

/** Rolls the canonical buckets up into the three pinned prd.md §6.1 values. */
export const SAAS_CHURN_HEADLINE_SQL = `
SELECT
  ROUND(100.0 * SUM(churned_accounts) / SUM(accounts), 4) AS churn_rate_pct,
  ROUND(SUM(tickets * accounts)::DOUBLE / SUM(accounts), 4) AS avg_tickets,
  CAST(SUM(churned_mrr) AS VARCHAR) AS impacted_mrr
FROM (${SAAS_CHURN_CANONICAL_SQL})
`;

/**
 * The prd.md §6.2 aggregate demonstration: releasable under
 * `sensitive_aggregate_only` only because every surviving cohort has at
 * least the ten-record minimum, and no row-level data leaves the relation.
 */
export const HEALTHCARE_PII_CANONICAL_SQL = `
SELECT
  diagnosis,
  COUNT(*) AS patients,
  ROUND(AVG(visit_count), 2) AS avg_visits,
  ROUND(AVG(billed_amount), 2) AS avg_billed_amount
FROM healthcare_pii
GROUP BY diagnosis
HAVING COUNT(*) >= 10
ORDER BY patients DESC
`;
