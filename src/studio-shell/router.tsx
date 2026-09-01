import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { workspaceSearchSchema } from "../revisioned-workspace/schemas";
import { WorkspaceShell } from "./shell";

const rootRoute = createRootRoute();

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  // The search schema is owned by revisioned-workspace (ADR 0001 am5) and
  // reaches the router only through this import — never re-declared here.
  validateSearch: zodValidator(workspaceSearchSchema),
  component: WorkspaceShell,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([workspaceRoute]),
  defaultPreload: "intent",
});
