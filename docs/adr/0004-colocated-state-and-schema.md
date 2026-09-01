# ADR 0004 — Colocated state, `zod@4.5` schemas with AOT compile, single trust seam

- Status: Accepted
- Date: 2026-08-31
- Deciders: @senior-frontend-architect
- Technical Area: Schema, Validation
- Amendment 3: 2026-08-31 (template conformance: Deciders, Technical Area, reformat Alternatives, split Consequences into Positive/Negative/Neutral, add Implementation, References, Decision Log)
- Amendment 4: 2026-09-01 (schema placement: domain schemas colocate with their owning modules, envelope.ts is transport vocabulary plus re-exports; store contract: dispatch is honest about time)
- Amendment 2: 2026-08-31 (upgrade to `zod@4.5.4`, adopt `z.compile()` AOT fast path, drop `zod-to-json-schema` post-processing in favor of `z.strictObject`)
- Amendment 1: 2026-08-31 (JSON Schema strictness, store API contract, no-shared-kernel rule)

## Context

`docs/agent-system-design.md` requires that all four WebMCP tools validate input against the same schema module, return one discriminated envelope, and use one shared projection. The custody kernel, the workspace, and the adapters must agree on every type. Hand-duplicated JSON Schema across adapter files is a defect.

`zod@4.5` (released 2 days before this ADR; `4.5.4` on npm) ships two things that change the calculus:

1. **`z.compile(schema)`** — returns an AOT-compiled clone that takes a fast path on valid input and falls back to the standard parser on invalid input. The published benchmark is a 2.4× median speedup across 55 schemas, scaling to ~9× for a 20-key object. For DuckStudio's hot path (every WebMCP tool call parses input, every projection re-parses) this is meaningful.
2. **`z.strictObject({...})`** — a first-class primitive for objects that reject extra keys. This is exactly what every `docs/agent-system-design.md` §8 schema declares with `additionalProperties: false`. We no longer need a `zod-to-json-schema` post-processing step to add strictness after the fact.

## Alternatives Considered (amended 3)

### Option 1: `zod@4.5` with `z.compile()` and `z.strictObject()`

**Description**: Single source of truth, AOT-compiled hot path, native strict object shape, native JSON Schema conversion (`z.toJSONSchema()`), ergonomic inference.
**Pros**: AOT fast path on the hot parse, native `additionalProperties: false` via `z.strictObject`, no `zod-to-json-schema` dependency, ergonomic inference, mature ecosystem, runs in every browser.
**Cons**: Bundle size > 30 KB gzipped triggers a migration review (see Option 5). `z.compile()` uses `new Function` which a future CSP-strict environment could block — per-schema compile keeps the choice reviewable.
**Why rejected**: N/A — selected.

### Option 2: `zod@4.5` without `z.compile()`

**Description**: Same correctness, slower on the hot path. No AOT compile.
**Pros**: CSP-safe by default, no `new Function` cost at schema construction.
**Cons**: The 2.4× median speedup on the hot parse is the whole reason we picked `zod@4.5` over the v3 line.
**Why rejected**: We have the fast path; we use it. Per-schema compile (not global mode) keeps the choice reviewable.

### Option 3: Hand-written TypeScript types + hand-written JSON Schema

**Description**: Define types in `.ts`, hand-author the matching JSON Schema in a sibling file, keep them in sync by convention.
**Pros**: Zero schema library dependency. Smallest possible bundle.
**Cons**: Two sources of truth that drift. Every schema change requires editing two files in lockstep. Drift is the regression class that hand-duplication produces.
**Why rejected**: `ARCHITECTURE.md` and `docs/agent-system-design.md` require runtime validation at the trust seam. Drift between types and schemas is a defect by construction.

### Option 4: No runtime validation, types only

**Description**: TypeScript types only. No runtime parse.
**Pros**: No bundle cost, no parse cost.
**Cons**: Violates `ARCHITECTURE.md` ("JSON Schema is discoverability, not the trust boundary"). The trust seam is the parse error, not the type. WebMCP, the URL, and the envelope cannot share a parse without a runtime schema.
**Why rejected**: Mandated by `ARCHITECTURE.md`. Not a real option.

### Option 5: `valibot` or `@standard-schema` adapter

**Description**: Smaller-bundle schema library; `@standard-schema` is the cross-library interface.
**Pros**: Smaller bundle (valibot), library-agnostic schema authoring (standard-schema).
**Cons**: Less mature ecosystem, fewer inference helpers, smaller community. `@standard-schema` adds an abstraction layer for marginal benefit.
**Why rejected**: The PRD does not require vendor neutrality, so the extra abstraction is not justified for the one-day build. Trigger to revisit: schema module bundle size > 30 KB gzipped, measured by `pnpm build`.

## Decision

Encode every domain shape once in `zod@4.5.4`. Use `z.strictObject(...)` for every object schema so `additionalProperties: false` is part of the schema, not a post-processing step. Use `z.compile(...)` per schema to take the AOT fast path. Adapters and tests import the schemas and call `.parse(input)`. JSON Schema for WebMCP is derived through `z.toJSONSchema()` (the v4 built-in; replaces the third-party `zod-to-json-schema`).

