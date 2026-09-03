# Plan 004: Settle every analysis with an envelope — guard the post-release commit section

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat ff604ab..HEAD -- src/revisioned-workspace/store.ts src/revisioned-workspace/presentation.ts src/revisioned-workspace/store.test.ts src/revisioned-workspace/_contract/mutation-contracts.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (the catch converts existing throws into the existing failure path; nothing new is committed)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ff604ab`, 2026-09-03
- **Issue**: (pending publication)

## Why this matters

The WebMCP tool contract (`src/agent-control-plane/registration.ts:75-87`) promises that `duckdb_execute_sql_to_canvas` "never throws" — every failure arrives as an `EnvelopeFailure`. In `runAnalysis`, the engine awaits are guarded with try/catch, but the commit section that follows — `store.ts`'s "POINT OF NO RETURN" block — has no guard. A throw there escapes `dispatch` as a rejection: the calling agent gets an exception instead of an envelope, no failure event fires, the operation stays `running` (`markRunning` at `store.ts:722` ran; `releaseSlot` at `store.ts:857` never does), so every later mutation rejects with `OPERATION_CONFLICT` until someone clicks Cancel — and the already-materialized artifact relation leaks in the engine.

Both trigger classes are verified, not hypothetical:

1. **Non-finite KPI values.** `measureSummary` keeps any cell whose `typeof` is `"number"` — including `Infinity`/`NaN` (`presentation.ts:251`). The artifact record's zod schema rejects both (`value: z.number()`; verified against this repo's zod 4: `safeParse({v: Infinity}).success === false`). So `SELECT 1e308 * 10 AS x` on a **public** dataset passes custody, materializes, and then throws inside `graph.append`'s parse.
2. **Over-long KPI labels.** Inferred KPI labels are the column name verbatim (`presentation.ts:71-75`), column names may be 80 chars (`ResultColumnSchema`), and the summary schema caps labels at 60 (`ArtifactSummarySchema.kpis.label` `max(60)`, `analysis-artifacts/schemas.ts:131`). A quoted alias of 61–80 chars throws the same way.

## Current state

Relevant files:

- `src/revisioned-workspace/store.ts` — the workspace store; `runAnalysis` spans ~lines 676–924. The unguarded commit block is lines 805–895.
- `src/revisioned-workspace/presentation.ts` — presentation inference + `measureSummary`.
- `src/analysis-artifacts/schemas.ts` — the zod schemas that throw (do not modify; listed for context).
- `src/revisioned-workspace/store.test.ts` and `src/revisioned-workspace/_contract/mutation-contracts.test.ts` (+ its `harness.ts` fake-engine seam) — where the new tests go.

The unguarded block (note: every earlier failure path — engine execute at 739–745, materialize at 749–756, release denial at 777–780, presentation denial at 790–794 — routes through `settleFailure` and returns an envelope; only this section can throw out):

```ts
// store.ts:805-857 (abridged to the load-bearing lines)
// ---- POINT OF NO RETURN: one synchronous in-memory commit, zero awaits ----
const before = projectWorkspace(workspace);
const record = graph.append({                      // <-- zod-parses; throws on non-finite/over-long
  source: input.source, ... schema: classifiedSchema, ... summary,
});
const revision = workspace.revision + 1;
...
pageMemory.captureRows(artifactId, captureRows(result, ...));
pageMemory.captureEvidence(artifactId, {...});
replaceWorkspace({ ...workspace, revision, selectedArtifactId: artifactId, ... });
appendEvents([...]);
releaseSlot();                                     // <-- single-flight slot freed here only
```

The two throw triggers upstream:

```ts
// presentation.ts:249-252 (measureSummary)
kpis: (spec.kpis ?? []).map((kpi) => {
  const value = firstRow.get(kpi.column);
  return { ...kpi, value: typeof value === "number" ? value : null };   // keeps Infinity/NaN
}),

