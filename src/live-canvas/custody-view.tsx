import { projectArtifact } from "../revisioned-workspace/projection";
import { useWorkspace } from "../revisioned-workspace/use-workspace";
import { UnavailableArtifact } from "./artifact-states";

/**
 * Custody evidence view (§13): the §8.4 evidence snapshot the store captured
 * from the kernel recorder at commit — scope, counters, monitored
 * transports, lineage, and both pinned limitations. The view dispatches
 * nothing: a `verifyCustody` read never mutates chrome (§3.2).
 */
/** The actionable empty-state line (slice-7 plan stage 2): what to do next. */
export const CUSTODY_EMPTY_STATE = "Run an analysis and its custody evidence lands here.";

export function CustodyView() {
  const artifact = useWorkspace((ws) => projectArtifact(ws, ws.selectedArtifactId));
  switch (artifact.kind) {
    case "no_artifact":
      return (
        <div className="view-swap empty-state">
          <div aria-hidden className="rise relative size-20">
            <span className="absolute inset-0 rounded-full border border-edge" />
            <span className="absolute inset-3 rounded-full border border-accent/20" />
            <span className="absolute top-1/2 left-1/2 size-2 -translate-1/2 rounded-full bg-accent/45" />
          </div>
          <div className="rise" style={{ animationDelay: "140ms" }}>
            <p className="meta">{CUSTODY_EMPTY_STATE}</p>
            <p className="meta mt-1">Run verify after your first artifact to see the evidence.</p>
          </div>
        </div>
      );
    case "unavailable":
      return <UnavailableArtifact artifactId={artifact.artifactId} reason={artifact.reason} />;
    case "artifact":
      return artifact.custody ? (
        <div className="view-swap flex h-full flex-col gap-3 overflow-y-auto p-3">
          <p className="meta">
            scope <span className="mono-value">{artifact.custody.scope.kind}:{artifact.custody.scope.id}</span> ·
            observed <span className="mono-value">{artifact.custody.observedAt}</span>
          </p>
          <dl className="meta grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
            <dt>dataset bytes uploaded</dt>
            <dd className="mono-value">{artifact.custody.datasetBytesUploaded} B</dd>
            <dt>raw values released to tools</dt>
            <dd className="mono-value">{artifact.custody.rawSensitiveValuesReleasedToTools}</dd>
            <dt>raw values released to shared canvas</dt>
            <dd className="mono-value">{artifact.custody.rawSensitiveValuesReleasedToSharedCanvas}</dd>
            <dt>policy</dt>
            <dd className="mono-value">{artifact.custody.policy ?? "—"}</dd>
          </dl>
          <p className="meta">
            monitored transports:{" "}
            <span className="mono-value">{artifact.custody.monitoredTransports.join(" · ")}</span>
          </p>
          <div>
            <h3 className="card-label">LINEAGE</h3>
            <p className="mono-value mt-1 text-xs">
              {artifact.custody.lineage.map((entry) => `${entry.kind}:${entry.id}`).join(" → ")}
            </p>
          </div>
          <div>
            <h3 className="card-label">LIMITATIONS</h3>
            <ul className="meta mt-1 list-disc space-y-1 pl-4">
              {artifact.custody.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="view-swap empty-state">
          <p className="meta">
            {artifact.artifact.artifactId} · release {artifact.artifact.release.status}
          </p>
          <p className="meta mt-2">
            No evidence snapshot was captured for this artifact — run the analysis again to record one.
          </p>
        </div>
      );
  }
}
