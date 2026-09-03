import { useCallback, useState } from "react";
import type { PresentationSpec } from "../../analysis-artifacts/schemas";
import type { ErrorCode } from "../../revisioned-workspace/schemas";
import { runWorkbenchAnalysis, type WorkbenchVerdict } from "../human-commands";
import { composePresentation, type WorkbenchPickers } from "./presentation";

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
  failure: { code: ErrorCode; message: string; permitted: PresentationSpec | null } | null;
  clearFailure: () => void;
  run: () => Promise<void>;
  applyPermitted: () => void;
  prefillFromArtifact: (sql: string, artifactId: string) => void;
} {
  const [sql, setSql] = useState("");
  const [pickers, setPickers] = useState<WorkbenchPickers>({ kpis: [], chart: null, grid: true });
  /** `dataset` rides the active dataset (resolved at run time); `artifact` pins its id. */
  const [source, setSource] = useState<{ kind: "dataset"; id: string } | { kind: "artifact"; id: string }>({
    kind: "dataset",
    id: "",
  });
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<{ code: ErrorCode; message: string; permitted: PresentationSpec | null } | null>(
    null,
  );

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

  const prefillFromArtifact = useCallback((statement: string, artifactId: string): void => {
    setSource({ kind: "artifact", id: artifactId });
    setSql(statement);
    setFailure(null);
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
