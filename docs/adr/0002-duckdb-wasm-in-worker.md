# ADR 0002 — DuckDB-WASM in a dedicated Web Worker

- Status: Accepted
- Date: 2026-08-31
- Deciders: @senior-frontend-architect
- Technical Area: Backend (in-worker), Performance
- Amendment 2: 2026-08-31 (template conformance: Deciders, Technical Area, reformat Alternatives, split Consequences into Positive/Negative/Neutral, add Implementation, References, Decision Log)
- Amendment 3: 2026-09-01 (worker init awaited from studio-shell/boot.ts start(), per ADR 0001 amendment 5)
- Amendment 1: 2026-08-31 (respawn cost, library API, binding translation, worker singleton, OPFS)

## Context

DuckStudio must execute one bounded read-only SQL statement, return Arrow batches to the main thread, expose parameter bindings, enforce budgets, and support cancellation. The execution plane cannot share the main thread with the React render path or with the custody kernel, which must authorize SQL *before* DuckDB sees it.

## Alternatives Considered (amended 2)

### Option 1: `@duckdb/duckdb-wasm` in a dedicated Web Worker

**Description**: Native DuckDB compiled to WASM, Arrow IPC, OPFS-backed file support, real SQL planner, prepared statements with `bind(...)`, isolated from the main thread.
**Pros**: Mature package, Arrow IPC is the right shape for the worker boundary, OPFS is available, prepared statements support `bind(...)`, isolated from the React render path and the custody kernel.
**Cons**: Cold-start cost is hundreds of milliseconds per worker init. Cancellation requires either respawn or a custom `MessagePort` abort protocol.
**Why rejected**: N/A — selected.

### Option 2: `sql.js` (SQLite)

**Description**: SQLite compiled to WASM via Emscripten, row-store, no OPFS, no Arrow.
**Pros**: Smaller bundle, simpler API.
**Cons**: Row-store, weak analytics, no `WITH` planning, no OPFS, no parameter bindings, no Arrow. Wrong shape for analytical workloads.
**Why rejected**: The acceptance scenarios assume aggregate SQL with `WITH` and columnar batches. SQLite is the wrong substrate for this workload.

### Option 3: Remote DuckDB sidecar

**Description**: A separate service that owns a DuckDB process and accepts SQL over HTTP.
**Pros**: No browser-memory ceiling, persistent storage, real multi-user backend.
**Cons**: Breaks the zero-upload thesis. Requires a server, an auth model, and a network boundary. The custody release policy cannot intercept network egress at the right layer.
**Why rejected**: `PRODUCT.md` and `SECURITY.md` are explicit: zero dataset upload, in-browser only. A sidecar violates the non-negotiable.

### Option 4: Hand-rolled WASM DuckDB build

**Description**: Compile DuckDB to WASM ourselves and ship a hand-rolled binding layer.
**Pros**: Total control over the binding shape and the build flags.
**Cons**: Re-derives the official package, loses maintainer support, diverges from upstream, costs more than the one-day build can afford.
**Why rejected**: The official `@duckdb/duckdb-wasm` package is the supported surface. Hand-rolling it for a one-day build is a maintenance liability with no payoff.

## Decision

Use **`@duckdb/duckdb-wasm` inside one dedicated Web Worker** for the lifetime of the session. The worker owns the `duckdb.AsyncDuckDB`, the `AsyncDuckDBConnection`, prepared statements, and any in-memory tables for presets. The main thread talks to the worker through the library's bundled `ConsoleLogger` worker bootstrap and `postMessage`; we do not write a custom `MessagePort` layer.

### Library API surface (amended)

The worker exposes:

- `prepare(sql: string)` returns a handle, enforces the SQL deny list before the statement is sent to DuckDB.
- `bindAndQuery(handle, bindings)` binds by `$1, $2, ...` positional parameters and runs the prepared statement.
- `streamArrow(handle)` returns Arrow batches up to `resultRows` budget, then closes the cursor.

Custody-kernel authorization happens on the main thread, in `dataset-custody/sql-inspector.ts`, before the worker sees the SQL. Unsafe SQL never crosses the boundary.

### Sub-decision: cancellation

- **Default:** respawn the worker on `cancelActiveOperation`. Simpler, fewer race conditions, the single-flight invariant in `docs/agent-system-design.md` §10 stays trivial.
- **Cost (amended):** respawning the worker pays the cold-start tax on the *next* analysis. DuckDB-WASM init is hundreds of milliseconds. The PRD does not measure this, but the demo tape will. We accept this cost because:
  1. The acceptance scenarios have at most one cancel in the scripted path.
  2. An abort protocol through the `MessagePort` would require instrumenting every DuckDB call to check a signal, which is fragile.
  3. The single-flight invariant is the simpler invariant to maintain.
