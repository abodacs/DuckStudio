# ADR 0008 — Deploy shape: gzipped DuckDB-WASM served through a Pages Function

- Status: Accepted
- Date: 2026-09-03
- Deciders: @abdullah
- Technical Area: Build, Deployment, Cloudflare Pages

## Context

Cloudflare Pages rejects uploaded files larger than 25 MiB, and the
self-hosted DuckDB-WASM bundles (ADR 0002) exceed it: `duckdb-eh.wasm` is
~34 MB and `duckdb-mvp.wasm` ~39 MB. The production deploy has been stale
since before these assets shipped because the CI deploy job (AgDR-0001)
never ran green after the engine landed — the wall is real and now blocks
ticket 65's deploy gate. The assets must stay self-hosted: COEP
`require-corp` blocks third-party responses, and the zero-third-party
request rule (PRD §10) applies to the tool path.

One edge constraint shapes the serving path: a Pages Function cannot set
`Content-Encoding` on its response — the Cloudflare edge strips it — so the
function cannot hand the browser a gzipped body and rely on HTTP decoding.

## Decision

- **The build ships `.wasm.gz` instead of `.wasm`.** After `vite build`, the
  build step gzips `dist/duckdb/*.wasm` in place and removes the plain
  file, so nothing over the Pages size limit is ever uploaded. `public/`
  keeps the plain `.wasm` files for the dev server, which has no limit.
- **A Pages Function serves the wasm, decompressing server-side.**
  `functions/duckdb/[file].js` intercepts `/duckdb/*.wasm` requests, fetches
  the `.gz` twin from the same-origin asset store, and streams it through
  `DecompressionStream("gzip")`, answering with plain
  `application/wasm`. `duckdb-wasm`'s URL handling and
  `WebAssembly.instantiateStreaming` are unchanged, every request stays
  same-origin (the e2e same-origin assertions exercise this path through
  `wrangler pages dev`), and the edge's own compression can still shrink the
  transfer.
- **Worker scripts and all other assets stay static.** Only the two `.wasm`
  files exceed the limit; the function falls through to the static pipeline
  for every non-`.wasm` path so the `_headers` isolation rules keep applying.

## Consequences

### Positive

- The CI deploy job can actually ship the engine; production stops drifting
  from `main`.
- No app-runtime code changes: the engine, the worker, and the e2e suite
  keep using the same URLs and see plain wasm bytes.
- The stored asset is ~7–9 MB per bundle; decompression happens on the edge,
  not in the browser's critical path.

### Negative

- The deploy is no longer purely static files: one ~40-line function sits on
  the wasm path. It is stateless, read-only, and same-origin only.
- `pnpm build` now depends on a `gzip` binary (present on CI runners and
  standard developer machines).
- The function pays CPU for server-side decompression per cold fetch (mitig
  by the `Cache-Control` on its response).
- A missing `.gz` twin for a requested `.wasm` 404s loudly at engine boot
  rather than failing silently mid-query.
