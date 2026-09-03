import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { workspaceStore } from "../revisioned-workspace/store";
import { nativeModelContextAvailable, registerTools } from "../agent-control-plane/registration";
import { warmEngine } from "../duck-engine/worker";
import { armEgressMonitoring, type EgressMonitor, type EgressScope } from "../dataset-custody/egress";
import { custodyKernel, type CustodyKernel } from "../dataset-custody/kernel";
import type { WorkspaceRouter } from "./router";

/** Mounted app handle returned by {@link start} (ADR 0001 am5). */
export interface App {
  root: Root;
}

/**
 * The ordered startup contract (ARCHITECTURE.md; ADR 0001 am6): `boot`
 * executes exactly these steps, in this order — the plan is the control
 * flow, so the body and the promise cannot drift. Slice 2 inserts `"warm"`
 * between `"gate"` and `"mount"` (ADR 0007): the worker warms and egress
 * monitoring arms before anything mounts, so no command can outrun a warm
 * engine and zero dataset uploads are provable from first paint (ADR 0002
 * am3, grilling 24). The workspace store is not a step: it is the domain
 * module's exported binding, which exists before any step runs.
 */
export const BOOT_PLAN = ["gate", "warm", "mount", "register"] as const;

export type BootStep = (typeof BOOT_PLAN)[number];

/**
 * The warm step (Slice 2): egress interception arms first — synchronously,
 * in the same slot — then the DuckDB worker warms (ADR 0007: warm on first
 * paint, so first analysis pays no cold start).
 */

/** Injectable seams so `warmDefault` can be driven headlessly, like {@link StartInjection}. */
export interface WarmInjection {
  /** Defaults to `globalThis`. */
  scope?: EgressScope;
  /** Defaults to the app's {@link custodyKernel} binding. */
  kernel?: CustodyKernel;
  /** Defaults to {@link warmEngine}; tests inject a no-op. */
  warm?: () => Promise<void>;
}

let egressMonitor: EgressMonitor | null = null;

/**
 * Arms interception exactly once per page. A failed boot retries the whole
 * plan — warm included — and a failed warm deliberately leaves interception
 * armed (it must cover first paint regardless); re-arming would stack a
 * second wrapper layer and account every later dataset send twice.
 */
export function armOnce(scope: EgressScope, kernel: CustodyKernel): EgressMonitor {
  egressMonitor ??= armEgressMonitoring(scope, kernel);
  return egressMonitor;
}

export async function warmDefault(inject: WarmInjection = {}): Promise<void> {
  armOnce(inject.scope ?? globalThis, inject.kernel ?? custodyKernel);
  await (inject.warm ?? warmEngine)();
}

/** Injectable seams so `start` can be driven headlessly (ADR 0001 am6). */
export interface StartInjection {
  /** Defaults to the document's `#root` element. */
  container?: Element;
  /** Defaults to the WebMCP secure-context gate read. */
  gate?: () => boolean;
  /** Defaults to {@link warmDefault}; tests inject a no-op. */
  warm?: () => Promise<void>;
}

/**
 * One page, one boot (05's belt): concurrent `start()` callers share one
 * in-flight promise. A boot that fails **before** the register step clears
 * the memo, so the next `start()` re-runs the plan instead of handing every
 * later caller the same immortal rejection (a failed warm is retryable by
 * design — the engine singleton and the worker's warm slot both reset on
 * failure). Once `registerTools` has been reached, the memo keeps its guard:
 * the WebMCP surface has no unregister, so a retry could double-register,
 * and a register-step failure stays terminal.
 */
let app: Promise<App> | undefined;
let registrationReached = false;

export function start(inject: StartInjection = {}): Promise<App> {
  app ??= boot(inject).catch((error: unknown) => {
    if (!registrationReached) {
      app = undefined;
    }
    throw error;
  });
  return app;
}

/**
 * The container lookup (boot's only DOM query), extracted as its own
 * decision so the failure is assertable headlessly.
 */
export function findRootContainer(doc: Pick<Document, "querySelector">): Element {
  const container = doc.querySelector("#root");
  if (!container) {
    throw new Error("boot: #root container is missing from index.html");
  }
  return container;
}

/**
 * The mount step: the router renders under StrictMode. Views read the
 * workspace through the domain module's `workspaceStore` binding, so mount
 * carries no state of its own.
 */
export function mountInto(container: Element, router: WorkspaceRouter): Root {
  const root = createRoot(container);
  root.render(createElement(StrictMode, null, createElement(RouterProvider, { router })));
  return root;
}

/**
 * Ordered startup, driven by {@link BOOT_PLAN} (ADR 0001 am5). Registration
 * stays strictly after mount — the tool's `execute` closes over the store,
 * which the binding provides, and the agent cannot call a tool before the
 * shell can render its result. Registration is not in a React effect, so
 * StrictMode's double mount cannot double-fire it.
 */
async function boot(inject: StartInjection): Promise<App> {
  const container = inject.container ?? findRootContainer(document);

  let nativeAvailable = false;
  let root: Root | undefined;
  for (const step of BOOT_PLAN) {
    switch (step) {
      case "gate":
        nativeAvailable = (inject.gate ?? nativeModelContextAvailable)();
        break;
      // The worker warm slot (ADR 0002 am3 / ADR 0007): awaited before
      // mount, so no command can ever outrun a warm engine.
      case "warm":
        await (inject.warm ?? warmDefault)();
        break;
      // The route table is the dynamic-import boundary (ADR 0007): the
      // router chunk must never block first paint.
      case "mount":
        root = mountInto(container, (await import("./router")).router);
        break;
      case "register":
        registrationReached = true;
        await registerTools(workspaceStore, nativeAvailable);
        break;
    }
  }
  if (!root) {
    // The plan is data; a plan without "mount" is a defect, thrown loudly.
    throw new Error('boot: BOOT_PLAN produced no mount — the "mount" step is missing');
  }
  return { root };
}
