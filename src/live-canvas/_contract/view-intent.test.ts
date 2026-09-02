import { describe, expect, it } from "vitest";
import {
  capturePolicyHint,
  captureRunIntent,
  consumeInitialView,
  peekPolicyHint,
  resolvePostCommitView,
} from "../view-intent";

/**
 * The dispatch-time capture contract (grilling 52 item 4): the human
 * adapter's `initialView` capture is one-shot and never workspace state; the
 * post-commit tab honors it unless it asks for a grid the policy forbids,
 * then falls to §4.5 inference.
 */
describe("view intent capture and post-commit inference (grilling 52)", () => {
  it("captures initialView once and consumes it once", () => {
    expect(consumeInitialView()).toBeUndefined();
    captureRunIntent({ presentation: { initialView: "custody" } });
    expect(consumeInitialView()).toBe("custody");
    expect(consumeInitialView()).toBeUndefined();
    captureRunIntent({});
    expect(consumeInitialView()).toBeUndefined();
  });

  it("applies the requested view; grid for sensitive_aggregate_only falls to inference", () => {
    const churn = { policy: "public_synthetic", hasChart: true, kpiCount: 4 };
    expect(resolvePostCommitView("grid", churn)).toBe("grid");
    expect(resolvePostCommitView(undefined, churn)).toBe("insights");
    expect(resolvePostCommitView("custody", churn)).toBe("custody");

    const sensitive = { policy: "sensitive_aggregate_only", hasChart: true, kpiCount: 1 };
    expect(resolvePostCommitView("grid", sensitive)).toBe("insights");
  });

  it("infers sql_lineage when neither a KPI nor a chart survives", () => {
    expect(resolvePostCommitView(undefined, { policy: "public_synthetic", hasChart: false, kpiCount: 0 })).toBe(
      "sql_lineage",
    );
  });

  it("keeps the latest POLICY_DENIED permittedPresentation hint", () => {
    expect(peekPolicyHint()).toBeUndefined();
    capturePolicyHint({ permittedPresentation: '{"kpis":[]}' });
    expect(peekPolicyHint()).toBe('{"kpis":[]}');
    capturePolicyHint(undefined);
    expect(peekPolicyHint()).toBe('{"kpis":[]}');
  });
});
