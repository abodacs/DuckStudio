import { workspaceStore } from "../revisioned-workspace/store";
import { healthcarePii, saasChurn } from "../demo-presets/triples";
import {
  HEALTHCARE_PII_ANALYSIS_PRESENTATION,
  SAAS_CHURN_ANALYSIS_PRESENTATION,
} from "../demo-presets/presentations";
import { captureRunIntent } from "./view-intent";

/**
 * The one seam the canvas's human gestures dispatch through (§7.2, ticket
 * 55): artifact selection and Cancel are named workspace commands with fresh
 * idempotency keys — no private setters, no local selection state. The
 * fire-and-forget promise is the store's own envelope path; card UI reads
 * the committed state back through the projection, never the envelope.
 *
 * Slice 6 adds the judge-path gestures (preset activation, canonical runs,
 * custody verification) at the same seam: identical domain commands, fresh
 * keys, and the run's tab intent captured dispatch-time like any adapter.
 */

export function selectArtifact(artifactId: string, expectedRevision: number): void {
  void workspaceStore.dispatch({
    kind: "selectArtifact",
    input: { artifactId, expectedRevision, idempotencyKey: crypto.randomUUID() },
  });
}

export function cancelActiveOperation(expectedRevision: number): void {
  void workspaceStore.dispatch({
    kind: "cancelActiveOperation",
    input: { expectedRevision, idempotencyKey: crypto.randomUUID() },
  });
}

/** The preset ids a chip may run — the catalog's one spelling. */
export type RunnablePresetId = "saas_churn" | "healthcare_pii";

/** A preset card gesture: one `activateDataset` command, nothing else. */
export function activatePreset(datasetId: RunnablePresetId, expectedRevision: number): void {
  void workspaceStore.dispatch({
    kind: "activateDataset",
    input: { datasetId, expectedRevision, idempotencyKey: crypto.randomUUID() },
  });
}

/**
 * A canonical-run chip gesture: activate the preset first when it is not the
 * active dataset (the second command rides the activation envelope's
 * revision), then run the preset's canonical SQL with its matched
 * presentation. Tab intent is captured dispatch-time; failure lands in the
 * operations stream like any adapter's — no local error chrome.
 */
export async function runPresetAnalysis(datasetId: RunnablePresetId, expectedRevision: number): Promise<void> {
  let revision = expectedRevision;
  if (workspaceStore.getSnapshot().activeDatasetId !== datasetId) {
    const activated = await workspaceStore.dispatch({
      kind: "activateDataset",
      input: { datasetId, expectedRevision: revision, idempotencyKey: crypto.randomUUID() },
    });
    if (!activated.ok) return;
    revision = activated.revision;
  }
  captureRunIntent({ presentation: { initialView: "insights" } });
  await workspaceStore.dispatch({
    kind: "runAnalysis",
    input: {
      source: { kind: "dataset", id: datasetId },
      sql: datasetId === saasChurn.metadata.datasetId ? saasChurn.sql : healthcarePii.sql,
      bindings: {},
      presentation:
        datasetId === saasChurn.metadata.datasetId
          ? SAAS_CHURN_ANALYSIS_PRESENTATION
          : HEALTHCARE_PII_ANALYSIS_PRESENTATION,
      expectedRevision: revision,
      idempotencyKey: crypto.randomUUID(),
    },
  });
}

/**
 * The custody chip gesture: the `verifyCustody` read, with the canvas tab
 * switch applied only when the read succeeds — a canvas-local view change,
 * never a workspace mutation (§3.2: reads pulse no chrome).
 */
export async function verifyEvidence(): Promise<boolean> {
  const envelope = await workspaceStore.dispatch({ kind: "verifyCustody", input: { scope: "workspace" } });
  return envelope.ok;
}
