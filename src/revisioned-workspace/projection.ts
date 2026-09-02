import { z } from "zod";
import {
  WorkspaceSchema,
  type BudgetLimits,
  type Capability,
  type Policy,
  type RecentArtifact,
  type Workspace,
} from "./schemas";
import type {
  AnalysisArtifact,
  ArtifactSummary,
  PresentationSpec,
  ResultColumn,
} from "../analysis-artifacts/schemas";
import type { EvidenceSnapshot } from "../dataset-custody/schemas";

/**
 * The single projection owner (ADR 0005 am3): `projectWorkspace` serves the
 * header badge, the left-pane cards, the simulator cards, and the envelope
 * `summary`. `projectArtifact` serves the four evidence views and the
 * artifact-bearing summaries (ADR 0005 am4: realized in Slice 3). No adapter
 * derives workspace or artifact display state any other way.
 */

/** The projection input schema, compiled per ADR 0004's hot-path rule. */
export const CompiledProjectionInput = z.compile(WorkspaceSchema);

/** §4.1 dataset state: none until an activation composes the catalog metadata in. */
export type DatasetState =
  | { kind: "none" }
  | {
      kind: "active";
      datasetId: string;
      policy: Policy;
      rowCount: number;
      bytes: number;
      /** Total catalog columns and the subset whose classification is safe (§7.1 context card). */
      schemaCount: number;
      safeSchemaCount: number;
    };

/** One left-pane artifact card (§7.1): handle, source, and the envelope's summary. */
export type ArtifactCard = {
  artifactId: string;
  evicted: boolean;
  selected: boolean;
  sourceId: string;
  policy: Policy;
  releaseStatus: AnalysisArtifact["release"]["status"];
  rowCount: number;
  /** The first ≤3 summary KPIs — the same objects the envelope's summary carries. */
  kpis: ArtifactSummary["kpis"];
  hasChart: boolean;
};

export type WorkspaceViewModel = {
  workspaceId: string;
  revision: number;
  datasetState: DatasetState;
  /** Derived display line for the dataset state — `datasetId · policy` once active. */
  datasetLine: string;
  /** Derived display string, composed once here — header and cards share it verbatim. */
  badge: string;
  capabilities: Capability[];
  budgets: BudgetLimits;
  selectedArtifactId: string | null;
  /** Newest first; evicted artifacts stay listed, flagged (grilling 32). */
  recentArtifacts: RecentArtifact[];
  /** Newest first (grilling 53): the left pane's operation pills and cards. */
  operations: Workspace["operations"];
  /** Order = `recentArtifactIds` (grilling 53); the left pane's artifact cards. */
  artifactCards: ArtifactCard[];
};

/** One materialized grid cell, as the engine's batches report it. */
export type GridCell = string | number | bigint | boolean | null;

export type GridRows = readonly (readonly GridCell[])[];

/**
 * The Data Grid member (grilling 51): bounded rows + column digests + the
 * release decision for a policy-permitted artifact; the suppression data —
 * aggregates and column metadata only, zero raw rows — for
 * `sensitive_aggregate_only`; `hidden` when the committed presentation
 * withholds the grid.
 */
export type GridData =
  | {
      kind: "rows";
      rows: GridRows;
      columns: readonly ResultColumn[];
      truncated: boolean;
      release: AnalysisArtifact["release"];
    }
  | {
      kind: "suppressed";
      policy: Policy;
      minimumCohortSize: number;
      omitted: readonly string[];
      /** The released aggregates — the same object as the envelope summary's KPIs. */
      kpis: ArtifactSummary["kpis"];
      columns: readonly ResultColumn[];
      bytesUploaded: number;
      rawValuesReleased: number;
    }
  | { kind: "hidden" };

/** The Insights member (grilling 52): the committed presentation + measured values. */
export type InsightsData = {
  spec: PresentationSpec;
  /** Same object as the envelope summary's KPIs (§15.15's one object). */
  kpis: ArtifactSummary["kpis"];
  chart: ArtifactSummary["chart"];
  /** Chart points read from the committed row cache, capped at the measured count. */
  points: readonly { x: GridCell; y: GridCell }[];
  metrics: AnalysisArtifact["metrics"];
  chartDownsampled: boolean;
};

/** The SQL & Lineage member (§13): exact SQL, redacted bindings, hash, chain, release, metrics. */
export type LineageData = {
  sql: string;
  bindings: AnalysisArtifact["bindings"];
  sqlHash: string;
  source: AnalysisArtifact["source"];
  chain: AnalysisArtifact["lineage"];
  release: AnalysisArtifact["release"];
  metrics: AnalysisArtifact["metrics"];
};

