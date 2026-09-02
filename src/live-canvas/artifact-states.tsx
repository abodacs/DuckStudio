/**
 * Shared fallback state for the evidence views (grilling 32): an artifact
 * whose relation retention evicted — or an id nothing points at — discloses
 * the eviction instead of rendering a dead reference. The full evidence
 * views bind to the same `projectArtifact` view.
 */
export function UnavailableArtifact({
  artifactId,
  reason,
}: {
  artifactId: string;
  reason: "not_found" | "relation_evicted";
}) {
  return (
    <div className="view-swap empty-state">
      <p className="mono-value text-sm">{artifactId}</p>
      <p className="meta mt-2">
        {reason === "relation_evicted"
          ? "Its materialized relation was evicted by retention — the metadata and lineage remain, the rows do not."
          : "No artifact with that id exists in this tab."}
      </p>
    </div>
  );
}
