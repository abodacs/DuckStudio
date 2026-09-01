import { createRootRouteWithContext, createRoute, createRouter } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import type { WorkspaceStore } from "../revisioned-workspace/store";
import { workspaceSearchSchema } from "../revisioned-workspace/schemas";
import { WorkspaceShell } from "./shell";
import { WorkspaceError } from "./workspace-error";

/**
 * The router context is the store seam (ticket 14): boot creates the store
 * and supplies it through the `RouterProvider` `context` prop. Consumers
 * (notably `useWorkspace`) read it from here once wired — the shell stays
 * on the binding module's instance until then.
 */
const rootRoute = createRootRouteWithContext<{ store: WorkspaceStore }>()();

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  // The search schema is owned by revisioned-workspace (ADR 0001 am5) and
  // reaches the router only through this import — never re-declared here.
  validateSearch: zodValidator(workspaceSearchSchema),
  component: WorkspaceShell,
  errorComponent: WorkspaceError,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([workspaceRoute]),
  defaultPreload: "intent",
  // Declaring the context type makes `context` required here, but the real
  // store only exists in boot — it arrives through the RouterProvider
  // `context` prop before any route renders (TanStack's documented pattern).
  context: { store: undefined! },
});
