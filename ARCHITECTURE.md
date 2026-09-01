# Architecture

Implementation architecture for DuckStudio: folder structure, the one command path, state rules, agent-ergonomic contracts, and module lifecycle. This is the canonical home for those rules.

Related canonical documents: `PRODUCT.md` (product intent and invariants), `docs/agent-system-design.md` (protocol and state mechanics), `SECURITY.md` (custody and safe release), `CONTRIBUTING.md` (tests, checks, audit, browser setup), `AGENTS.md` (agent behavior). ADRs in `docs/adr/` explain the *why* behind the choices here.

The abstraction tower (adapters → revisioned workspace → custody kernel / execution plane / artifact graph → safe projection → evidence plane) is specified in `docs/agent-system-design.md` §2.

## Folder Structure: Screaming Architecture

Organize by use case, not technical type. The top-level `src/` tree must describe an agent-native, zero-upload data lab:

```text
src/
├── studio-shell/
├── revisioned-workspace/
├── dataset-custody/
├── duck-engine/
├── analysis-artifacts/
├── live-canvas/
├── agent-control-plane/
└── demo-presets/
```

Folder meaning:

- `revisioned-workspace/` owns the domain-command interface, revision, idempotency, single-flight operations, events, atomic commit, and the projection functions. Human, chip, simulator, and WebMCP adapters dispatch into it.
- `dataset-custody/` is the custody kernel behind that interface: policy, SQL inspection, release, cohort confirmation, and upload/release evidence. Do not add `egress-audit/`.
- `duck-engine/` is the worker, bindings, budgets, and cancellation. It executes custody decisions verbatim; it never re-derives them.
- `analysis-artifacts/` is the immutable graph and lineage.
- `live-canvas/` renders artifact-scope projections: the four evidence views. Tab clicks are not workspace commands.
- `agent-control-plane/` is thin adapters, the envelope module (transport vocabulary, re-exporting domain schemas), and WebMCP registration. It does not own the workspace or any domain schema.
- `studio-shell/` composes the two-pane chrome; its `boot.ts` owns ordered startup behind one `start()` interface.
- `demo-presets/` is the two seeded datasets. A preset's interface is the seed→relation triple: deterministic row generator, dataset metadata carrying its release policy, and canonical SQL. Policy travels with its dataset, and a contract test runs the SQL and asserts the pinned `prd.md` §6 values, so the demo numbers are load-bearing.

`selectArtifact` and `cancelActiveOperation` live on the workspace interface. They are not registered WebMCP tools.

Do not create top-level technical buckets such as:

```text
components/
hooks/
utils/
services/
types/
stores/
```

Colocate each feature’s UI, domain commands, projections, schemas, and tests. A tiny shared kernel is allowed only for primitives genuinely used across features; it must not become a miscellaneous bucket.

Schema ownership follows the same rule. Each module owns its schemas (`revisioned-workspace/schemas.ts`, `dataset-custody/schemas.ts`, `analysis-artifacts/schemas.ts`); `agent-control-plane/envelope.ts` holds only transport vocabulary (`schemaVersion`, envelope shape) and re-exports the domain schemas for adapters and tests. A schema change lands in the folder that owns the concept, deleting `agent-control-plane/` removes no domain type, and the schemas contract test is import equality.

The custody → engine seam is one object. `dataset-custody/` returns a single authorized-execution decision — authorized relation, prepared positional SQL, clamped budget, redaction keys — and `duck-engine/` consumes it verbatim, owning only cancellation and respawn-on-cancel (ADR 0002). The engine never re-derives relation, SQL, budget, or redaction; each custody rule is written and tested once, and engine tests run against fake decision objects with no worker.

## One Command Path

Human controls, prompt chips, Agent Simulator, and WebMCP adapters must dispatch the same domain commands through the revisioned workspace.

- Do not put business logic only in React event handlers or WebMCP callbacks.
- Do not let adapters call private UI setters.
- `dispatch` is honest about time: validation, staleness, and idempotency conflicts reject synchronously with no worker round trip, and the commit envelope arrives through one awaited path every adapter shares. No adapter polls revisions or sleeps to wait for the worker; parity is assertable at that single seam.
- Do not manufacture transcript cards, artifacts, timings, revisions, or audit evidence for the demo.
- Equivalent commands through different adapters must produce equivalent events, artifacts, errors, and projections.
- WebMCP registers exactly the four canonical tools. `selectArtifact` and `cancelActiveOperation` remain workspace commands for human and simulator adapters.
- One projection owner, two named functions: `projectWorkspace(ws)` for workspace scope (left-pane cards, simulator cards, header badge) and `projectArtifact(ws, id)` for artifact scope (Insights KPIs, the four views). The envelope `summary` sources `projectWorkspace` while no artifact can exist — at rev 0 it is the five workspace-scope bootstrap fields (ticket 06); artifact-bearing summaries move to `projectArtifact` when artifacts arrive (Slice 3). The referential-equality contract test covers all four call sites, so DOM evidence and tool payloads cannot drift.

## Explicit State Only

- The workspace has a stable ID and monotonic revision.
- Every mutation requires `expectedRevision` and `idempotencyKey`.
- There is no ambient `lastResult`, `lastSql`, or hidden active relation.
- Views and follow-up analysis reference immutable artifact IDs.
- An artifact owns its source, SQL, redacted bindings, SQL hash, schema, lineage, policy release, presentation (KPI/chart/grid, not the view tab), and measured metrics.
- Canvas tab clicks are not workspace mutations. Artifact selection is `selectArtifact`.
- State transitions commit atomically. Failure or cancellation must not leave partial artifacts or canvas state.

## Agent-Ergonomic Contracts

- Register exactly the four canonical tools from `docs/agent-system-design.md`; add no aliases or compatibility wrappers.
- JSON Schema is discoverability, not the trust boundary. Encode each domain schema once, in the module that owns it; adapters and tests import it through the envelope re-export. Do not hand-duplicate them.
- Every tool returns the shared discriminated envelope.
- Use stable IDs, enums, revisions, and error codes instead of prose when a machine-readable value exists.
- Bound context and response sizes.
- Errors must include safe field details and executable recovery actions when recovery exists.
- Context reads support revision deltas so agents do not repeatedly ingest the whole workspace.
- Every successful analysis must leave a reusable artifact.

## Registration and Lifecycle

- Gate native registration on `document.modelContext`.
- Register tools with full JSON Schema and `readOnlyHint` where applicable.
- Use an `AbortController` to clean up registrations on lifecycle teardown.
- Duplicate registration is a defect; do not catch it and silently continue.
- The simulator remains available when native WebMCP is absent, but it uses the same domain commands rather than a mock registry.
- Boot is a module, not a pile. `studio-shell/boot.ts` exposes one `start()`: secure-context gate → warm worker → create store → mount router → register tools → simulator fallback, each step a pure decision function. `main.tsx` shrinks to the sole importer that calls `start()`, so boot order is testable headlessly.

## No Backward Compatibility

Do not preserve obsolete paths, names, schemas, or state models. Remove them. Do not add aliases, migration layers, fallbacks, or mitigations for unreleased contracts.
