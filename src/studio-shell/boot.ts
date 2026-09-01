import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/** Mounted app handle returned by {@link start} (ADR 0001 am5). */
export interface App {
  root: Root;
}

/**
 * Ordered startup, one step per decision (ADR 0001 am5): the skeleton only
 * mounts the router. The worker warm step, workspace store, and tool
 * registration insert ahead of it as their slices land.
 */
export async function start(): Promise<App> {
  const container = document.querySelector("#root");
  if (!container) {
    throw new Error("boot: #root container is missing from index.html");
  }

  // The route table is the dynamic-import boundary (ADR 0007): the router
  // chunk must never block first paint.
  const { router } = await import("./router");

  const root = createRoot(container);
  root.render(createElement(StrictMode, null, createElement(RouterProvider, { router })));
  return { root };
}