State is colocated. Each feature owns its store. The revisioned workspace is the source of truth. UI reads through a thin `useSyncExternalStore` selector over the workspace event log. No Redux, no Zustand-by-default, no global "last result."

### Schema placement (amended 4)

Each domain shape is encoded in the module that owns it: `revisioned-workspace/schemas.ts` (the four tool input schemas, the projection input schema, the URL search-param schema), `dataset-custody/schemas.ts` (release decision, cohort confirmation), `analysis-artifacts/schemas.ts` (artifact and lineage shapes). `agent-control-plane/envelope.ts` holds only transport vocabulary — `schemaVersion` and the success/failure envelope shapes — and re-exports the domain schemas for adapters and tests.

The original placement put every schema in `envelope.ts`. That made the adapter folder a de-facto shared kernel with the widest fan-in in the tree, violating the no-shared-kernel rule this ADR already carries: deleting `agent-control-plane/` would have deleted the domain's types. A contract test in `agent-control-plane/_contract/` asserts the re-exports are import-equal to the domain exports.

### Compile strategy (amended)

We use **per-schema compile**, not global mode.

```ts
// agent-control-plane/envelope.ts
import * as z from "zod";
import "zod/v4"; // explicit version pin, surfaces v4-only APIs

export const EnvelopeSuccessSchema = z.strictObject({
  ok: z.literal(true),
  schemaVersion: z.literal("duckstudio.webmcp/v1"),
  workspaceId: z.string().min(1).max(80),
  revision: z.number().int().nonnegative(),
  data: z.unknown(),
  contextDelta: z.record(z.string(), z.unknown()).optional(),
  warnings: z.array(WarningSchema),
  nextActions: z.array(NextActionSchema).max(3),
});
export const CompiledEnvelopeSuccess = z.compile(EnvelopeSuccessSchema);
```

Per-schema compile, not global mode, because:

- The fast path uses `new Function`. Global mode auto-disables under `z.config({ jitless: true })`, which a future CSP-strict environment will require. Per-schema compile makes the choice explicit and reviewable.
- Schemas with async refinements or transforms cannot be compiled; `z.compile()` returns the schema unchanged for those. We want the "is this compiled?" check to be a single grep, not a global side effect.
- Re-deriving a schema (`.refine()`, `.extend()`) returns an uncompiled schema. Per-schema compile localizes the "remember to compile the final shape" reminder.

The pattern: define → compile at module top-level → export the compiled form as the default import. Adapters import the compiled form.

### JSON Schema derivation (amended)

We use `z.toJSONSchema(schema)` from `zod@4.5`, not the third-party `zod-to-json-schema`. The v4 built-in honors `z.strictObject` natively and emits `additionalProperties: false` on the derived JSON Schema. **No post-processing step.** The Vitest contract test (`agent-control-plane/contract/json-schema-strictness.test.ts`) still diffs the derived JSON Schema against the canonical snippets in `docs/agent-system-design.md` §8 — a diff fails the test.

The JSON Schema emitted by `z.toJSONSchema()` is the **human copy** of the trust seam. The runtime `.parse()` is the real boundary. The two are now generated from the same source tree.

### Compile-only-the-hot-path rule (amended)

`z.compile()` is a 2.4× median speedup. It is not free. We compile:

- The four tool input schemas (`getContext`, `activateDataset`, `runAnalysis`, `verifyCustody`).
- The success and failure envelope schemas.
- The projection input schema in `revisioned-workspace/projection.ts`.
- The custody release-decision schema in `dataset-custody/schemas.ts`.

We do **not** compile:

- One-shot schemas inside test files.
- Internal refinement schemas that are never parsed at runtime (type-only imports).
- Schemas with async refinements or transforms (compile returns them unchanged, so the cost is zero but the visual signal "this is hot" is lost).

### Store API contract (amended 4)

The revisioned workspace is a React-compatible external store:

```ts
type WorkspaceStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Workspace;
  getServerSnapshot(): Workspace; // frozen empty workspace; SSR is N/A but the API requires it
  dispatch(command: DomainCommand): Promise<Envelope>; // honest about time; the worker is async
};
```

`useSyncExternalStore` reads through `subscribe` and `getSnapshot`. Adapters call `dispatch` and await the commit envelope. `dispatch` is honest about time: schema validation, stale `expectedRevision`, and `idempotencyKey` conflicts reject immediately with no worker round trip; the commit envelope arrives through one awaited path every adapter shares. No adapter polls revisions or sleeps to wait for the worker — adapter parity (`webmcp-vs-simulator-parity.test.ts`) is a property of this seam, not of the adapters. The store is the only place that increments `revision`. Tests drive the store directly; they do not mount React.

### No-shared-kernel rule (carried from Amendment 1)

