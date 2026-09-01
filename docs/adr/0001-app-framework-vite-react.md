# ADR 0001 — App framework: Vite + React + TanStack Router

- Status: Accepted
- Date: 2026-08-31
- Deciders: @senior-frontend-architect
- Technical Area: Frontend
- Amendment 4: 2026-08-31 (template conformance: Deciders, Technical Area, reformat Options, split Consequences into Positive/Negative/Neutral, add Implementation, References, Decision Log)
- Amendment 5: 2026-09-01 (boot module: studio-shell/boot.ts owns ordered startup behind start(); search-param schema lives with the workspace)
- Amendment 3: 2026-08-31 (WebMCP API surface pinned against the 2026 modern-web-guidance `webmcp` and `agentic-javascript-tools` guides: `document.modelContext` only, `annotations` inside the tool def, `AbortSignal` for unregister, secure-context required, dynamic per-context controllers)
- Amendment 2: 2026-08-31 (revise "no router" to "TanStack Router with typed query state via @tanstack/zod-adapter")
- Amendment 1: 2026-08-31 (registration owner, deep-link owner, cold-start cost, WebMCP mount lifecycle)

## Context

DuckStudio is a one-tab, in-browser data lab. The WebMCP control plane, the DuckDB-WASM worker, the revisioned workspace, and the two-pane evidence UI all run in one origin that must serve `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` so that DuckDB-WASM can use `SharedArrayBuffer`. There is no server, no auth, no SEO surface, and no multi-page navigation in the *runtime* sense, but the URL is a state container for `artifactId`, the active view tab, and any agent-pushed query state.

The PRD pins deep-linkable artifacts (`duckstudio.app/?artifact=a_01`) and the verification path expects a stable URL handle per artifact. Amendment 1 left that to a hand-rolled `location.search` parse in `revisioned-workspace/boot.ts`. That is correct but it reinvents — badly — what TanStack Router's search-param API is for.

## Alternatives Considered (amended 4)

### Option 1: Hand-rolled query-string parse (Amendment 1)

**Description**: No router. `revisioned-workspace/boot.ts` parses `location.search` directly and the workspace subscribes to `popstate`.
**Pros**: Zero dependency. Smallest possible bundle.
**Cons**: No type safety, no validation, no navigation API, no preloading, no back/forward parity. Reinventing this in 2026 is a regression.
**Why rejected**: The URL is a typed contract surface; the same `zod` schemas that parse tool input and the envelope must also parse the URL. A hand-rolled parse would mean a second source of truth.

### Option 2: TanStack Router v1 with `@tanstack/zod-adapter`

**Description**: `@tanstack/react-router@1.170.x` with code-based route definitions. `zodSearchValidator` from `@tanstack/zod-adapter@1.167.0` plugs the same `zod` schemas from ADR 0004 into the route contract.
**Pros**: Typed routes, typed search params, type-safe `<Link>` / `useNavigate`, single source of truth with the workspace, preloading defaults, back/forward parity, client-only with no SSR runtime.
**Cons**: Adds ~30 KB gzipped to the main bundle. v1 line is mature; v2 is RC for Solid only and not in a release channel for React.
**Why rejected**: N/A — selected.

### Option 3: Next.js / TanStack Start

**Description**: SSR framework with React Server Components, file-based routing, and a server runtime.
**Pros**: Mature SSR, route conventions, RSC streaming.
**Cons**: Server runtime is wrong for this app. There is no server, no auth, no SEO surface, and no multi-page navigation in the runtime sense. RSC streaming costs latency we do not need.
**Why rejected**: The one-day build is a static COEP origin. SSR is a deployment defect.

### Option 4: React Router v7

**Description**: Strong client-only mode with the v7 data router.
**Pros**: Mature, widely adopted, supports client-only.
**Cons**: Loses the schema-as-search-state ergonomics that `@tanstack/zod-adapter` provides; its search-param story is hand-typed. Two schema systems.
**Why rejected**: ADR 0004 commits to one `zod` schema module shared by workspace, adapters, and URL. React Router v7 would force a second source of truth.

## Decision

Adopt **TanStack Router v1** (`@tanstack/react-router@1.170.x` — current stable React line, last published 9 days ago at the time of this ADR). Use **code-based route definitions** (not file-based) to keep the screaming architecture; the route table lives in `studio-shell/router.tsx`. Wire search params through `@tanstack/zod-adapter@1.167.0` so the same `zod` schemas the workspace and adapters use also validate the URL.

Track TanStack Router v2 once it stabilizes for React. The v2 line is currently RC for Solid only; React v2 is not in a release channel we can pin. Migration path: a search-and-replace across the router file plus the import surface; route contracts are the same shape, search-param adapter is the same shape.

### What the router owns

