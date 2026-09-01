import { describe, expect, expectTypeOf, it } from "vitest";
import * as envelope from "../envelope";
import * as domain from "../../revisioned-workspace/schemas";

describe("envelope re-exports (ADR 0004 am4)", () => {
  it("re-exports the domain schemas import-equal", () => {
    expect(envelope.CapabilitySchema).toBe(domain.CapabilitySchema);
    expect(envelope.BudgetLimitsSchema).toBe(domain.BudgetLimitsSchema);
    expect(envelope.OperationSummarySchema).toBe(domain.OperationSummarySchema);
    expect(envelope.WorkspaceSchema).toBe(domain.WorkspaceSchema);
    expect(envelope.ErrorCodeSchema).toBe(domain.ErrorCodeSchema);
    expect(envelope.GetContextInputSchema).toBe(domain.GetContextInputSchema);
    expect(envelope.CompiledGetContextInput).toBe(domain.CompiledGetContextInput);
    expect(envelope.GetContextSummaryDataSchema).toBe(domain.GetContextSummaryDataSchema);
    expect(envelope.GetContextEventsDataSchema).toBe(domain.GetContextEventsDataSchema);
    expect(envelope.WorkspaceEventSchema).toBe(domain.WorkspaceEventSchema);
    expect(envelope.GET_CONTEXT_TOOL_DESCRIPTION).toBe(domain.GET_CONTEXT_TOOL_DESCRIPTION);
  });

  it("infers identical domain types through the re-export", () => {
    expectTypeOf<envelope.Capability>().toEqualTypeOf<domain.Capability>();
    expectTypeOf<envelope.BudgetLimits>().toEqualTypeOf<domain.BudgetLimits>();
    expectTypeOf<envelope.OperationSummary>().toEqualTypeOf<domain.OperationSummary>();
    expectTypeOf<envelope.Workspace>().toEqualTypeOf<domain.Workspace>();
    expectTypeOf<envelope.ErrorCode>().toEqualTypeOf<domain.ErrorCode>();
    expectTypeOf<envelope.GetContextInput>().toEqualTypeOf<domain.GetContextInput>();
    expectTypeOf<envelope.GetContextSummaryData>().toEqualTypeOf<domain.GetContextSummaryData>();
    expectTypeOf<envelope.GetContextEventsData>().toEqualTypeOf<domain.GetContextEventsData>();
    expectTypeOf<envelope.WorkspaceEvent>().toEqualTypeOf<domain.WorkspaceEvent>();
  });

  // The URL seam (workspaceSearchSchema) is routed directly from the domain
  // module and deliberately absent here; every name envelope does share must
  // be the very same binding, never a fork.
  it("owns no domain-named export of its own: every overlapping name is the domain binding", () => {
    for (const name of Object.keys(domain)) {
      if (name in envelope) {
        expect(envelope[name as keyof typeof envelope]).toBe(domain[name as keyof typeof domain]);
      }
    }
  });
});
