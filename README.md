# DuckStudio

DuckStudio is an agent-native, zero-upload data lab. DuckDB-WASM analyzes local data inside a browser worker while WebMCP lets an agent operate a governed workspace without receiving result rows or taking custody of the file.

The core idea is **controlled release**. A browser agent can observe both tool payloads and the page, so one custody policy governs what may enter either surface. Product intent and positioning: [`PRODUCT.md`](./PRODUCT.md).

## Status

Slices 1–4 are implemented: the walking skeleton deploys from CI, dataset custody and the DuckDB-WASM engine run in a worker, the revisioned workspace creates immutable artifacts, and the agent control plane registers all four WebMCP tools, covered end to end. Slices 5–6 remain open — the evidence canvas views currently render pinned empty states, and preset button/prompt-chip wiring, production hardening, and the demo pack are still ahead. The slice tracker in [`docs/prd.md`](./docs/prd.md) §9 is canonical.

- Shared language: [`CONTEXT.md`](./CONTEXT.md)
- Product intent: [`PRODUCT.md`](./PRODUCT.md)
- Agent and protocol design: [`docs/agent-system-design.md`](./docs/agent-system-design.md)
- Build scope and acceptance: [`docs/prd.md`](./docs/prd.md)
- Demo contract: [`docs/video-script.md`](./docs/video-script.md)
- Implementation architecture: [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- Decision records: [`docs/adr/`](./docs/adr)
- Custody and safe release: [`SECURITY.md`](./SECURITY.md)
- Workflow, tests, audit, browser setup: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Agent behavior: [`AGENTS.md`](./AGENTS.md)

## WebMCP Tools

| Tool                           | API        | Purpose                                                                                    |
| ------------------------------ | ---------- | ------------------------------------------------------------------------------------------ |
| `duckdb_get_context`           | Imperative | Bootstrap or delta-read the actionable workspace state.                                    |
| `duckdb_activate_dataset`      | Imperative | Activate an already local preset with revision and idempotency control.                    |
| `duckdb_execute_sql_to_canvas` | Imperative | Run one bounded read-only analysis, create an artifact, infer presentation, and select it. |
| `duckdb_verify_zero_egress`    | Imperative | Read scoped upload, release, transport, policy, and lineage evidence.                      |

All four tools are imperative — the page exposes no declarative form tools. Tool contracts, envelopes, and agent playbooks: [`docs/agent-system-design.md`](./docs/agent-system-design.md) §8 and §12. The pinned registration-API facts: [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Demo Presets

Two synthetic presets are generated in browser memory and activated by ID — `saas_churn` and `healthcare_pii`. Pinned numbers, policies, and demo order: [`docs/prd.md`](./docs/prd.md) §6.

## Stack

Vite, React, TypeScript, Tailwind CSS, and `@tanstack/react-router`, with `@duckdb/duckdb-wasm` in a Web Worker, hand-rolled SVG charts in `src/live-canvas/`, and self-hosted fonts. Full stack and platform rationale: [`PRODUCT.md`](./PRODUCT.md).

## Local Development

Prerequisites, both defined and enforced:

- **Node 26** — `.nvmrc` (`nvm use` selects it), `engines.node` in `package.json`, and pnpm's `engineStrict` fail the install on any other major.
- **pnpm 11.25.0** — pinned via `packageManager`; corepack (or pnpm ≥ 10.17's own manager) switches to it automatically.

On a clean checkout, fetch the self-hosted DuckDB-WASM assets once — `pnpm build` fails without them:

```bash
pnpm install
pnpm duckdb:download    # fetch gitignored DuckDB-WASM assets; required before the first build
pnpm dev                # dev server on http://localhost:5173
pnpm lint               # oxlint over the repo; --deny-warnings: any warning fails
pnpm lint:strict        # the nine trust-seam files, raised rules, --deny-warnings
pnpm typecheck          # tsc --noEmit
pnpm test               # vitest (CI mode)
pnpm build              # static dist/ (public/_headers ships with it)
pnpm build && pnpm e2e  # Playwright serves dist/ via wrangler pages dev on port 8787
```

Warning levels are controlled, not floating: `pnpm lint` denies warnings repo-wide, and `.oxlintrc.json` raises the trust-seam rules (`no-explicit-any`, `no-non-null-assertion`, `no-console`) to errors in eight of the nine trust-seam files. A warning is either fixed or explicitly configured away — never accumulated.

E2E launches Chrome with `--enable-features=WebMCPTesting --enable-experimental-web-platform-features`, so the native registration path is exercised headlessly.

Never commit to `main` — work on a feature branch and open a PR with [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md). Workflow rules: [`AGENTS.md`](./AGENTS.md). Tests, checks, and the pre-publish audit: [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Deploy (Cloudflare Pages)

The Pages project was created once with `--production-branch main`. Every push to `main` deploys from CI: after the quality and E2E jobs are green, the deploy job builds and runs `wrangler pages deploy dist --project-name duckstudio --branch main`, authenticated with the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets. Deploys ship the static `dist/` and inherit `public/_headers` (COOP/COEP/CORP) at the edge.

Preview deploys for a feature branch are manual:

```bash
pnpm exec wrangler pages deploy dist --project-name duckstudio
```

## Connect a Browser Agent

WebMCP requires Chromium `146.0.7672.0` or higher with the `#enable-webmcp-testing` flag, and tools register only in a secure context — HTTPS or `localhost`; on a LAN IP they do not register. Full setup steps (remote debugging, flag, reload): [`CONTRIBUTING.md`](./CONTRIBUTING.md).

When `document.modelContext` is absent, the built-in Agent Simulator takes over — same workspace, same operations; only the language model is simulated.

## How tools register

One imperative registration path with a module-owned `AbortController` (`src/agent-control-plane/registration.ts`):

```ts
const registry = nativeAvailable ? document.modelContext : undefined;
if (registry && "registerTool" in registry) {
  const tools = buildTools(store);
  for (const tool of tools) {
    await registry.registerTool(tool, {
      signal: registrationAbortController.signal,
    });
  }
}
```

Unregistering means aborting `registrationAbortController` — there is no `unregisterTool()`. A cross-origin iframe embedding the app must include `allow="tools"` in its Permissions Policy.

## Project Structure

Implementation lives in eight module folders under `src/`, colocated by use case — UI, state, tests, and registrations stay together, with no top-level `components`, `hooks`, `utils`, `services`, or `types` buckets. The binding folder structure and module lifecycle: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Resources

- [WebMCP proposal and specification](https://github.com/webmachinelearning/webmcp)
- [Chrome WebMCP imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Chrome WebMCP declarative API](https://developer.chrome.com/docs/ai/webmcp/declarative-api)
- [React on Cloudflare Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)

## License

MIT.