- The route tree (one root, one workspace route).
- The typed `search` schema for the workspace route: `{ artifact?: string; view?: "insights" | "grid" | "sql_lineage" | "custody" }`, validated by `zod`.
- Type-safe `<Link>` and `useNavigate` for artifact selection (so `live-canvas/` and the left-pane cards deep-link without touching `location.search`).
- Preloading defaults: `intent` preloading on hover for the workspace root only.

### What the router does **not** own

- Workspace state. The revisioned workspace is the source of truth. The router reflects the URL; the workspace mutates from URL changes through a `beforeLoad` route guard that calls `selectArtifact` and `setView` on the workspace store.
- Tool registration. WebMCP and simulator registration is owned by `agent-control-plane/registration.ts` (Amendment 1) and has no relationship to the router.
- Projection. The projection function in `revisioned-workspace/projection.ts` is the single owner of "what to render" (ADR 0005 amendment). The router only owns "what URL is visible."

### Search-param contract (amended)

```ts
// studio-shell/router.tsx
import { z } from "zod";
import { zodSearchValidator } from "@tanstack/router-core";

const workspaceSearchSchema = z.object({
  artifact: z.string().min(1).max(80).optional(),
  view: z.enum(["insights", "grid", "sql_lineage", "custody"]).optional(),
});

export const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: zodSearchValidator(workspaceSearchSchema),
  beforeLoad: ({ search, cause }) => {
    if (cause === "enter" || cause === "initialLoad") {
      // boot only — back/forward does not re-dispatch
      const ws = getWorkspace();
      if (search.artifact && ws.artifactExists(search.artifact)) {
        ws.dispatch({ kind: "selectArtifact", artifactId: search.artifact, expectedRevision: ws.revision, idempotencyKey: crypto.randomUUID() });
      }
      if (search.view) ws.setView(search.view);
    }
  },
  component: WorkspaceShell,
});
```

The route guard reads, never mutates URL. View changes write back to the URL through `useNavigate({ search: (prev) => ({ ...prev, view: "grid" }) })` so the URL stays the canonical state for *view* but the workspace stays the canonical state for *artifact*. This keeps `ARCHITECTURE.md`'s "canvas tab clicks are not workspace mutations" rule clean while giving the URL a place to live.

### Registration owner (amended 5)

`agent-control-plane/registration.ts` is the single owner of WebMCP and simulator registration. It is imported exactly once, from `studio-shell/boot.ts`'s `start()`. Registration uses an `AbortController` so that React StrictMode double-mount or future re-mounts never produce duplicate tool registrations. The router does **not** own registration.

### Boot module (amended 5)

`studio-shell/boot.ts` exposes one `start(): Promise<App>` and owns ordered startup as pure decision functions: secure-context gate → warm DuckDB worker → create workspace store → mount router → register WebMCP tools → fall back to the simulator when `document.modelContext` is absent. `main.tsx` keeps its sole-importer role (it is the only importer of `boot.ts`) and shrinks to calling `start()`. Boot order — gate first, warm before mount, register after mount — becomes a headless test surface instead of browser folklore.

### WebMCP mount lifecycle (carried from Amendment 1)

The router uses the standard React Router data router with one route. The `WorkspaceShell` component mounts once; `useSyncExternalStore` against the workspace store; no router-internal state. StrictMode-safe.

### WebMCP API contract (amended 3 — pinned to the 2026 modern-web-guidance `webmcp` and `agentic-javascript-tools` guides)

The registration owner uses the imperative `document.modelContext.registerTool(...)` API only. The deprecated `navigator.modelContext` is not checked. Per Chromium 150, `navigator.modelContext` is removed; per the 2026 guides, there is no `unregisterTool()`, no `provideContext()`, and no `clearContext()`. Tool lifecycle is owned by an `AbortController` per context.

```ts
// agent-control-plane/registration.ts
type Mc = NonNullable<Document["modelContext"]>;

async function registerWebMCP(signal: AbortSignal): Promise<void> {
  const ctx: Mc | undefined = "modelContext" in document
    ? (document as Document & { modelContext: Mc }).modelContext
    : undefined;
  if (!ctx || typeof ctx.registerTool !== "function") return; // simulator path takes over

  for (const tool of [getContextTool, activateDatasetTool, runAnalysisTool, verifyCustodyTool]) {
    await ctx.registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema, // JSON Schema from z.toJSONSchema(); see ADR 0004
      execute: tool.execute,        // tool body delegates to workspace.dispatch
      annotations: { readOnlyHint: tool.readOnlyHint }, // inside the tool def, after execute
    }, { signal });
  }
}
```

Rules that come from the 2026 guides, not from our taste:

