import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createWorkspaceStore } from "../revisioned-workspace/store";
import { nativeModelContextAvailable, registerTools } from "../agent-control-plane/registration";

/** Mounted app handle returned by {@link start} (ADR 0001 am5). */
export interface App {
  root: Root;
}

/**
 * One page, one boot (05's belt): a second `start()` — HMR re-execution or
 * accidental double import — is a no-op returning the existing app.
 */
let app: Promise<App> | undefined;

export function start(): Promise<App> {
  app ??= boot();
  return app;
}

/**
 * Ordered startup, one step per decision (ADR 0001 am5): gate read →
 * workspace store → mount router → register tools | simulator fallback.
 * Registration stays strictly after mount — the tool's `execute` closes
 * over the store, which must already exist, and the agent cannot call a
 * tool before the shell can render its result. Registration is not in a
 * React effect, so StrictMode's double mount cannot double-fire it. The
 * worker warm step is absent, not stubbed; Slice 2 inserts
 * `await warmWorker()` ahead of the store.
 */
async function boot(): Promise<App> {
  const container = document.querySelector("#root");
  if (!container) {
    throw new Error("boot: #root container is missing from index.html");
  }

  const nativeAvailable = nativeModelContextAvailable();
  const store = createWorkspaceStore();

  // The route table is the dynamic-import boundary (ADR 0007): the router
  // chunk must never block first paint.
  const { router } = await import("./router");

  const root = createRoot(container);
  root.render(createElement(StrictMode, null, createElement(RouterProvider, { router, context: { store } })));

  await registerTools(store, nativeAvailable);

  return { root };
}
