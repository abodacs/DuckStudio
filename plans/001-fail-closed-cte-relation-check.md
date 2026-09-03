# Plan 001: Fail closed when a `WITH` header does not parse — the relation allowlist must never be skipped

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat ff604ab..HEAD -- src/dataset-custody/sql-inspector.ts src/dataset-custody/sql-inspector.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (stricter parsing could over-reject; the pinned contract tests catch that)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `ff604ab`, 2026-09-03
- **Issue**: (pending publication)

## Why this matters

`src/dataset-custody/sql-inspector.ts` is the trust seam between the workspace and the DuckDB worker: exactly one read-only `SELECT`/`WITH` statement survives it, and step 4 of its pinned enforcement order guarantees every referenced relation is in the authorized set. But `checkRelations` bails out with `return null` — which means "no violation found" — at two points when a `WITH` header has a shape the hand-rolled CTE parser does not recognize. DuckDB accepts legal statement shapes that hit both bail-outs, for example `WITH t AS MATERIALIZED (SELECT …) SELECT …`. When that happens the function exits before its depth-aware FROM/JOIN scan ever runs, so a statement authorized against one relation can read **any** relation in the engine (the other preset, an imported dataset, an artifact relation). Because the release gate evaluates policy from the declared source (`kernel.ts` uses `source.policy`), a `sensitive_aggregate_only` dataset's rows can commit and render under an activated public dataset's policy. That is a custody-policy bypass of the product's core guarantee (`docs/agent-system-design.md` §6: reject "references outside the authorized source relation set").

## Current state

Relevant files:

- `src/dataset-custody/sql-inspector.ts` — the SQL trust seam. `checkRelations` (lines 208–329) is the depth-aware relation scan called from `inspectSql` step 4 (line 382).
- `src/dataset-custody/sql-inspector.test.ts` — the pinned allow/deny tables for the inspector.

The CTE loop at the top of `checkRelations` (lines 214–252). Both marked bail-outs return `null` (= no violation) out of the **entire** function, skipping the FROM/JOIN scan at lines 320–328:

```ts
// sql-inspector.ts:218-235
while (i < tokens.length) {
  const name = nameToken(tokens, i);
  if (!name) return null;                    // <-- bail-out 1 (line 220)
  defined.add(name.value);
  let j = i + 1;
  if (tokens[j]?.text === "(") {
    // Optional explicit column list: `WITH t(a, b) AS (...)`.
    ...
  }
  if (tokens[j]?.text.toUpperCase() !== "AS" || tokens[j + 1]?.text !== "(") return null;  // <-- bail-out 2 (line 235)
  ...
}
```

The scan that gets skipped when a bail-out fires (lines 320–328):

```ts
// sql-inspector.ts:320-328
for (let k = 0; k < tokens.length; k += 1) {
  const word = tokens[k];
  if (!word || word.kind !== "word") continue;
  const upper = word.text.toUpperCase();
  if (upper !== "FROM" && upper !== "JOIN") continue;
  const failure = checkFromItems(tokens, k);
  if (failure) return failure;
}
return null;
```

Failure-shape convention — denials in this module carry a stable code, a prose message, and machine-readable details. `UNSAFE_SQL` failures are built by `unsafe()` (lines 84–94) with a `blockedConstruct` detail:

```ts
// sql-inspector.ts:84-94
function unsafe(blockedConstruct: string, details: ... = {}): InspectResult {
  return {
    ok: false,
    failure: {
      code: "UNSAFE_SQL",
      message: `The statement uses the blocked construct "${blockedConstruct}" (SQL execution policy §6).`,
      retryable: false,
      details: { blockedConstruct, ...details },
    },
  };
}
```

`checkRelations` returns `CustodyFailure | null` (not `InspectResult`), so it builds its own failure objects — see `datasetUnavailableFailure` (lines 108–115) for the shape.

Documented constraints the plan must honor:

- The module docstring (lines 3–14) pins the enforcement order: "statement count → head keyword → forbidden constructs → relation references → binding interpolation" (grilling 22) and says it "must not be reordered". This plan changes only the *outcome* of an unparseable header inside step 4 — the order is untouched.
- `docs/agent-system-design.md` §6 is the canonical deny contract; this fix makes step 4 honor it unconditionally.

## Commands you will need

