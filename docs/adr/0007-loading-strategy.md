# ADR 0007 — Loading strategy: warm the worker, lazy the chart, preload the font

- Status: Accepted
- Date: 2026-08-31
- Deciders: @senior-frontend-architect
- Technical Area: Frontend, Performance

## Context

The static build serves a single COOP/COEP origin (ADR 0006). The COEP header enables `SharedArrayBuffer`, which DuckDB-WASM needs, but the first analysis cannot pay a multi-second cold start once a user reaches the canvas. Three things load on the critical path: the DuckDB-WASM worker, ECharts, and the self-hosted fonts (Inter, Space Grotesk, JetBrains Mono per ADR 0006). TanStack Router v1 adds ~30 KB gzipped to the main bundle (ADR 0001). The PRD measures the time from first paint to the first `duckdb_get_context` envelope; the demo tape will too.

## Decision

- **DuckDB-WASM warms inside the worker on first paint.** The worker singleton from ADR 0002 is created at app boot, before the canvas mounts. First-paint cost includes the worker init; first-analysis cost does not.
- **ECharts lazy-loads on first chart render.** The chart bundle is split into its own chunk and only fetched when a user opens a view that renders a chart. Insights, Grid, SQL & Lineage, and Custody do not import ECharts.
- **Fonts preload with `<link rel="preload" as="font" crossorigin>`.** Inter, Space Grotesk, and JetBrains Mono are self-hosted in `public/fonts/`. Preload headers are emitted by the Vite plugin and pinned by the `public/_headers` file (CORP `same-origin` per ADR 0006).
- **TanStack Router is code-split.** The `studio-shell/router.tsx` module is the only router import; it is a dynamic `import()` boundary so the route table does not block first paint.

## Consequences

### Positive

- First analysis after paint is bounded by query execution, not by worker init.
- ECharts is paid for only by users who reach a chart.
- Fonts paint with the first text; no FOUT on the header or left-pane cards.

### Negative

- The worker is alive even if the user never opens the canvas. It costs ~hundreds of milliseconds of init and a small idle heap.
- A future chart view that does not use ECharts still has to opt out of the lazy chunk if the import path is shared.

### Neutral

- The router code-split boundary is fixed at `studio-shell/router.tsx`. Future routes add files, not boundaries.

## Alternatives Considered

### Option 1: Lazy-load the worker on first analysis

**Description**: Create the DuckDB-WASM worker only when the first `runAnalysis` or `getContext` dispatches.
**Pros**: No init cost for users who never analyze. Smaller first paint.
**Cons**: First analysis after a cold start is visibly slow on the demo tape. Breaks the "no first-analysis cold start" property the PRD measures.
**Why rejected**: The acceptance scenarios expect a bounded first-analysis latency. The worker init is paid up front, not on the analysis path.

### Option 2: Inline ECharts in the main bundle

**Description**: Ship ECharts in the main chunk; no lazy split.
**Pros**: One HTTP request. No chunk boundary to test.
**Cons**: Every user pays the chart cost even if they only read the custody card. ECharts is the single largest JS dependency in the tree.
**Why rejected**: Bundle bloat on a COEP origin that already loads WASM. Lazy is cheap; inline is paid by everyone.

### Option 3: Google Fonts CDN

**Description**: Use Google Fonts for Inter, Space Grotesk, JetBrains Mono.
**Pros**: No font hosting cost. CDN-cached.
**Cons**: COEP `require-corp` blocks third-party responses that do not send CORP. Google Fonts is a third party. This is exactly the deployment trap ADR 0006 names in the CORP amendment.
**Why rejected**: Self-host is mandatory under COEP `require-corp`. CDN is a deployment defect.

## Implementation

- `duck-engine/worker.ts` calls `getWorker()` at module top-level (see ADR 0002 worker singleton). The promise is awaited once from `studio-shell/main.tsx` before the React tree mounts.
- ECharts is imported via `await import("echarts")` inside the chart component, behind a Suspense boundary.
- `public/_headers` adds `Link: </fonts/inter-400.woff2>; rel=preload; as=font; crossorigin` (and the two sibling font files) per ADR 0006 CORP rules.
- `vite.config.ts` uses `build.rollupOptions.output.manualChunks` to split the ECharts vendor and the router into named chunks.

## References

- ADR 0001 — App framework: Vite + React + TanStack Router (router code-split reference)
- ADR 0002 — DuckDB-WASM in a dedicated Web Worker (worker singleton)
- ADR 0006 — Tooling versions and Cloudflare Pages deployment (CORP, fonts, Vite version)
- MDN — `Cross-Origin-Embedder-Policy`: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Embedder-Policy

---

## Decision Log

| Date       | Change   | By                       |
| ---------- | -------- | ------------------------ |
| 2026-08-31 | Proposed | @senior-frontend-architect |
| 2026-08-31 | Accepted | @senior-frontend-architect |
