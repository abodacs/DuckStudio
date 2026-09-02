# Contributing

Workflow for DuckStudio: the test floor, the checks that must pass, the pre-publish audit, and browser setup. Architecture rules live in `ARCHITECTURE.md`; custody rules in `SECURITY.md`; agent behavior in `AGENTS.md`; dev tooling (caveman, ripgrep) in [`docs/dev-tooling.md`](./docs/dev-tooling.md).

## Tests

Colocate tests with each feature. At minimum cover:

- schema and runtime-validation agreement;
- SQL allow/deny cases;
- release policy for both preset modes;
- cohort suppression and sensitive DOM absence;
- stale revision and idempotent retry semantics;
- artifact immutability and refinement lineage;
- budget failure, cancellation, and no partial commit;
- compact context and bounded response sizes;
- structured errors and recovery actions;
- human, simulator, and WebMCP adapter parity;
- registration cleanup and remount behavior;
- custody evidence scope and limitations.

Run tests, lint, typecheck, and production build after code changes. Fix failures rather than bypassing checks.

## Self-Hosted DuckDB-WASM Assets

The engine's runtime assets (wasm + worker scripts) are self-hosted from `public/duckdb/` (COEP `require-corp` blocks third-party responses). A clean checkout must fetch them once before building:

```sh
pnpm duckdb:download
```

The script packs the exact `@duckdb/duckdb-wasm` pin from `package.json` and fails loudly when an expected asset is missing; `pnpm build` fails when the assets are absent.

## Pre-Publish WebMCP Audit

Audit before you publish:

```sh
npx ax webmcp-audit http://localhost:3000
```

How the score works (<https://webmcp.ora.ai/audit>): Availability gates the score — a page no in-browser agent can use gets no number. What passes the gate is scored on four pillars, out of 100:

- **Shared experience** — weight 30. People and agents share this page. We grade the page a person actually sees and whether they can see what the agent does, so a site cannot score well by serving agents and no one else.
- **Task completion** — weight 25. Could an agent get a task done here. We give an agent the tasks a site of this kind exists for and check it picks the right tool with the right arguments, and that the tool set covers the job.
- **Tool quality** — weight 25. Are the tool contracts built right. Valid schemas, descriptions that say what comes back, names an agent can tell apart, handlers behind every tool.
- **Trust** — weight 20. Can an agent trust what the tools declare. Read-only hints that match what the tool actually says it does, and metadata that describes tools instead of steering the agent reading it.

## Chrome Setup for WebMCP

WebMCP is in Early Preview on Chromium-based browsers. It requires Chromium `146.0.7672.0` or higher and the `#enable-webmcp-testing` flag. It is gated on a secure context (HTTPS or `localhost`); on a LAN IP it will not register and the simulator takes over (see ADR 0001 amendment 3 and ADR 0006 secure-context guard).

When `document.modelContext` is absent, the built-in Agent Simulator uses the same domain commands and produces the same operations, artifacts, events, and UI projections. Only the language model is simulated.

To set up Chrome for local testing:

1. Open `chrome://inspect/#remote-debugging` and enable remote debugging.
2. Open `chrome://flags/#enable-webmcp-testing`, set **WebMCP testing** to **Enabled**, and relaunch Chrome.
3. Reload DuckStudio so its tools register.

API surface (pinned to the 2026 `modern-web-guidance` `webmcp` and `agentic-javascript-tools` guides): `document.modelContext.registerTool(tool, { signal })` is the only registration path; `navigator.modelContext` is removed in Chromium 150; there is no `unregisterTool()` — tools are unregistered by aborting the `AbortSignal` passed at registration time.