All commands assume Node 26 (the repo's `engines` requirement). If `node --version` is not v26, first run:

```sh
export PATH="$HOME/.nvm/versions/node/v26.8.1/bin:$PATH"   # or: nvm use
```

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Install   | `pnpm install`                       | exit 0              |
| Typecheck | `pnpm typecheck`                     | exit 0, no errors   |
| Lint      | `pnpm lint`                          | exit 0 (warnings deny) |
| Lint seam | `pnpm lint:strict`                   | exit 0 (this file is one of the nine trust-seam files) |
| Tests     | `pnpm test -- sql-inspector`         | all pass, including new tests |
| Full unit floor | `pnpm test`                    | all pass (325+ tests) |

## Scope

**In scope** (the only files you should modify):

- `src/dataset-custody/sql-inspector.ts` — only inside `checkRelations` (lines 208–252 region)
- `src/dataset-custody/sql-inspector.test.ts` — new test cases

**Out of scope** (do NOT touch, even though they look related):

- `lexSql` / the token lexer — it is correct; the bug is in the CTE loop's failure handling.
- The order of steps 1–5 in `inspectSql` — pinned by grilling 22.
- `src/dataset-custody/kernel.ts`, `store.ts`, the engine — the inspector is the one place this rule lives.
- Any new error code — reuse `UNSAFE_SQL`.

## Git workflow

- Branch: `fix/inspector-fail-closed-cte` off the branch you were dispatched from.
- Commit message style (match the repo): `fix(custody): fail closed on unparseable WITH headers in the relation scan` — one commit for the fix, one for the tests is fine.
- Do NOT push or open a PR unless the operator instructed it. Never target `main` directly (AGENTS.md).

## Steps

### Step 1: Make the CTE loop fail closed and accept the legal `MATERIALIZED` spellings

In `checkRelations`'s CTE loop:

1. **Bail-out 1 (line 220)** — `if (!name) return null;`: a `WITH` followed by something that is not a name token is a shape this parser cannot vouch for. Replace `return null` with returning an `UNSAFE_SQL` failure (build it inline, matching the `unsafe()` message convention):

   ```ts
   const cteHeaderFailure: CustodyFailure = {
     code: "UNSAFE_SQL",
     message: 'The statement uses the blocked construct "cte_header" (SQL execution policy §6).',
     retryable: false,
     details: { blockedConstruct: "cte_header" },
   };
   ```

   Declare that constant once at the top of `checkRelations` and return it at every fail-closed site.

2. **Bail-out 2 (line 235)** — before it fires, accept the two legal DuckDB spellings the parser currently cannot read: after the `AS` token, skip an optional `MATERIALIZED`, or `NOT` followed by `MATERIALIZED`, before requiring the `(`. Concretely, when `tokens[j]` is `AS` and `tokens[j + 1]` is the word `MATERIALIZED` (case-insensitive), advance `j += 1` first; when `tokens[j + 1]` is `NOT` and `tokens[j + 2]` is `MATERIALIZED`, advance `j += 2`. Then apply the existing `(` check. Any *other* mismatch still returns the `cte_header` failure instead of `null`.

3. Do not change anything after the CTE loop — `defined`, `known`, `checkFromItems`, and the FROM/JOIN scan stay exactly as they are.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Add the regression tests

In `src/dataset-custody/sql-inspector.test.ts`, model the new cases on the existing `it`-style allow/deny cases in that file (they call `inspectSql` with an `authorizedRelations` array and assert on `ok` / `failure.code` / `failure.details`). Add:

1. **Denied (the bypass, now parsed)**: `WITH t AS MATERIALIZED (SELECT * FROM healthcare_pii) SELECT COUNT(*) FROM t` with `authorizedRelations: ["saas_churn"]` → `ok: false`, `failure.code === "DATASET_UNAVAILABLE"`, `details.relation === "healthcare_pii"`. (The statement must now reach the FROM/JOIN scan; the scan's own denial code is the correct outcome.)
2. **Denied (fail closed)**: `WITH 1 AS (SELECT 1) SELECT 1` → `ok: false`, `failure.code === "UNSAFE_SQL"`, `details.blockedConstruct === "cte_header"`. (The CTE "name" is a number token → bail-out 1.)
3. **Denied (fail closed, other garbage header)**: `WITH t AS SELECT 1 SELECT * FROM t` → `UNSAFE_SQL` / `cte_header` (no `(` after AS).
4. **Allowed (legal MATERIALIZED, no foreign relations)**: `WITH t AS MATERIALIZED (SELECT 1 AS x) SELECT * FROM t` → `ok: true`.
5. **Allowed (legal NOT MATERIALIZED)**: `WITH t AS NOT MATERIALIZED (SELECT 1 AS x) SELECT * FROM t` → `ok: true`.
6. **Regression guard**: `WITH t AS (SELECT 1 AS x) SELECT * FROM t` → `ok: true` (the plain spelling must keep working — this is what the existing pinned tests already assert; if any existing case now fails, that is a STOP condition).

**Verify**: `pnpm test -- sql-inspector` → all pass, including the 6 new cases.

### Step 3: Run the full floor

**Verify**:

- `pnpm lint` → exit 0
- `pnpm lint:strict` → exit 0
- `pnpm test` → all pass — in particular the preset-numbers contract test (`src/demo-presets/_contract/preset-numbers.test.ts`), which runs real canonical SQL through the kernel and would catch any over-rejection of the demo shapes.

## Test plan

Covered in Step 2. Structural pattern: the existing allow/deny cases in `src/dataset-custody/sql-inspector.test.ts` (same call shape, same assertion style — do not introduce a new test harness).

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` and `pnpm lint:strict` exit 0
- [ ] `pnpm test` exits 0; the 6 new cases from Step 2 exist and pass
- [ ] `grep -n "return null" src/dataset-custody/sql-inspector.ts` shows no `return null` inside the CTE loop (lines ~214–252); the remaining `return null`s are only the documented no-violation returns of `checkFromItems`/`checkRelations` (lines ~317, ~328)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at lines 214–252 no longer matches the "Current state" excerpts (drift).
- Any *existing* inspector test fails after the change and the failure is not obviously one of the new fail-closed shapes (it may mean the pinned §6 contract expects the old lenient behavior — that is a decision above this plan).
- The fix appears to require touching `lexSql`, the enforcement order, or files outside the in-scope list.
- The preset-numbers contract test fails (canonical demo SQL is being rejected — over-rejection needs a maintainer ruling).

## Maintenance notes

- Any future CTE syntax the parser learns must keep the fail-closed property: an unrecognized shape is an `UNSAFE_SQL` denial, never a skipped scan.
- Reviewer focus in the PR: confirm the `NOT MATERIALIZED` handling consumes both tokens, and that no `return null` crept back into the loop.
- Follow-up (deliberately deferred): the deny-list has ~20 forbidden words with no mid-statement test coverage (audit finding TEST-01). It guards the same seam and is a natural second commit on this file, but it is not part of this plan.
