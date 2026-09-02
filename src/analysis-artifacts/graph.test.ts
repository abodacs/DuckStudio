import { describe, expect, it } from "vitest";
import { createArtifactGraph } from "./graph";
import { sha256Hex } from "./sql-hash";
import type { AppendInput } from "./graph";

/**
 * The artifact-graph unit proofs (ticket 36): known-vector `sqlHash`,
 * identity generation, commit-time lineage copying, immutability by
 * construction, and relation-only retention. The store-level behaviors
 * (evicted access envelopes, refinement against a live relation) live in the
 * workspace contract tests — tested once, at the seam that owns them.
 */

const baseInput: AppendInput = {
  source: { kind: "dataset", id: "saas_churn" },
  sourceRevision: 1,
  sql: "SELECT tickets FROM saas_churn",
  sqlHash: sha256Hex("SELECT tickets FROM saas_churn"),
  bindings: { threshold: 5 },
  schema: [{ name: "tickets", type: "INTEGER", classification: "public" }],
  rowCount: 9,
  policy: "public_synthetic",
  release: {
    status: "allowed",
    rawRowsToAgent: 0,
    rawRowsToSharedCanvas: 9,
    omittedDirectIdentifiers: [],
    cohortMinimum: 10,
    redactedBindingKeys: [],
  },
  presentation: { grid: { visible: true } },
  metrics: { executionMs: 12.5, materializedRows: 9, chartPoints: 9 },
  createdAt: "2026-09-02T00:00:00.000Z",
  summary: { kpis: [] },
};

describe("sqlHash (§4.3: lowercase hex SHA-256 of the exact submitted SQL)", () => {
  it("matches known vectors", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("SELECT 1")).toBe("e004ebd5b5532a4b85984a62f8ad48a81aa3460c1ca07701f386135d72cdecf5");
  });

  it("hashes the exact string — a one-byte change re-hashes entirely", () => {
    expect(sha256Hex("SELECT 1")).not.toBe(sha256Hex("SELECT 1 "));
    expect(sha256Hex("SELECT tickets FROM saas_churn WHERE tickets > $threshold")).toBe(
      "a8baedb008def5e2817e0ffbcc6e08bf426d608fc4e1fa0d0129514eef500b1e",
    );
  });
});

describe("identity generation (grilling 32: artifact_a_NN, monotonic, never reused)", () => {
  it("peeks without consuming; a failed attempt's identity goes to the next commit", () => {
    const graph = createArtifactGraph();
    expect(graph.previewIdentity()).toEqual({ artifactId: "a_01", relationName: "artifact_a_01" });
    expect(graph.previewIdentity()).toEqual({ artifactId: "a_01", relationName: "artifact_a_01" });
    graph.append(baseInput);
    expect(graph.previewIdentity().artifactId).toBe("a_02");
  });

  it("generates valid SQL identifiers, zero-padded", () => {
    const graph = createArtifactGraph();
    const record = graph.append(baseInput);
    expect(record.artifact.relationName).toMatch(/^artifact_a_\d{2}$/);
    expect(/^[A-Za-z_][A-Za-z0-9_]*$/.test(record.artifact.relationName)).toBe(true);
  });
});

describe("lineage (grilling 32: copied at commit, dataset first, never self)", () => {
  it("starts a chain at the dataset and extends it in commit order", () => {
    const graph = createArtifactGraph();
    const first = graph.append(baseInput);
    expect(first.artifact.lineage).toEqual([{ kind: "dataset", id: "saas_churn" }]);

    const second = graph.append({
      ...baseInput,
      source: { kind: "artifact", id: first.artifact.artifactId },
    });
    expect(second.artifact.lineage).toEqual([
      { kind: "dataset", id: "saas_churn" },
      { kind: "artifact", id: "a_01" },
    ]);

    const third = graph.append({
      ...baseInput,
      source: { kind: "artifact", id: second.artifact.artifactId },
    });
    expect(third.artifact.lineage).toEqual([
      { kind: "dataset", id: "saas_churn" },
      { kind: "artifact", id: "a_01" },
      { kind: "artifact", id: "a_02" },
    ]);
    expect(third.artifact.lineage.some((entry) => entry.id === "a_03")).toBe(false);
  });
});

describe("immutability (ticket 36: impossible by construction)", () => {
  it("freezes the committed record — mutation attempts throw or are ignored", () => {
    const graph = createArtifactGraph();
    const record = graph.append(baseInput);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.artifact)).toBe(true);
    expect(Object.isFrozen(record.artifact.lineage)).toBe(true);
    expect(() => {
      (record.artifact as { sql: string }).sql = "DROP TABLE saas_churn";
    }).toThrow();
    expect(() => (record.artifact.lineage as unknown[]).push({ kind: "artifact", id: "x" })).toThrow();
    expect(record.artifact.sql).toBe("SELECT tickets FROM saas_churn");
    expect(record.artifact.lineage).toHaveLength(1);
  });

  it("carries no mutation surface: the graph exposes no update or delete", () => {
    const graph = createArtifactGraph();
    expect(Object.keys(graph).sort()).toEqual([
      "all",
      "append",
      "availability",
      "find",
      "markEvicted",
      "previewIdentity",
      "retentionDrops",
    ]);
  });
});

describe("retention (grilling 32: relation-only drop, newest always retained)", () => {
  it("names the oldest still-materialized artifacts beyond the limit", () => {
    const graph = createArtifactGraph();
    for (let i = 0; i < 21; i += 1) {
      graph.append({ ...baseInput, sql: `${baseInput.sql} -- ${i}` });
    }
    expect(graph.all()).toHaveLength(21);
    expect(graph.retentionDrops(20)).toEqual(["a_01"]);
    graph.markEvicted("a_01");
    expect(graph.retentionDrops(20)).toEqual([]);
  });

  it("keeps evicted metadata disclosed via find while availability rules access", () => {
    const graph = createArtifactGraph();
    graph.append(baseInput);
    expect(graph.availability("a_01")).toBe("available");
    expect(graph.find("a_01")?.artifact.rowCount).toBe(9);
    graph.markEvicted("a_01");
    expect(graph.find("a_01")?.artifact.artifactId).toBe("a_01");
    expect(graph.availability("a_01")).toBe("relation_evicted");
    expect(graph.availability("a_99")).toBe("not_found");
  });
});