/**
 * The artifact-scope view (ticket 06's union, widened by Slice 5 per
 * grilling 51/52): the honest empty state, the eviction disclosure, or the
 * artifact bearing the four evidence-view members. Every view's switch grows
 * with this union.
 */
export type ArtifactView =
  | { kind: "no_artifact" }
  | { kind: "unavailable"; artifactId: string; reason: "not_found" | "relation_evicted" }
  | {
      kind: "artifact";
      artifact: AnalysisArtifact;
      summary: ArtifactSummary;
      insights: InsightsData;
      grid: GridData;
      lineage: LineageData;
      /** The §8.4 evidence snapshot the store captured from the kernel at commit. */
      custody: EvidenceSnapshot | null;
    };

// --- Page memory (grilling 51 item 3): the bounded row cache and the
// custody snapshot, both captured by the store at commit and merged into the
// projection synchronously — never a render-time engine fetch, never a
// second state store. The §4.3 artifact schema stays verbatim; this cache is
// page memory keyed by artifact id and evicted with the retainedArtifacts
// ring (the store calls `releaseArtifactMemory`). ---

const rowCache = new Map<string, GridRows>();
const custodyCache = new Map<string, EvidenceSnapshot>();

/** Store-only writer: binds a committed artifact's bounded rows (page memory). */
export function captureArtifactRows(artifactId: string, rows: GridRows): void {
  rowCache.set(artifactId, rows);
}

/** Store-only writer: binds a committed artifact's §8.4 evidence snapshot. */
export function captureArtifactEvidence(artifactId: string, evidence: EvidenceSnapshot): void {
  custodyCache.set(artifactId, evidence);
}

/** Store-only eviction: the retainedArtifacts ring dropped this relation. */
export function releaseArtifactMemory(artifactId: string): void {
  rowCache.delete(artifactId);
  custodyCache.delete(artifactId);
}

/** SECURITY.md: keep the badge copy exact. Upload accounting grows with Slice 2. */
const NO_UPLOAD_BADGE = "0 Bytes of Dataset Uploaded";

let lastInput: Workspace | undefined;
let lastOutput: WorkspaceViewModel | undefined;

/**
 * Memoized by last input: the store snapshot is immutable, so the same
 * workspace must yield the same object reference at every call site
 * (ADR 0005 am3's referential-equality contract).
 */
export function projectWorkspace(workspace: Workspace): WorkspaceViewModel {
  if (workspace === lastInput) {
    return lastOutput as WorkspaceViewModel;
  }
  CompiledProjectionInput.parse(workspace);
  const dataset = workspace.activeDataset;
  const byId = new Map(
    workspace.artifacts.map((record) => [record.artifact.artifactId, record] as const),
  );
  const output: WorkspaceViewModel = {
    workspaceId: workspace.workspaceId,
    revision: workspace.revision,
    datasetState:
      dataset && workspace.activeDatasetId === dataset.datasetId
        ? {
            kind: "active",
            datasetId: dataset.datasetId,
            policy: dataset.policy,
            rowCount: dataset.rowCount,
            bytes: dataset.byteSizeEstimate,
            schemaCount: dataset.columns.length,
            safeSchemaCount: dataset.columns.filter(
              (column) => column.classification !== "direct_identifier",
            ).length,
          }
        : { kind: "none" },
    datasetLine: dataset ? `${dataset.datasetId} · ${dataset.policy}` : "no dataset",
    badge: NO_UPLOAD_BADGE,
    capabilities: workspace.capabilities,
    budgets: workspace.budgets,
    selectedArtifactId: workspace.selectedArtifactId,
    // Commit order is oldest-first; cards read newest-first. Evicted
    // artifacts stay listed with the flag (grilling 32's UI disclosure).
    recentArtifacts: [...workspace.artifacts]
      .reverse()
      .map((record) => ({
        artifactId: record.artifact.artifactId,
        evicted: workspace.evictedArtifactIds.includes(record.artifact.artifactId),
      })),
    operations: [...workspace.operations].reverse(),
    // `recentArtifactIds` only ever names committed records (the store
    // appends both atomically), so a missing record is a defect the filter
    // drops rather than a card of invented metadata.
    artifactCards: [...workspace.recentArtifactIds].flatMap((artifactId) => {
      const record = byId.get(artifactId);
      if (!record) return [];
      const { artifact, summary } = record;
      return [
        {
          artifactId,
          evicted: workspace.evictedArtifactIds.includes(artifactId),
          selected: workspace.selectedArtifactId === artifactId,
          sourceId: artifact.source.id,
          policy: artifact.policy,
          releaseStatus: artifact.release.status,
          rowCount: artifact.rowCount,
          kpis: summary.kpis.slice(0, 3),
          hasChart: summary.chart !== undefined,
        },
      ];
    }),
  };
  lastInput = workspace;
  lastOutput = output;
  return output;
}

