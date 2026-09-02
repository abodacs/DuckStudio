import { describe, expect, it } from "vitest";
import { BOOT_PLAN, findRootContainer, start } from "./boot";

/**
 * The headless boot-order surface (ARCHITECTURE.md; ADR 0001 am5/am6): boot
 * order is asserted here, without a DOM. The plan is the control flow —
 * `boot` executes exactly `BOOT_PLAN`, in order — so pinning the array pins
 * the runtime order. Slice 2 inserts `"warm"` between `"gate"` and
 * `"mount"` (ADR 0007); this test is the guard that makes that insertion a
 * reviewed, ordered change.
 */
describe("boot order (ADR 0001 am5)", () => {
  it("executes exactly the planned steps: gate, warm, mount, register in order", () => {
    // Slice 2 inserted "warm" between "gate" and "mount" (ADR 0007): the
    // engine worker warms before anything mounts (ADR 0002 am3).
    expect(BOOT_PLAN).toEqual(["gate", "warm", "mount", "register"]);

    const indexOf = (step: string) => BOOT_PLAN.indexOf(step as never);
    expect(indexOf("gate")).toBeLessThan(indexOf("warm"));
    expect(indexOf("warm")).toBeLessThan(indexOf("mount"));
    expect(indexOf("mount")).toBeLessThan(indexOf("register"));
  });
});

describe("findRootContainer", () => {
  it("returns the #root element", () => {
    const container = { id: "root" } as unknown as Element;
    const doc = { querySelector: (selector: string) => (selector === "#root" ? container : null) };
    expect(findRootContainer(doc)).toBe(container);
  });

  it("throws the pinned error when #root is missing", () => {
    const doc = { querySelector: () => null };
    expect(() => findRootContainer(doc)).toThrow("boot: #root container is missing from index.html");
  });
});

describe("start memoization (ADR 0001 am6)", () => {
  // Node has no DOM, so boot rejects at the container lookup — which is
  // exactly what makes the memo observable headlessly: the second caller
  // receives the same promise instead of re-running startup.
  it("hands every caller the same app promise — registerTools can never fire twice", async () => {
    const first = start({ gate: () => false });
    const second = start({ gate: () => false });

    expect(second).toBe(first);
    await expect(first).rejects.toThrow();
  });
});
