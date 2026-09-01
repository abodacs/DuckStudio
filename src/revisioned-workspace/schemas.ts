import { z } from "zod";

/**
 * URL search-param contract for the workspace route (ADR 0001 am5: workspace
 * vocabulary is owned here, never re-declared in the router).
 *
 * Strict about unknown params so junk URLs surface in the route
 * errorComponent instead of being stripped silently. Uncompiled by decision —
 * compilation is the tool-schema seam, not the URL seam.
 */
export const workspaceSearchSchema = z.strictObject({
  rev: z.coerce.number().int().optional(),
});

export type WorkspaceSearch = z.infer<typeof workspaceSearchSchema>;