No `src/shared/` folder. Primitives colocate with the feature that owns them. Three-or-more importers triggers promotion to a `kernel/` subfolder inside the most-relevant feature, not a top-level bucket.

### Future migration (carried from Amendment 1)

Trigger to migrate off `zod`: schema module bundle size > 30 KB gzipped, measured by `pnpm build`. Until then, `zod@4.5` stays.

## Consequences (amended 3)

### Positive (amended 4)

- Domain schemas live where the concept lives: a schema change is a one-folder change, and deleting `agent-control-plane/` removes no domain type.
- One trust seam: a `zod` parse error is the same error in WebMCP, the simulator, the URL, and the human UI.
- `expectedRevision` and `idempotencyKey` are required by the schema, not by convention. Stale and conflicting requests fail at the boundary, not in the worker.
- A new schema-version migration is a `zod` schema bump plus a `schemaVersion` field on the envelope.
- The derived JSON Schema is `additionalProperties: false` by construction, not by post-processing. The contract test in `agent-control-plane/_contract/json-schema-strictness.test.ts` prevents drift.
- The hot path (every tool call, every projection) is 2.4× faster on average, up to 9× for the 20-key envelope.
- There is no `src/shared/` junk drawer.
- We do not depend on `zod-to-json-schema`. One fewer dependency.

### Negative (amended 4)

- Adapters and the router reach domain schemas through the envelope re-export — one indirection, bought in exchange for the deletion test passing.
- The cost of `z.compile()` is `new Function` at schema construction time, which is acceptable on a COEP origin where we already load WASM but could trip a future CSP-strict environment.
- The schema module's gzipped bundle is the trigger to revisit `valibot` or `@standard-schema` (carried from Amendment 1).
- `zod` v4 issue format is the new `z.core.$ZodIssue*` shape. Anything that consumed the v3 `.format()` output must migrate to `z.treeifyError()`.

### Neutral

- Per-schema compile (not global mode) is a deliberate choice to keep the "is this compiled?" check reviewable per file.

## Implementation (amended 4)

- Domain schemas live with their owners per the Schema placement rule: `revisioned-workspace/schemas.ts`, `dataset-custody/schemas.ts`, `analysis-artifacts/schemas.ts`. All schemas use `z.strictObject(...)` and are exported in their compiled form (`CompiledEnvelopeSuccess = z.compile(EnvelopeSuccessSchema)`).
- `agent-control-plane/envelope.ts` exports the success/failure envelope schemas (transport vocabulary) and re-exports the domain schemas for adapters and tests. It exports no schema that names a domain concept.
- `agent-control-plane/registration.ts` derives JSON Schema via `z.toJSONSchema(schema)` and passes it to `document.modelContext.registerTool`. The runtime `.parse()` remains the real trust boundary.
- The revisioned workspace store lives in `revisioned-workspace/`. It is a React-compatible external store (`subscribe`, `getSnapshot`, `getServerSnapshot`, `dispatch`). It is the only place that increments `revision`.
- The no-shared-kernel rule is enforced by review: a feature's UI, store, schemas, and tests colocate under `src/<feature>/`. Three-or-more importers triggers promotion to `src/<feature>/kernel/`, not a top-level `src/shared/`.
- The contract test `agent-control-plane/_contract/json-schema-strictness.test.ts` diffs the derived JSON Schema against the canonical snippets in `docs/agent-system-design.md` §8 — a diff fails the test.
- The Vitest contract test for the canvas projection selector dependency arrays lives in `live-canvas/_contract/` (per ADR 0003).

## References (amended 3)

- ADR 0001 — App framework: Vite + React + TanStack Router (`@tanstack/zod-adapter` consumes the same `zod` schemas)
- ADR 0003 — Lint and format with oxlint + oxfmt (`lint-strict` covers the trust seam files)
- ADR 0005 — `src/` follows the screaming architecture in `ARCHITECTURE.md` (no-shared-kernel rule)
- ADR 0006 — Tooling versions and Cloudflare Pages deployment (zod version pin)
- zod docs: https://zod.dev/
- zod 4.5 migration notes: https://zod.dev/v4/changelog
- `docs/agent-system-design.md` §8 — schema strictness canonical snippets

---

## Decision Log

| Date       | Change   | By                       |
| ---------- | -------- | ------------------------ |
| 2026-08-31 | Proposed | @senior-frontend-architect |
| 2026-08-31 | Amendment 1: JSON Schema strictness, store API contract, no-shared-kernel rule | @senior-frontend-architect |
| 2026-08-31 | Amendment 2: upgrade to zod 4.5.4, adopt z.compile() AOT fast path, drop zod-to-json-schema | @senior-frontend-architect |
| 2026-08-31 | Amendment 3: template conformance | @senior-frontend-architect |
| 2026-08-31 | Accepted | @senior-frontend-architect |
| 2026-09-01 | Amendment 4: schema placement (colocate with owners, envelope re-exports), store contract (dispatch honest about time) | @senior-frontend-architect |
