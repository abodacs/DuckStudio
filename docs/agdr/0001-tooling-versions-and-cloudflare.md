---
id: AgDR-0001
timestamp: 2026-08-31T00:00:00Z
agent: claude
model: claude-sonnet-4.5
session: webmcp-tooling-move
trigger: user-prompt
status: executed
category: tech-stack
projects: [webmcp]
---

# Tooling stack and Cloudflare Pages deployment

> In the context of building DuckStudio as a static, COOP/COEP-isolated origin, facing the need to pin a coherent toolchain that supports the agent-native, zero-upload runtime, I decided on the pnpm + Vite + React + TanStack Router + Tailwind + Vitest + Playwright + oxlint/oxfmt stack to achieve a reproducible one-day build, accepting that exact version pins live in the user's working `package.json` rather than this record.

## Context

DuckStudio ships as a static build served from a single COOP/COEP origin. The runtime assets (DuckDB-WASM bundles, fonts, chart assets) are self-hosted to keep the origin isolated. The deployment target is Cloudflare Pages.

The agent-facing constraints that drove the tool choices:

- one `zod` schema module shared by workspace, WebMCP adapters, simulator, and URL search params (ADR 0004);
- native `document.modelContext.registerTool` registration on Chromium 146+ via the WebMCP testing flag, with a built-in simulator fallback (ADR 0001 amendment 3);
- `crypto.subtle` requires a secure context — LAN-IP demos must degrade gracefully rather than render broken lineage;
- CORP `same-origin` on every self-hosted asset so COEP `require-corp` does not silently block WASM/fonts.

Exact version pins are not recorded here. The user installs compatible versions in `package.json`; CI enforces them via `pnpm install --frozen-lockfile`.

## Options Considered

| Option | Pros | Cons |
| --- | --- | --- |
| **pnpm + Vite + React + TanStack Router + Tailwind + Vitest + Playwright + oxlint/oxfmt** (chosen) | One schema source via `zod`; native Web Worker tests; Chrome flag plumbing for e2e; pre-1.0 oxlint/oxfmt fast enough for hackathon; Cloudflare Pages is a `_headers` swap | Pre-1.0 lint/format churn risk; lockfile drift if versions are unpinned | 
| ESLint + Prettier instead of oxlint/oxfmt | Battle-tested, ecosystem maturity | Too slow on the day for a one-day build; redundant formatter | 
| Next.js or Remix instead of Vite + TanStack Router | Built-in SSR/router | Server runtime fights the zero-upload, COOP/COEP-static-origin model; second schema system | 
| Deploy to Vercel/Netlify instead of Cloudflare Pages | Equally static | No advantage for this app; adds a `_headers`-style config to migrate later | 

## Decision

Chosen: **pnpm + Vite + React + TanStack Router + Tailwind + Vitest + Playwright + oxlint/oxfmt on Cloudflare Pages**, because the stack satisfies the agent-ergonomic contracts (one schema module, native Web Worker testing, Chrome WebMCP testing flag), is small enough to pin and reproduce, and the deployment target is a `_headers` swap away from any other static host.

### Stack responsibilities (no version pins)

| Concern | Choice |
| --- | --- |
| Package manager | pnpm |
| Node | 26 (Current; LTS from 2026-10-28) |
| Bundler / dev server | Vite |
| UI framework | React |
| Router | `@tanstack/react-router` |
| Router zod adapter | `@tanstack/zod-adapter` |
| Styling | Tailwind CSS |
| Charts | ECharts (lazy-loaded) |
| DB | `@duckdb/duckdb-wasm` |
| Schema / validation | `zod` (with AOT compile and `z.strictObject`) |
| JSON Schema derivation | `zod.toJSONSchema()` (built into v4) |
| Lint | `oxlint` |
| Format | `oxfmt` |
| Tests (unit + contract) | `vitest` + `@testing-library/react` |
| Tests (e2e) | `@playwright/test` |
| Deploy | Cloudflare Pages (static) |
| Origin headers | COOP `same-origin`, COEP `require-corp`, CORP `same-origin` on all self-hosted assets |
| Fonts | self-hosted Inter, Space Grotesk, JetBrains Mono |
| ID / hash | `crypto.randomUUID` (always available), `crypto.subtle.digest('SHA-256', ...)` (guarded by `isSecureContext`) |
| License | MIT |

`pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm e2e` are the contract. CI runs all six on every push with `pnpm install --frozen-lockfile`.

### `@tanstack/zod-adapter`

ADR 0004 commits to one `zod` schema module. The `zodSearchValidator` from `@tanstack/zod-adapter` consumes the same schemas at the route boundary. A single `zod` parse error is the same error in WebMCP, the simulator, the workspace, and the URL. No second type system.

### CORP

`Cross-Origin-Resource-Policy: same-origin` on every self-hosted asset in `public/_headers`. Without CORP, COEP `require-corp` blocks the WASM bundle and the fonts with a console error that does not name CORP as the cause.

```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
```

### Secure-context guard

`crypto.subtle` requires `window.isSecureContext`. On a LAN IP, the SQL hash falls back to `UNSUPPORTED_CAPABILITY` with the recovery action "Use HTTPS or localhost," colocated in `dataset-custody/sql-hash.ts`.

The same gate covers WebMCP: `document.modelContext.registerTool` will not register on a non-secure origin (per the 2026 `webmcp` and `agentic-javascript-tools` guides). When the secure-context check fails, the registration owner falls through to the simulator path (ADR 0001 amendment 3).

### E2E layer

Playwright with Chrome that has the WebMCP testing flag enabled. Runs the DOM-side acceptance scenarios (sensitive grid suppression, badge text, custody evidence card) and the WebMCP-vs-simulator parity scenario.

### Loading strategy (see ADR 0007)

DuckDB-WASM warms inside the worker on first paint. ECharts lazy-loads on first chart render. Fonts preloaded with `<link rel="preload" as="font" crossorigin>`. TanStack Router adds ~30 KB gzipped; code-split the `studio-shell/router.tsx` module so the route table does not block first paint.

## Consequences

- A new runtime dependency is a deliberate change. Self-hosting means the build is reproducible and the COEP origin never reaches a third party.
- Cloudflare Pages is the deployment target. Migration to another static host is a `_headers`-style config swap; the application does not know where it is hosted.
- The `zod` adapter eliminates the second-schema problem. The URL, the workspace, the adapters, and the tests all parse the same shape.
- CORP prevents the most common DuckDB-WASM deployment trap.
- A LAN-IP demo surfaces `UNSUPPORTED_CAPABILITY` rather than rendering a broken lineage view.
- Playwright covers the DOM-side acceptance scenarios that Vitest cannot.
- Version pins live in `package.json`; CI uses `pnpm install --frozen-lockfile`. This AgDR records choices, not pins.

## Artifacts

- Supersedes `docs/adr/0006-tooling-versions-and-cloudflare.md` (moved to `docs/agdr/`, version pins removed).