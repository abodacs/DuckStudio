import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { staleRevisionPin, workspaceSearchSchema } from "../revisioned-workspace/schemas";
import { workspaceStore } from "../revisioned-workspace/store";
import { WorkspaceShell } from "./shell";
import { WorkspaceError } from "./workspace-error";

/**
 * The router owns the URL, not the workspace (ADR 0001): views read the
 * store through `useWorkspace`, so no router context carries it and there is
 * no `store: undefined!` placeholder to keep honest.
 */
const rootRoute = createRootRoute();

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  // The search schema is owned by revisioned-workspace (ADR 0001 am5) and
  // reaches the router only through this import — never re-declared here.
  validateSearch: zodValidator(workspaceSearchSchema),
  // The `{rev}` pin's reader (04's resolved plan): a pin naming any revision
  // but the live one is stale — rejected by redirecting to the same route
  // with the pin stripped (the artifact deep-link survives). Junk params
  // never get here; the strict schema throws into `errorComponent`.
  beforeLoad: ({ search }) => {
    if (staleRevisionPin(search, workspaceStore.getSnapshot().revision)) {
      throw redirect({ to: "/", search: { artifact: search.artifact } });
    }
  },
  component: WorkspaceShell,
  errorComponent: WorkspaceError,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([workspaceRoute]),
  defaultPreload: "intent",
});

/** The inferred router instance type, consumed by boot's mount step. */
export type WorkspaceRouter = typeof router;
