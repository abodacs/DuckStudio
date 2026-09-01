import { describe, expect, it } from "vitest";
import { CompiledEnvelopeFailure, CompiledEnvelopeSuccess } from "../envelope";
import { buildGetContextTool } from "../registration";
import { invokeTool, startSimulator } from "../simulator";
import { createWorkspaceStore, type WorkspaceStore } from "../../revisioned-workspace/store";

/**
 * The parity contract (ticket 05/14): the native tool definition and the
 * simulator are two adapters over one dispatch seam, so their envelopes must
 * never drift. This test fails the day either adapter grows wrapping, error
 * shaping, or a second parse.
 *
 * The three fixed inputs cover one success, one domain failure, and one
 * validation failure. They are a correction to 05's verbatim list, whose
 * inputs inverted the encoded refine semantics: decision 03 allows
 * `datasetId` on any scope and requires it *for* scope `schema`, so the
 * refine violation is `schema` without `datasetId`, and `DATASET_UNAVAILABLE`
 * needs a `datasetId` to reach the domain seam at all.
 */
async function runBothAdapters(store: WorkspaceStore, input: unknown) {
  // Negotiation first, then both adapters: a tool call can only arrive after
  // registration picked a surface, so both sides must see the same
  // post-negotiation snapshot (the summary reports capabilities).
  startSimulator(store);
  const native = await buildGetContextTool(store).execute(input);
  const simulated = await invokeTool("duckdb_get_context", input);

  // Deep equality already forces identical ok and errorCode; the explicit
  // assertions keep the intent legible when the shapes drift.
  expect(simulated).toEqual(native);
  expect(simulated.ok).toBe(native.ok);
  return { native, simulated };
}

describe("webmcp vs simulator parity at the dispatch seam (ticket 14)", () => {
  it("summary read: both adapters answer the same success envelope", async () => {
    const { native, simulated } = await runBothAdapters(createWorkspaceStore(), {
      scope: "summary",
    });

    expect(native.ok).toBe(true);
    CompiledEnvelopeSuccess.parse(native);
    CompiledEnvelopeSuccess.parse(simulated);
  });

  it("schema read: both adapters answer the same DATASET_UNAVAILABLE envelope", async () => {
    const { native, simulated } = await runBothAdapters(createWorkspaceStore(), {
      scope: "schema",
      datasetId: "saas_churn",
    });

    expect(native.ok).toBe(false);
    if (!native.ok) {
      expect(native.error.code).toBe("DATASET_UNAVAILABLE");
    }
    CompiledEnvelopeFailure.parse(native);
    CompiledEnvelopeFailure.parse(simulated);
  });

  it("refine violation: both adapters answer the same VALIDATION_ERROR envelope", async () => {
    const { native, simulated } = await runBothAdapters(createWorkspaceStore(), {
      scope: "schema",
    });

    expect(native.ok).toBe(false);
    if (!native.ok) {
      expect(native.error.code).toBe("VALIDATION_ERROR");
    }
    CompiledEnvelopeFailure.parse(native);
    CompiledEnvelopeFailure.parse(simulated);
  });
});
