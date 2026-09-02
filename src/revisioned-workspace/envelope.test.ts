import { describe, expect, it } from "vitest";
import { createWorkspaceStore } from "./store";

/**
 * The 8 KB summary-budget story in one place (PRD §10, ticket 08): the knob
 * is the store's seeded `budgets.toolSummaryBytes`, the builder is
 * `envelope.ts`, and this test is the guard. It measures the whole
 * serialized response — warnings and nextActions included, not just `data` —
 * so populated `nextActions` from Slice 3 cannot push the response over
 * budget while the test stays green. Measured in UTF-8 bytes, the canonical
 * budget's unit (agent-system-design.md §14: "The budget is bytes").
 */
describe("tool-summary response budget (PRD §10, ticket 08)", () => {
  it("keeps the serialized rev-0 summary response within the seeded toolSummaryBytes knob", async () => {
    const store = createWorkspaceStore();
    const limit = store.getSnapshot().budgets.toolSummaryBytes;
    expect(limit).toBe(8192);

    const envelope = await store.dispatch({ kind: "getContext", input: { scope: "summary" } });
    if (!envelope.ok) {
      throw new Error("expected the rev-0 summary read to succeed");
    }
    const serialized = JSON.stringify(envelope);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(limit);
  });
});
