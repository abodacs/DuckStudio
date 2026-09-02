import type { ArtifactSummary } from "../analysis-artifacts/schemas";

/**
 * The pinned format→renderer table (grilling 52): percent, decimal, USD,
 * integer. The raw number never rounds in transit — this is display only,
 * and it is the one formatter the KPI cards, the artifact-card chips, and
 * the suppression aggregates share.
 */

export type KpiFormat = ArtifactSummary["kpis"][number]["format"];

export function formatKpiValue(value: number | null, format: KpiFormat): string {
  if (value === null) return "—";
  switch (format) {
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "decimal":
      return value.toFixed(1);
    case "currency_usd":
      return `$${value.toLocaleString("en-US")}`;
    case "integer":
      return value.toLocaleString("en-US");
  }
}
