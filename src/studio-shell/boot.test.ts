// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { BOOT_PLAN, findRootContainer, start } from "./boot";

// Registration is terminal by design (no unregisterTool): a boot that reached
// register must keep its memo so a retry can never double-register. Mocked so
// the failure branch is observable without a real modelContext.
vi.mock("../agent-control-plane/registration", () => ({
  nativeModelContextAvailable: () => false,
  registerTools: () => Promise.reject(new Error("registration: simulated failure")),
}));

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
  it("hands every concurrent caller the same in-flight app promise", async () => {
    const first = start({ gate: () => false });
    const second = start({ gate: () => false });

    expect(second).toBe(first);
    await expect(first).rejects.toThrow();
  });

  // A failed pre-registration boot must not poison the memo: the rejection
  // would otherwise be handed to every later caller forever, leaving a dead
  // page that no retry can revive (the engine's warm slot is retryable by
  // design). The next start() re-runs the plan from the top.
  it("a failed pre-registration boot clears the memo, so the next start() re-runs the plan", async () => {
    const first = start({ gate: () => false });
    await expect(first).rejects.toThrow("boot: #root container is missing from index.html");

    const second = start({ gate: () => false });
    expect(second).not.toBe(first);
    await expect(second).rejects.toThrow("boot: #root container is missing from index.html");
  });

  // Registration is the one non-retryable step (no unregisterTool): once the
  // plan reached register, the memo keeps its guard — the retry promise is
  // the same rejection, never a second registerTools pass.
  it("a boot that reached register keeps the memo terminal", async () => {
    const container = document.createElement("div");
    container.id = "root";
    document.body.appendChild(container);
    const bootOptions = { container, gate: () => false, warm: () => Promise.resolve() };

    const first = start(bootOptions);
    await expect(first).rejects.toThrow("registration: simulated failure");

    const second = start(bootOptions);
    expect(second).toBe(first);
    await expect(second).rejects.toThrow("registration: simulated failure");
  });
});