- **No `navigator.modelContext` fallback.** Removed in Chromium 150. The simulator is the fallback when `document.modelContext` is absent.
- **`annotations` lives inside the tool definition, after `execute`.** Not in the second-argument options bag.
- **Unregister only via `AbortSignal`.** Never call a hypothetical `unregisterTool()`.
- **Tools are atomic, composable, and distinct.** We register the four canonical WebMCP tools; `selectArtifact` and `cancelActiveOperation` are workspace commands, not tools (ARCHITECTURE.md).
- **One `AbortController` per registration context, abort on context teardown.** For DuckStudio the context is the page lifetime plus a StrictMode-safe re-mount path; the controller is module-scoped and the re-mount guard from Amendment 1 keeps it idempotent.
- **Secure context required.** WebMCP will not register on a non-HTTPS, non-`localhost` origin. This is a hard requirement, not a soft one. ADR 0006 already pins the secure-context guard for `crypto.subtle`; the same gate covers WebMCP. On a LAN IP we fall through to the simulator.
- **Read tools carry `readOnlyHint: true`.** `duckdb_get_context` and `duckdb_verify_custody` set it; the two mutations do not.

## Consequences (amended 4)

### Positive (amended 5)

- Boot order is a test surface: the secure-context gate, warm-before-mount, and register-after-mount are assertable headlessly.
- One static build, one tab, no SSR, no server runtime. The router is client-only.
- The URL is typed, validated, and book-markable. A judge can paste `duckstudio.app/?artifact=a_01&view=sql_lineage` into Slack and it round-trips.
- The same `zod` schema that the workspace parses (ADR 0004) parses the URL. No drift.
- TanStack Router v2 migration is a contained refactor when React v2 stabilizes.

### Negative

- Bundle size grows by ~30 KB gzipped (TanStack Router core). ADR 0007 covers loading strategy to keep first paint under the COEP cold-start budget.
- We are pinned to the v1 line; React v2 has no release channel yet. v1 will receive only maintenance fixes.

### Neutral

- Marketing, docs, and any future multi-page surface are still deployed as a separate static site. The workspace is the only consumer of the router.
- No router-level SSR. `getServerSnapshot` returns a frozen empty workspace, the same contract as ADR 0004 amendment.

## Implementation (amended 5)

- `studio-shell/router.tsx` defines the root route and the workspace route. It is the only file that imports `@tanstack/react-router`.
- `studio-shell/main.tsx` is the sole importer of `studio-shell/boot.ts` and shrinks to calling `start()`. `boot.ts` owns ordered startup (see Boot module) and is the sole importer of `agent-control-plane/registration.ts` and the router; the router is mounted inside a `RouterProvider` inside `start()`.
- The search-param `zod` schema lives in `revisioned-workspace/schemas.ts` — artifact and view are workspace vocabulary (ADR 0004 amendment 4) — and reaches `studio-shell/router.tsx` via the envelope re-export. A drift here fails the contract test in `agent-control-plane/_contract/`.
- A `beforeLoad` route guard on the workspace route dispatches `selectArtifact` and `setView` into the workspace store on `enter` and `initialLoad` only. Back/forward is handled by `useSyncExternalStore` over the workspace event log; the guard does not re-dispatch.
- TanStack Router v1 is code-split: `studio-shell/router.tsx` is a dynamic `import()` boundary so the route table does not block first paint (see ADR 0007).

## References (amended 4)

- ADR 0004 — Colocated state, `zod@4.5` schemas with AOT compile, single trust seam (URL schema source of truth)
- ADR 0005 — `src/` follows the screaming architecture in `ARCHITECTURE.md` (folder that owns the router)
- ADR 0006 — Tooling versions and Cloudflare Pages deployment (TanStack Router version pin)
- ADR 0007 — Loading strategy: warm the worker, lazy the chart, preload the font (router code-split)
- TanStack Router docs: https://tanstack.com/router/latest
- `@tanstack/zod-adapter`: https://tanstack.com/router/latest
- 2026 `modern-web-guidance` `webmcp` and `agentic-javascript-tools` guides (cited inline in Amendment 3)

---

## Decision Log

| Date       | Change   | By                       |
| ---------- | -------- | ------------------------ |
| 2026-08-31 | Proposed | @senior-frontend-architect |
| 2026-08-31 | Amendment 1: registration owner, deep-link owner, cold-start cost, WebMCP mount lifecycle | @senior-frontend-architect |
| 2026-08-31 | Amendment 2: revise "no router" to "TanStack Router with typed query state via @tanstack/zod-adapter" | @senior-frontend-architect |
| 2026-08-31 | Amendment 3: WebMCP API surface pinned against 2026 modern-web-guidance guides | @senior-frontend-architect |
| 2026-08-31 | Amendment 4: template conformance | @senior-frontend-architect |
| 2026-08-31 | Accepted | @senior-frontend-architect |
| 2026-09-01 | Amendment 5: boot module (studio-shell/boot.ts start(), main.tsx shrinks to sole importer), search-param schema moved to revisioned-workspace/schemas.ts | @senior-frontend-architect |