- **Alternative considered:** pass an `AbortSignal` through the `MessagePort` and let DuckDB-WASM abort the running query. Rejected for the one-day build.

### Parameter binding translation (amended)

The PRD schema accepts `bindings: Record<string, string | number | boolean | null>`. DuckDB prepared statements bind by **positional `$1, $2, ...`** or by **named `$name`**, with strict types. We:

1. Rewrite `{ name: value }` into positional parameters at the SQL-inspector boundary, generating `WHERE col = $1` substitution and an ordered binding array.
2. Validate each binding's type against the column type from the schema digest before calling `bind()`. A mismatch returns `VALIDATION_ERROR` with the field detail, not a DuckDB bind error.
3. Redact binding values in every projection per `SECURITY.md`; raw values never leave the custody kernel.

### Worker singleton (amended)

A module-level `let workerPromise: Promise<Worker> | null = null` in `duck-engine/worker.ts` enforces one worker per session. `getWorker()` is async and idempotent. React StrictMode double-mount or any future remount does not spawn a second worker. The `AbortController` from `agent-control-plane/registration.ts` does not control worker lifetime; the worker is torn down only on cancel or on `pagehide`.

### OPFS (amended)

OPFS persistence is **not used in the one-day build.** The worker uses in-memory tables for the two presets. OPFS is a future option; we do not raise it in this ADR.

## Consequences (amended 2)

### Positive

- The custody kernel authorizes SQL before forwarding it to the worker. Unsafe SQL never reaches DuckDB.
- Bindings are type-checked at the boundary, not at the DuckDB bind call. SQL injection via `null` for NOT NULL is impossible.
- The worker is a singleton. Concurrent mounts cannot create two DuckDB connections.
- `cancelActiveOperation` becomes `worker.terminate() + getWorker()` (resolves to a fresh worker). The revisioned workspace records the cancel event and leaves the prior artifact selected.

### Negative

- The next analysis after a cancel pays the cold-start cost. This is acceptable for the scripted demo.
- DuckDB-WASM init is hundreds of milliseconds and is paid up front by ADR 0007 (worker warms on first paint). A LAN-IP user who cannot enable COEP cannot run analysis at all.
- We depend on the official `@duckdb/duckdb-wasm` package; a breaking upstream change is our problem.

### Neutral

- Worker lifetime is owned by the page, not by the `AbortController` from `agent-control-plane/registration.ts`. Cancellation is the only teardown path during the session.
- OPFS is available but not used in the one-day build. The two presets live in in-memory tables.

## Implementation (amended 2)

- `duck-engine/worker.ts` owns the `duckdb.AsyncDuckDB`, the `AsyncDuckDBConnection`, prepared statements, and the in-memory preset tables. A module-level `let workerPromise: Promise<Worker> | null = null` enforces the singleton. `getWorker()` is async and idempotent.
- The main thread uses the library's bundled `ConsoleLogger` worker bootstrap. No custom `MessagePort` layer.
- `dataset-custody/sql-inspector.ts` is the trust seam. SQL is inspected on the main thread before any `postMessage` to the worker. Unsafe SQL never crosses the boundary.
- Binding translation lives at the SQL-inspector boundary: `{ name: value }` becomes positional `$1, $2, ...` and the values are type-checked against the column type from the schema digest.
- `cancelActiveOperation` is implemented as `worker.terminate()` followed by a fresh `getWorker()`. The revisioned workspace records the cancel event and the prior artifact remains selected.
- Worker init is awaited from `studio-shell/boot.ts`'s `start()` before the React tree mounts, per ADR 0007 (amendment 1).

## References (amended 2)

- ADR 0006 — Tooling versions and Cloudflare Pages deployment (DuckDB-WASM version pin)
- ADR 0007 — Loading strategy: warm the worker, lazy the chart, preload the font (worker warm-up)
- `@duckdb/duckdb-wasm` docs: https://duckdb.org/docs/api/wasm/overview
- `docs/agent-system-design.md` §6 — SQL allow/deny list
- `docs/agent-system-design.md` §10 — single-flight invariant

---

## Decision Log

| Date       | Change   | By                       |
| ---------- | -------- | ------------------------ |
| 2026-08-31 | Proposed | @senior-frontend-architect |
| 2026-08-31 | Amendment 1: respawn cost, library API, binding translation, worker singleton, OPFS | @senior-frontend-architect |
| 2026-08-31 | Amendment 2: template conformance | @senior-frontend-architect |
| 2026-08-31 | Accepted | @senior-frontend-architect |
| 2026-09-01 | Amendment 3: worker init awaited from studio-shell/boot.ts start() | @senior-frontend-architect |
