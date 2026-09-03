import { useCallback, useState } from "react";
import type { PresentationSpec } from "../../analysis-artifacts/schemas";
import type { ErrorCode } from "../../revisioned-workspace/schemas";
import type { PresetId } from "../../demo-presets/catalog";
import { activatePreset, runWorkbenchAnalysis, type WorkbenchVerdict } from "../human-commands";
import { composePresentation, type WorkbenchPickers } from "./presentation";

/** A prior artifact's committed presentation, in picker shape. */
export interface PriorPresentation {
  readonly kpis: readonly { readonly column: string; readonly format: WorkbenchPickers["kpis"][number]["format"] }[];
  readonly chart: { readonly type: "bar" | "line" | "scatter"; readonly x: string; readonly y: string } | null;
}

/**
 * The workbench's state machine (stage 4): the statement, the pickers, the
 * source, and the last denial. `run()` composes the presentation (never
 * sanitizes — deny over strip is the workspace's ruling) and dispatches
 * through the human seam; a `POLICY_DENIED` verdict keeps the parsed
 * `permittedPresentation` so the strip can offer the one-click "Apply safe
 * presentation". All state is canvas-local — never workspace state.
 */
export function useWorkbench(activeDatasetId: string): {
  sql: string;
  setSql: (value: string) => void;
  pickers: WorkbenchPickers;
  setPickers: (next: WorkbenchPickers) => void;
  running: boolean;
  failure: {
    code: ErrorCode;
    message: string;
    permitted: PresentationSpec | null;
    details: Record<string, string | number | boolean | null>;
  } | null;
  clearFailure: () => void;
  run: () => Promise<void>;
  applyPermitted: () => void;
  prefillFromArtifact: (sql: string, artifactId: string, prior?: PriorPresentation) => void;
  activateDataset: (datasetId: PresetId, expectedRevision: number) => Promise<void>;
} {
  const [sql, setSql] = useState("");
  const [pickers, setPickers] = useState<WorkbenchPickers>({ kpis: [], chart: null, grid: true });
  /** `dataset` rides the active dataset (resolved at run time); `artifact` pins its id. */
  const [source, setSource] = useState<{ kind: "dataset"; id: string } | { kind: "artifact"; id: string }>({
    kind: "dataset",
    id: "",
  });
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<{
    code: ErrorCode;
    message: string;
    permitted: PresentationSpec | null;
    details: Record<string, string | number | boolean | null>;
  } | null>(null);

  const run = useCallback(async (): Promise<void> => {
    setRunning(true);
    setFailure(null);
    let verdict: WorkbenchVerdict;
    try {
      const resolved =
        source.kind === "dataset" ? { kind: "dataset" as const, id: source.id || activeDatasetId } : source;
      verdict = await runWorkbenchAnalysis({
        source: resolved,
        sql,
        presentation: composePresentation(pickers),
        // Stay on the workbench: the results area below the editor shows the
        // same artifact, so a run never yanks the tab away.
        initialView: "query",
      });
    } finally {
      setRunning(false);
    }
    if (!verdict.ok) {
      setFailure({
        code: verdict.code,
        message: verdict.message,
        permitted: parsePermitted(verdict.details.permittedPresentation),
        details: verdict.details,
      });
    }
  }, [pickers, source, sql, activeDatasetId]);

  const applyPermitted = useCallback((): void => {
    if (!failure?.permitted) return;
    const permitted = failure.permitted;
    setPickers({
      kpis: permitted.kpis?.map((kpi) => ({ column: kpi.column, format: kpi.format })) ?? [],
      chart: permitted.chart ? { type: permitted.chart.type, x: permitted.chart.x, y: permitted.chart.y } : null,
      grid: permitted.grid?.visible ?? false,
    });
    setFailure(null);
  }, [failure]);

  // Refining from a result seeds the pickers with its committed presentation
  // (visible and editable from here), so a re-chart keeps the KPIs it
  // refined from — the grid picker stays the human's own choice.
  const prefillFromArtifact = useCallback((statement: string, artifactId: string, prior?: PriorPresentation): void => {
    setSource({ kind: "artifact", id: artifactId });
    setSql(statement);
    setPickers((current) => ({
      kpis: prior?.kpis.map((kpi) => ({ column: kpi.column, format: kpi.format })) ?? current.kpis,
      chart:
        prior?.chart
          ? { type: prior.chart.type, x: prior.chart.x, y: prior.chart.y }
          : current.chart,
      grid: current.grid,
    }));
    setFailure(null);
  }, []);

  // The executable recovery (the envelope's nextActions, in human shape):
  // the same `activateDataset` command a preset card dispatches; a rejected
  // activation echoes its envelope in this strip so it teaches here too,
  // and a success retires the denial that asked for it.
  const activateDataset = useCallback(async (datasetId: PresetId, expectedRevision: number): Promise<void> => {
    const verdict = await activatePreset(datasetId, expectedRevision);
    if (verdict.ok) {
      setFailure(null);
    } else {
      setFailure({ code: verdict.code, message: verdict.message, permitted: null, details: { datasetId } });
    }
  }, []);

  return {
    sql,
    setSql,
    pickers,
    setPickers,
    running,
    failure,
    clearFailure: () => setFailure(null),
    run,
    applyPermitted,
    prefillFromArtifact,
    activateDataset,
  };
}

function parsePermitted(raw: string | number | boolean | null | undefined): PresentationSpec | null {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as PresentationSpec;
  } catch {
    return null;
  }
}