// presentation.ts:71-75 (inferPresentation)
spec.kpis = numeric.slice(0, 6).map((column) => ({
  label: column.name,             // verbatim; schema caps labels at 60, names may be 80
  column: column.name,
  ...
}));
```

The schema bounds that reject (context only — do not modify `analysis-artifacts/`):

```ts
// analysis-artifacts/schemas.ts:128-135
export const ArtifactSummarySchema = z.strictObject({
  kpis: z.array(z.strictObject({
    label: z.string().min(1).max(60),
    column: z.string().min(1).max(80),
    ...
    value: z.number().nullable(),   // rejects NaN and Infinity in zod 4
  })),
```

Conventions to honor:

- Failure routing: `settleFailure(operationId, input.idempotencyKey, fingerprint, failure)` (defined at `store.ts:926-937`) marks the operation failed and caches deterministic codes. `INTERNAL_ERROR` is intentionally **not** in `DETERMINISTIC_CODES` (`store.ts:154-161`), so a commit-phase `INTERNAL_ERROR` is not cached and a retry re-executes — correct semantics for this plan; do not add it to the set.
- The store already has an `internalFailure()` helper used at `store.ts:743` and `:754` (`asEngineFailure(raw) ?? internalFailure()`). Reuse it if its message reads generically; otherwise construct `{ code: "INTERNAL_ERROR", retryable: true, details: { phase: "commit" } }` inline with a message mirroring the worker's wording (`duckdb.worker.ts:216`: "The engine worker failed to execute the authorized statement; read context and retry." — adapt, don't copy blindly).
- SECURITY.md: raw values never enter logs. Do not log the caught error with its message if it may quote result values; the failure envelope is the disclosure surface.

## Commands you will need

All commands assume Node 26. If `node --version` is not v26, first run:

```sh
export PATH="$HOME/.nvm/versions/node/v26.8.1/bin:$PATH"   # or: nvm use
```

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Install   | `pnpm install`                       | exit 0              |
| Typecheck | `pnpm typecheck`                     | exit 0              |
| Lint      | `pnpm lint` / `pnpm lint:strict`     | exit 0 (store.ts is a trust-seam file) |
| Tests     | `pnpm test -- store` / `pnpm test -- mutation-contracts` / `pnpm test -- presentation` | all pass, including new tests |
| Full floor| `pnpm test`                          | all pass            |

## Scope

**In scope** (the only files you should modify):

- `src/revisioned-workspace/store.ts` — the commit block of `runAnalysis` only
- `src/revisioned-workspace/presentation.ts` — `measureSummary` and `inferPresentation` only
- `src/revisioned-workspace/store.test.ts` and/or `src/revisioned-workspace/_contract/mutation-contracts.test.ts` — new cases

**Out of scope** (do NOT touch, even though they look related):

- `src/analysis-artifacts/schemas.ts` — do not loosen the zod bounds; they are the integrity net, and this plan must not weaken them.
- The other commands' commit sections (`runActivate`, `runImport`, `runSelectArtifact`, `runCancel`) — none of them construct KPI values; widening the guard there is a separate refactor (audit finding DEBT-03).
- `graph.ts`, `envelope.ts`, the engine, UI error surfaces (the missing `catch` around the workbench's `run()` is audit finding CORRECT-13 — a separate, follow-on fix).
- `DETERMINISTIC_CODES` membership.

## Git workflow

- Branch: `fix/guard-analysis-commit` off the branch you were dispatched from.
- Commit style: `fix(workspace): settle analysis commits with an envelope, never a throw` (+ `test(workspace): …`).
- Do NOT push or open a PR unless the operator instructed it. Never target `main` directly.

## Steps

### Step 1: Coerce non-finite KPI values at the measurement boundary

In `presentation.ts` `measureSummary`, change the value guard to:

```ts
return { ...kpi, value: typeof value === "number" && Number.isFinite(value) ? value : null };
```

(`z.number().nullable()` accepts `null` — a non-finite measurement becomes an honest null KPI, matching the schema instead of fighting it.)

**Verify**: `pnpm test -- presentation` → all pass.

### Step 2: Cap inferred KPI labels to the schema bound

In `presentation.ts` `inferPresentation`, change the label line to `label: column.name.slice(0, 60)` and add a brief comment noting the bound comes from `ArtifactSummarySchema` (60) while column names may reach 80.

**Verify**: `pnpm test -- presentation` → all pass (the presentation tests pin inference shapes; a label-truncation case lands in Step 4).

### Step 3: Wrap the commit block so any residual throw settles as an envelope

In `store.ts` `runAnalysis`, wrap the synchronous commit — from `const before = projectWorkspace(workspace);` through `releaseSlot();` (lines 805–857) — in `try { ... } catch { ... }`:

1. First line inside the `try`: `const preCommit = workspace;` — the module's raw state binding before any mutation. (The block is synchronous with zero awaits, so this is a faithful restore point; `before`, the *projection*, is NOT the raw state and must not be passed to `replaceWorkspace`.)
2. In the `catch`:
   - `replaceWorkspace(preCommit);` — undo any partial in-memory mutation (atomicity restored).
   - `await engine.dropRelation(identity.relationName).catch(() => undefined);` — drop the materialized relation, mirroring the release-denial cleanup at `store.ts:778`.
   - `return settleFailure(operationId, input.idempotencyKey, fingerprint, /* INTERNAL_ERROR failure — see conventions above */);`
3. Leave everything after `releaseSlot()` (warnings assembly, envelope construction, `cacheSet`, retention) outside the try — the commit has landed by then; a failure there must not retroactively fail a succeeded operation.
4. Do not log the raw caught error (it may quote result values — SECURITY.md); the envelope is the disclosure. If the file's convention includes a redacted diagnostic, follow it; otherwise none.

**Verify**: `pnpm typecheck` → exit 0; `pnpm test -- mutation-contracts` → existing contract cases all pass (the guard must not change any existing outcome).

### Step 4: Regression tests

In `src/revisioned-workspace/_contract/mutation-contracts.test.ts` (the harness's fake engine and store factory are already set up there; model after the existing failure-path cases, e.g. the `ARTIFACT_UNAVAILABLE` cases around lines 384–392, and use the **node** engine path if the harness supports it, since the trigger needs real numeric decoding):

1. **Non-finite commit**: dispatch a run analysis over the public preset with SQL shaped like `SELECT 1e308 * 10 AS x` → the returned promise **resolves** with `ok: false` and `error.code === "INTERNAL_ERROR"`; assert `error.details.phase === "commit"` if you constructed the failure inline (skip if reusing `internalFailure()`); assert the operation is terminal (not `running`); assert a subsequent activate/analysis dispatch does **not** return `OPERATION_CONFLICT`; assert `dropRelation` was invoked (the harness's engine fake records calls).
2. **State restored**: after case 1, the workspace revision is unchanged from before the failed dispatch, and `recentArtifactIds` does not contain the new artifact id (the `replaceWorkspace(preCommit)` undo).
3. **Label overflow commits cleanly**: run analysis with a quoted alias of 65 characters (e.g. `SELECT 1 AS "<65-char name>"`) → resolves `ok: true`; the committed summary KPI label length is ≤ 60.
4. **Finite values unaffected**: the existing canonical churn analysis case stays `ok: true` with unchanged KPI values.

**Verify**: `pnpm test -- mutation-contracts` and `pnpm test -- store` → all pass including new cases.

### Step 5: Full floor

**Verify**: `pnpm lint` → exit 0; `pnpm lint:strict` → exit 0; `pnpm test` → all pass.

## Test plan

Covered in Step 4. Structural pattern: the fake-engine contract cases in `src/revisioned-workspace/_contract/mutation-contracts.test.ts` (harness: `src/revisioned-workspace/_contract/harness.ts`). Do not introduce a new harness.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm lint:strict` exit 0
- [ ] `pnpm test` exits 0; the Step 4 cases exist and pass
- [ ] `grep -n "Number.isFinite" src/revisioned-workspace/presentation.ts` → the `measureSummary` guard exists
- [ ] `grep -n "slice(0, 60)" src/revisioned-workspace/presentation.ts` → the label cap exists
- [ ] The `runAnalysis` commit block is enclosed in try/catch whose catch calls `replaceWorkspace`, `dropRelation`, and `settleFailure` (`git diff` shows it)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts no longer match the live code (drift) — in particular if the commit block has already gained a guard.
- `workspace` in the store closure is not a restorable state binding (i.e. `replaceWorkspace(preCommit)` would not restore the pre-commit state — check how `replaceWorkspace` is defined before relying on it).
- The catch's `settleFailure` double-settles (e.g. `failOperation` throws on an operation already marked) — read `failOperation` first; if it cannot tolerate the call, stop and report rather than adding a second guard layer.
- Making the tests pass requires touching the schemas, the graph, or the engine.

## Maintenance notes

- Any future field added to `AnalysisArtifactSchema`/`ArtifactSummarySchema` with a tight zod bound is a new potential throw trigger inside the commit; the catch now converts it into a recoverable envelope, but prefer validating at inference/measurement time (as Steps 1–2 do).
- Reviewer focus: confirm the try/catch covers only the synchronous commit (not the envelope assembly after `releaseSlot()`), and that `preCommit` is captured from the raw binding, not the projection.
- Follow-up (separate finding CORRECT-13): the human-side callers (`use-workbench.run()`, `runCanonicalChurnAnalysis` call sites) discard rejected promises with `void`; once this plan lands, dispatch should no longer reject in practice, but belt-and-suspenders `catch`es at those call sites are a cheap follow-up.
