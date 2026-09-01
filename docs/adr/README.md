# Architecture Decision Records

Each ADR records one decision: the context, the options we considered, the choice, and the consequences. ADRs are immutable once accepted; supersede with a new ADR that links back.

Canonical contracts still live in `PRODUCT.md`, `docs/agent-system-design.md`, `docs/prd.md`, `ARCHITECTURE.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `docs/video-script.md`. ADRs explain the *why* behind the implementation choices those contracts assume.

| ADR | Title | Status |
|---|---|---|
| [0001](./0001-app-framework-vite-react.md) | App framework: Vite + React + TanStack Router | Accepted |
| [0002](./0002-duckdb-wasm-in-worker.md) | DuckDB in a dedicated Web Worker | Accepted |
| [0003](./0003-oxlint-oxfmt.md) | Lint and format with oxlint + oxfmt | Accepted |
| [0004](./0004-colocated-state-and-schema.md) | Colocated state, `zod` schemas, single trust seam | Accepted |
| [0005](./0005-src-screaming-architecture.md) | `src/` follows screaming architecture from `ARCHITECTURE.md` | Accepted |
| [0007](./0007-loading-strategy.md) | Loading strategy: warm the worker, lazy the chart, preload the font | Accepted |

## AgDRs

Tooling/stack choices that change with installed versions live as Agent Decision Records under [`docs/agdr/`](../agdr/). ADRs above are version-stable contracts.

| AgDR | Title | Status |
|---|---|---|
| [AgDR-0001](../agdr/0001-tooling-versions-and-cloudflare.md) | Tooling stack and Cloudflare Pages deployment (no version pins) | Executed |
