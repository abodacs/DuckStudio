import { AnalysisRecordSchema, type AnalysisArtifact, type AnalysisRecord } from "./schemas";

/**
 * The immutable artifact graph (§4.3; grilling 32): the one owner of artifact
 * identity (`a_NN` / relation `artifact_a_NN`, zero-padded, monotonic, never
 * reused even after eviction), commit-time lineage (dataset first, then
 * ancestor artifacts in commit order, never self — copied, never recomputed),
 * and bounded retention. It never re-derives custody decisions: it records
 * what the kernel decided.
 *
 * Identity is *previewed* for the mutation's execution phase (the engine
 * materializes the result under the generated relation before release
 * confirmation) and *consumed* only by `append` at the synchronous commit.
 * The single-flight slot guarantees one mutation at a time, so a previewed
 * identity is always the one `append` commits; a failed attempt consumes
 * nothing and the next attempt previews the same identity.
 */

export interface AppendInput {
  readonly source: AnalysisArtifact["source"];
  readonly sourceRevision: number;
  readonly sql: string;
  readonly sqlHash: string;
  /** Redacted form — raw binding values never reach the graph (§4.3). */
  readonly bindings: AnalysisArtifact["bindings"];
  readonly schema: AnalysisArtifact["schema"];
  readonly rowCount: number;
  readonly policy: AnalysisArtifact["policy"];
  readonly release: AnalysisArtifact["release"];
  readonly presentation: AnalysisArtifact["presentation"];
  readonly metrics: AnalysisArtifact["metrics"];
  readonly createdAt: string;
  readonly summary: AnalysisRecord["summary"];
}

export type ArtifactAvailability = "available" | "not_found" | "relation_evicted";

export interface ArtifactGraph {
  /** Peeks the next identity without consuming the counter (execution phase). */
  previewIdentity(): { readonly artifactId: string; readonly relationName: string };
  /** Consumes the counter and commits the immutable record. Synchronous. */
  append(input: AppendInput): AnalysisRecord;
  /** Raw metadata lookup — works for evicted artifacts too (metadata stays disclosed). */
  find(artifactId: string): AnalysisRecord | undefined;
  /** Access ruling: metadata existence plus whether the relation is still live. */
  availability(artifactId: string): "available" | "not_found" | "relation_evicted";
  /** All committed records in commit order (oldest first). */
  all(): readonly AnalysisRecord[];
  /** Oldest still-materialized artifacts beyond the limit, oldest first; newest always retained. */
  retentionDrops(limit: number): readonly string[];
  /** Records that a relation-only DROP landed; metadata stays in the graph. */
  markEvicted(artifactId: string): void;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** `a_01` / `artifact_a_01` (§8.3) — zero-padded, monotonic, never reused. */
function identity(counter: number): { artifactId: string; relationName: string } {
  const artifactId = `a_${String(counter).padStart(2, "0")}`;
  return { artifactId, relationName: `artifact_${artifactId}` };
}

export function createArtifactGraph(): ArtifactGraph {
  let counter = 1;
  const records: AnalysisRecord[] = [];
  const byId = new Map<string, AnalysisRecord>();
  const evicted = new Set<string>();

  return {
    previewIdentity: () => identity(counter),

    append(input) {
      const { artifactId, relationName } = identity(counter);
      counter += 1;

      // Lineage copied at commit (grilling 32): dataset first, then ancestor
      // artifacts in commit order, never self. A dataset source starts a
      // chain; an artifact source extends its ancestor's chain.
      const lineage: AnalysisArtifact["lineage"] =
        input.source.kind === "dataset"
          ? [{ kind: "dataset", id: input.source.id }]
          : [
              ...(byId.get(input.source.id)?.artifact.lineage ?? []),
              { kind: "artifact", id: input.source.id },
            ];

      const artifact: AnalysisArtifact = deepFreeze(
        AnalysisRecordSchema.shape.artifact.parse({
          artifactId,
          relationName,
          source: input.source,
          sourceRevision: input.sourceRevision,
          sql: input.sql,
          sqlHash: input.sqlHash,
          bindings: input.bindings,
          schema: input.schema,
          rowCount: input.rowCount,
          lineage,
          policy: input.policy,
          release: input.release,
          presentation: input.presentation,
          metrics: input.metrics,
          createdAt: input.createdAt,
        }),
      );
      const record: AnalysisRecord = deepFreeze({
        artifact,
        summary: deepFreeze(AnalysisRecordSchema.shape.summary.parse(input.summary)),
      });
      records.push(record);
      byId.set(artifactId, record);
      return record;
    },

    find(artifactId) {
      return byId.get(artifactId);
    },

    availability(artifactId) {
      if (!byId.has(artifactId)) return "not_found";
      return evicted.has(artifactId) ? "relation_evicted" : "available";
    },

    all: () => records,

    retentionDrops(limit) {
      // Eviction runs after commit (grilling 32): trim to `limit` while the
      // newest artifact is always retained; only still-materialized
      // relations drop, and metadata stays in the graph either way.
      const overCount = records.length - limit;
      if (overCount <= 0) return [];
      return records
        .slice(0, overCount)
        .map((record) => record.artifact.artifactId)
        .filter((artifactId) => !evicted.has(artifactId));
    },

    markEvicted(artifactId) {
      evicted.add(artifactId);
    },
  };
}
