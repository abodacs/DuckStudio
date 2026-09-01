# ADR 0005 — `src/` follows the screaming architecture in `AGENTS.md`

- Status: Accepted
- Date: 2026-08-31
- Deciders: @senior-frontend-architect
- Technical Area: Frontend, Project Structure
- Amendment 2: 2026-08-31 (template conformance: Deciders, Technical Area, add Alternatives Considered, split Consequences into Positive/Negative/Neutral, add Implementation, References, Decision Log)
- Amendment 3: 2026-09-01 (projection: one owner, two named functions, four call sites; preset seed→relation contract test; schema placement per ADR 0004 amendment 4)
- Amendment 4: 2026-09-02 (rev-0 envelope `summary` sources `projectWorkspace` — ticket 06's resolution of the amendment-3 tension; `projectArtifact` serves artifact-bearing summaries from Slice 3)
- Amendment 1: 2026-08-31 (projection module, cross-cutting tests, no-shared-kernel, handler ownership)

## Context

`AGENTS.md` already specifies a use-case-oriented `src/` tree. The top level must describe an agent-native, zero-upload data lab, not React plumbing. `AGENTS.md` is the law; this ADR records the concrete folder contents and the rule that every feature colocates its UI, domain commands, projections, schemas, and tests.

## Decision

```text
src/
├── studio-shell/         # two-pane chrome, boot via boot.ts start(), header state
├── revisioned-workspace/ # domain commands, revision, idempotency, events, atomic commit, projection, schemas
├── dataset-custody/      # policy, SQL inspection, release, cohort confirmation, evidence, schemas
├── duck-engine/          # worker singleton, bindings, budgets, cancellation
├── analysis-artifacts/   # immutable graph and lineage, schemas
├── live-canvas/          # artifact-scope projection consumer; four evidence views
├── agent-control-plane/  # thin adapters, envelope module (transport vocabulary, re-exports), WebMCP+simulator registration
└── demo-presets/         # the two seeded datasets: generator + metadata + canonical SQL
```

No top-level `components/`, `hooks/`, `utils/`, `services/`, `types/`, or `stores/` bucket. No `src/shared/` (see ADR 0004 amendment). A feature's UI, store, tests, and registration live next to each other.

### Projection module (amended 3)

`revisioned-workspace/projection.ts` is the **single owner of the projection functions**. Two named interfaces leave it:

- `projectWorkspace(ws)` — workspace scope. Consumed by `agent-control-plane/simulator.ts` (left-pane artifact cards) and `studio-shell/` (header badge); also the envelope `summary` while no artifact can exist (amendment 4).
- `projectArtifact(ws, id)` — artifact scope. Consumed by `live-canvas/` (Insights, Data Grid, SQL & Lineage, Custody) and, from Slice 3, `agent-control-plane/envelope.ts` (artifact-bearing summaries).

"Single projection consumer" was already false: this ADR named three consumers and the header badge was a silent fourth. The PRD's "one safe projection" property is enforced by one owner with two named scopes, not by one function — DOM evidence and tool payloads cannot drift. A Vitest contract test in `revisioned-workspace/projection.test.ts` asserts that, per scope, the projection object is referentially equal across all four call sites.

### Cross-cutting tests (amended 3)

Contract tests that span features live in a `_contract/` subfolder inside the feature that owns the contract. For example:

- `agent-control-plane/_contract/webmcp-vs-simulator-parity.test.ts` proves that the WebMCP and simulator adapters produce identical envelopes, events, and artifacts for the same commands.
- `revisioned-workspace/_contract/stale-revision-recovery.test.ts` proves the recovery action shape.
- `dataset-custody/_contract/release-decision.test.ts` proves the safe-release table from `agent-system-design.md` §5.1.
- `demo-presets/_contract/preset-numbers.test.ts` runs each preset's canonical SQL against the engine and asserts the pinned `prd.md` §6 values, so the demo numbers are load-bearing (amended 3).

Unit tests for a single module live next to that module (`projection.test.ts` next to `projection.ts`). Vitest's `vitest.workspace.ts` aggregates them.

### Handler ownership (amended)

`selectArtifact` and `cancelActiveOperation` are workspace commands. Their handlers live in `revisioned-workspace/`. The simulator and the human UI both dispatch through the workspace store's `dispatch` method; they do not import the handlers directly. This keeps `agent-control-plane/` thin: it only knows how to translate WebMCP/simulator input into a domain command and how to translate the envelope into a transport response.

## Alternatives Considered (amended 2)

### Option 1: Feature-first screaming architecture (this ADR)

**Description**: Top-level folders describe use cases (`studio-shell/`, `revisioned-workspace/`, `dataset-custody/`, `duck-engine/`, `analysis-artifacts/`, `live-canvas/`, `agent-control-plane/`, `demo-presets/`). Each feature colocates its UI, store, schemas, projection, and tests.
**Pros**: A new contributor can read the top level and know what the product does. A new feature gets one folder, not five file moves across technical buckets. PRD's "one safe projection" rule is enforced by folder ownership.
**Cons**: Cross-cutting concerns (logger, telemetry stub) need a `kernel/` subfolder inside a feature, not a top-level bucket. Tests that span features live in `_contract/` inside the feature that owns the contract — naming convention is the only signal.
**Why rejected**: N/A — selected.

### Option 2: Layered (technical-type) architecture

**Description**: Top-level folders describe the technical layer (`components/`, `hooks/`, `utils/`, `services/`, `types/`, `stores/`). Each component is grouped by its type, not by its feature.
**Pros**: Familiar to anyone coming from a Next.js or Rails app. Easy to find "all the hooks" in one place. Frameworks often ship templates in this shape.
**Cons**: The top level describes React, not DuckStudio. A new contributor sees `components/` and `hooks/` before they see "revisioned workspace" or "custody kernel." The PRD's "one safe projection" rule becomes a hunt across `components/`, `services/`, and `utils/`.
**Why rejected**: This is exactly the shape `AGENTS.md` forbids. Reading the top level must describe the product.

### Option 3: Hexagonal / ports-and-adapters

**Description**: `domain/`, `application/`, `infrastructure/` top-level folders. Use cases live under `application/`, adapters under `infrastructure/`.
**Pros**: Clean separation of policy and mechanism. Familiar to DDD practitioners.
**Cons**: For a single-tab, one-day build, the layers map 1:1 to folders that already exist by use case. The abstraction is more ceremony than structure.
**Why rejected**: The screaming-architecture tree already gives the same separation by ownership (custody, duck-engine, control-plane) without the extra vocabulary. The PRD does not need a port/adapter split.

## Consequences (amended 2)

### Positive (amended 3)

- The projection is one owner, two named scopes, four asserted call sites. There is no fork between "what the tool sees," "what the canvas sees," and "what the badge says."
- Reading the top level tells a new contributor what the product does, not which framework it uses.
- A future feature gets one folder, not five file moves across technical buckets.
- The single `agent-control-plane/` folder is the only place that knows the envelope exists. Adapters do not import schemas from one another.
- The projection function is a single named, tested, referentially-shared object. There is no fork between "what the tool sees" and "what the canvas sees."
- Cross-cutting tests have a clear home (`_contract/`) and a clear owner (the feature that owns the contract).
- `selectArtifact` and `cancelActiveOperation` have one handler, called by all adapters.

### Negative

- Cross-cutting primitives that are imported by three or more features must be promoted to a `kernel/` subfolder inside the most-relevant feature. There is no top-level `src/shared/` to dump them in. Reviewers must enforce this by hand.
- Test naming convention (`_contract/`) is the only signal that a test spans features. A future `eslint` rule or a vitest workspace config could formalize this.

### Neutral

- No `src/shared/` junk drawer.

## Implementation (amended 3)

- Scaffold each top-level folder under `src/` with the responsibilities described in the Decision tree.
- `revisioned-workspace/projection.ts` is the single owner of the projection functions `projectWorkspace(ws)` and `projectArtifact(ws, id)`. The contract test `revisioned-workspace/projection.test.ts` asserts referential equality per scope across the four call sites: live-canvas views (and the envelope `summary` from Slice 3 — at rev 0 the summary is workspace scope, `projectWorkspace`) for `projectArtifact`, simulator cards and the studio-shell header badge for `projectWorkspace`.
- Domain schemas colocate with their owning modules (`revisioned-workspace/schemas.ts`, `dataset-custody/schemas.ts`, `analysis-artifacts/schemas.ts`); `agent-control-plane/envelope.ts` re-exports them (ADR 0004 amendment 4).
- `selectArtifact` and `cancelActiveOperation` handlers live in `revisioned-workspace/`. The simulator and the human UI both call `workspace.dispatch(...)`; they do not import the handlers directly.
- Cross-cutting contract tests live in `<feature>/_contract/`:
  - `agent-control-plane/_contract/webmcp-vs-simulator-parity.test.ts`
  - `revisioned-workspace/_contract/stale-revision-recovery.test.ts`
  - `dataset-custody/_contract/release-decision.test.ts`
- `lint-strict` (ADR 0003) covers `dataset-custody/**`, `agent-control-plane/envelope.ts`, `agent-control-plane/registration.ts`, `revisioned-workspace/projection.ts`, and `duck-engine/sql-inspector.ts`.

## References (amended 2)

- ADR 0001 — App framework: Vite + React + TanStack Router (router lives under `studio-shell/`)
- ADR 0002 — DuckDB-WASM in a dedicated Web Worker (worker lives under `duck-engine/`)
- ADR 0003 — Lint and format with oxlint + oxfmt (`lint-strict` paths map to folder ownership)
- ADR 0004 — Colocated state, `zod@4.5` schemas with AOT compile, single trust seam (no-shared-kernel rule)
- ADR 0006 — Tooling versions and Cloudflare Pages deployment (Vite version pin)
- `ARCHITECTURE.md` — Folder Structure: Screaming Architecture
- Bob Martin, "Screaming Architecture" (origin of the term)

---

## Decision Log

| Date       | Change   | By                       |
| ---------- | -------- | ------------------------ |
| 2026-08-31 | Proposed | @senior-frontend-architect |
| 2026-08-31 | Amendment 1: projection module, cross-cutting tests, no-shared-kernel, handler ownership | @senior-frontend-architect |
| 2026-08-31 | Amendment 2: template conformance | @senior-frontend-architect |
| 2026-08-31 | Accepted | @senior-frontend-architect |
| 2026-09-01 | Amendment 3: projection (one owner, two named functions, four call sites), preset contract test, schema placement alignment | @senior-frontend-architect |