let lastArtifactInput: Workspace | undefined;
let lastArtifactId: string | null | undefined;
let lastArtifactOutput: ArtifactView | undefined;

function projectGrid(record: AnalysisRecordShape, artifactId: string): GridData {
  if (record.artifact.policy === "sensitive_aggregate_only") {
    const evidence = custodyCache.get(artifactId);
    return {
      kind: "suppressed",
      policy: record.artifact.policy,
      minimumCohortSize: record.artifact.release.cohortMinimum,
      omitted: record.artifact.release.omittedDirectIdentifiers,
      kpis: record.summary.kpis,
      columns: record.artifact.schema,
      bytesUploaded: evidence?.datasetBytesUploaded ?? 0,
      rawValuesReleased: evidence?.rawSensitiveValuesReleasedToSharedCanvas ?? 0,
    };
  }
  if (record.artifact.presentation.grid?.visible === false) {
    return { kind: "hidden" };
  }
  const rows = rowCache.get(artifactId) ?? [];
  return {
    kind: "rows",
    rows,
    columns: record.artifact.schema,
    truncated: rows.length < record.artifact.rowCount,
    release: record.artifact.release,
  };
}

function projectInsights(record: AnalysisRecordShape, rows: GridRows): InsightsData {
  const { artifact, summary } = record;
  const chart = summary.chart;
  let points: { x: GridCell; y: GridCell }[] = [];
  if (chart) {
    const columns = artifact.schema;
    const xIndex = columns.findIndex((column) => column.name === chart.x);
    const yIndex = columns.findIndex((column) => column.name === chart.y);
    points = rows
      .slice(0, artifact.metrics.chartPoints)
      .map((row) => ({ x: row[xIndex] ?? null, y: row[yIndex] ?? null }));
  }
  return {
    spec: artifact.presentation,
    kpis: summary.kpis,
    chart,
    points,
    metrics: artifact.metrics,
    chartDownsampled: artifact.metrics.chartPoints < artifact.metrics.materializedRows,
  };
}

/** The structural subset of `AnalysisRecord` the members read. */
type AnalysisRecordShape = {
  artifact: AnalysisArtifact;
  summary: ArtifactSummary;
};

/**
 * Memoized like `projectWorkspace`: same immutable workspace and id must
 * yield the same object reference at every view (ADR 0005 am3's
 * referential-equality contract).
 *
 * The artifact records ride the workspace snapshot (the store is the only
 * writer), so the view is a pure lookup plus the page-memory merge: rows and
 * custody evidence were captured at commit, never fetched at render.
 */
export function projectArtifact(workspace: Workspace, artifactId: string | null): ArtifactView {
  if (workspace === lastArtifactInput && artifactId === lastArtifactId) {
    return lastArtifactOutput as ArtifactView;
  }
  CompiledProjectionInput.parse(workspace);
  let output: ArtifactView;
  if (artifactId === null) {
    output = { kind: "no_artifact" };
  } else {
    const record = workspace.artifacts.find((entry) => entry.artifact.artifactId === artifactId);
    if (!record) {
      output = { kind: "unavailable", artifactId, reason: "not_found" };
    } else if (workspace.evictedArtifactIds.includes(artifactId)) {
      output = { kind: "unavailable", artifactId, reason: "relation_evicted" };
    } else {
      const rows = rowCache.get(artifactId) ?? [];
      output = {
        kind: "artifact",
        artifact: record.artifact,
        summary: record.summary,
        insights: projectInsights(record, rows),
        grid: projectGrid(record, artifactId),
        lineage: {
          sql: record.artifact.sql,
          bindings: record.artifact.bindings,
          sqlHash: record.artifact.sqlHash,
          source: record.artifact.source,
          chain: record.artifact.lineage,
          release: record.artifact.release,
          metrics: record.artifact.metrics,
        },
        custody: custodyCache.get(artifactId) ?? null,
      };
    }
  }
  lastArtifactInput = workspace;
  lastArtifactId = artifactId;
  lastArtifactOutput = output;
  return output;
}
