# Plan 003: Make the sensitive release gate alias-proof — deny identifier-derived results and row-reassembling aggregates

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat ff604ab..HEAD -- src/dataset-custody/kernel.ts src/dataset-custody/sql-inspector.ts src/dataset-custody/kernel.test.ts src/dataset-custody/sql-inspector.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (over-denial of legitimate aggregate analyses is the failure mode; the pinned preset contract is the guardrail)
- **Depends on**: plans/001-fail-closed-cte-relation-check.md (sequencing only — both edit `sql-inspector.ts`; land 001 first to avoid merge friction)
- **Category**: security
- **Planned at**: commit `ff604ab`, 2026-09-03
- **Issue**: (pending publication)

## Why this matters

PRODUCT.md invariant 2 / §5.1 row 5: on a `sensitive_aggregate_only` dataset, direct-identifier values **never leave, in any policy**, and only aggregates release after cohort checks. Two code-level defeats of that rule exist today, both verified end to end:

1. **Aliases defeat the identifier block.** `decideRelease` classifies result columns **by column name** (`resultColumnClassifications`), defaulting to `"public"`. `SELECT mrn AS patient_ref FROM healthcare_pii` produces a result column named `patient_ref` — unknown name → `public` → the identifier block passes, and a raw medical-record number releases into the envelope KPIs, the canvas, and the durable artifact.
2. **Row-reassembling "aggregates" pass the aggregate gate.** The sensitive gate requires only `hasAggregate`, and the aggregate word list includes `FIRST`, `LAST`, `STRING_AGG`, and `LIST`. `SELECT FIRST(mrn) AS x FROM healthcare_pii` is ungrouped, so the cohort probe returns the full row count (100,000 ≥ 10) and a single raw identifier value releases as a "KPI". `ANY_VALUE` / `ARBITRARY` are not even in the list, so they slip through trivially.

Closing these two holes is the highest-value custody work in the audit: the materialized *relation* correctly omits identifier columns, but the release seam can still publish their values.

## Current state

Relevant files:

- `src/dataset-custody/kernel.ts` — the custody kernel; owns `decideRelease` (the release decision) and the name-based classifier.
- `src/dataset-custody/sql-inspector.ts` — the lexer (`lexSql`, exported) and the token scan that computes `hasAggregate`.
- `src/dataset-custody/kernel.test.ts` / `src/dataset-custody/sql-inspector.test.ts` — the existing release/inspection tests (structural pattern).
- `src/demo-presets/_contract/preset-numbers.test.ts` — runs the canonical demo SQL through the kernel; the over-denial guardrail.

The name-based classifier (defaults unknown names to `public`):

```ts
// kernel.ts:192-199
/** Classification of the materialized result columns, by name, through the source's digest. */
function resultColumnClassifications(
  source: { readonly columns: readonly PresetColumn[] },
  resultSchema: readonly { readonly name: string; readonly type: string }[],
): Map<string, PresetColumn["classification"]> {
  const byName = new Map(source.columns.map((column) => [column.name, column.classification]));
  return new Map(resultSchema.map((column) => [column.name, byName.get(column.name) ?? "public"]));
}
```

The release gate: identifier block first, then the sensitive aggregate/cohort checks:

```ts
// kernel.ts:343-387 (decideRelease, abridged)
const classifications = resultColumnClassifications(source, resultSchema);
const identifierColumns = [...classifications.entries()]
  .filter(([, classification]) => classification === "direct_identifier")
  .map(([name]) => name);
if (identifierColumns.length > 0) {
  ... return { ok: false, failure: { code: "POLICY_DENIED", ... } };
}

const sensitive = policy === "sensitive_aggregate_only";
if (sensitive) {
  if (!inspectStatementShape(sql, [relation]).hasAggregate) {
    ... // POLICY_DENIED: raw rows are suppressed
  }
  if (minCohortCount === null || minCohortCount < minimumCohortSize) {
    ... // POLICY_DENIED: cohort below minimum
  }
}
```

The aggregate word list (note `FIRST`, `LAST`, `STRING_AGG`, `LIST` — reassemblers — alongside true aggregates):

```ts
// sql-inspector.ts:66-69
const AGGREGATE_WORDS = new Set([
  "COUNT", "SUM", "AVG", "MIN", "MAX", "TOTAL", "MEDIAN", "MODE", "STRING_AGG", "LIST", "ARRAY_AGG",
  "FIRST", "LAST", "PRODUCT", "STDDEV", "VARIANCE", "BOOL_AND", "BOOL_OR",
]);
```

The planning-mode re-inspection `decideRelease` uses (returns only the shape flags):

```ts
// kernel.ts:201-220 (abridged)
function inspectStatementShape(sql: string, authorizedRelations: readonly string[]): StatementPlan {
  const inspection = inspectSql({ sql, bindings: {}, authorizedRelations, schema: [], skipBindings: true });
  if (!inspection.ok) {
    return { hasAggregate: false, hasGrouping: false, groupExpressions: [], whereExpression: null };
  }
  ...
}
```

Facts the executor needs:

- `lexSql(sql)` is exported from `sql-inspector.ts` and returns tokens with `kind` (`"word"`, `"quotedIdent"`, `"string"`, …) and case-preserving `text`/`value`. String literals and comments never produce word tokens.
- `source.columns` (type `PresetColumn`) carries `{ name, type, classification }`; classification values include `"direct_identifier"`.
- The preset `healthcare_pii` carries `mrn` (and `diagnosis`) with classification `direct_identifier` for `mrn`-family columns; `saas_churn` is `public_synthetic`.
- SQL identifiers are case-insensitive: match token values case-insensitively (`token.text.toUpperCase()`), and keep the comparison to whole word/quotedIdent tokens — a substring match would false-positive inside other words.

## Commands you will need

All commands assume Node 26. If `node --version` is not v26, first run:

```sh
export PATH="$HOME/.nvm/versions/node/v26.8.1/bin:$PATH"   # or: nvm use
```

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Install   | `pnpm install`                       | exit 0              |
| Typecheck | `pnpm typecheck`                     | exit 0              |
| Lint      | `pnpm lint` / `pnpm lint:strict`     | exit 0 (kernel + inspector are trust-seam files) |
| Tests     | `pnpm test -- kernel` / `pnpm test -- sql-inspector` | all pass, including new tests |
| Guardrail | `pnpm test -- preset-numbers`        | passes — canonical demo SQL must not be denied |
| Full floor| `pnpm test`                          | all pass            |

## Scope

**In scope** (the only files you should modify):

- `src/dataset-custody/kernel.ts` — `decideRelease` (+ a small helper) and the `StatementPlan` plumbing
- `src/dataset-custody/sql-inspector.ts` — one new word set + one flag on `SqlInspection`
- `src/dataset-custody/kernel.test.ts`, `src/dataset-custody/sql-inspector.test.ts` — new cases

**Out of scope** (do NOT touch, even though they look related):

- `store.ts`'s `classifyResultSchema` (metadata naming stays name-based — the release decision is the seam that matters).
- `presentation.ts` / projection / canvas rendering.
- The cohort probe (`probeCohortCount`, `cohortProbeSql`) — unchanged.
- `public_synthetic` behavior — `FIRST()` over a public dataset stays legal.
- The engine (`duck-engine/`) — it consumes decisions verbatim and must learn nothing new.

## Git workflow

- Branch: `fix/sensitive-release-alias-proof` off the branch you were dispatched from.
- Commit style: `fix(custody): make the sensitive release gate alias-proof` (+ `test(custody): …` for the cases).
- Do NOT push or open a PR unless the operator instructed it. Never target `main` directly.

## Steps

### Step 1: Add the reassembling-aggregate rule

1. In `sql-inspector.ts`, add next to `AGGREGATE_WORDS`:

   ```ts
   /** Row-reassembling functions: legal aggregates by shape, but each returns a raw per-row value. */
   const REASSEMBLING_WORDS = new Set(["FIRST", "LAST", "ANY_VALUE", "ARBITRARY", "LIST", "ARRAY_AGG", "STRING_AGG"]);
   ```

2. In the same token loop that sets `hasAggregate` (`sql-inspector.ts:473-475`), set a sibling flag when a reassembling word is followed by `(`:

   ```ts
   if (token.kind === "word" && REASSEMBLING_WORDS.has(upper) && meaningful[k + 1]?.text === "(") {
     reassembles = true;
   }
   ```

   Add `reassembles: boolean` to the `SqlInspection` interface and its return site (default `false`).

**Verify**: `pnpm typecheck` → exit 0; `pnpm test -- sql-inspector` → existing tests pass (new interface field must not break existing assertions).

### Step 2: Surface the flag through `inspectStatementShape`

In `kernel.ts`, extend `StatementPlan` (the type returned by `inspectStatementShape`, `kernel.ts:201-220`) with `reassembles: boolean` and pass it through from `inspection.inspection.reassembles` (default `false` on the failure branch, matching the existing flags).

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Add the identifier-provenance rule and both denials in `decideRelease`

In `kernel.ts`, add a helper and two checks inside `decideRelease`'s `sensitive` branch (after the existing aggregate check, before the cohort check):

```ts
/** True when any token in the statement references a direct-identifier column of the source. */
function referencesIdentifierColumn(sql: string, source: GovernedSource): string | null {
  const identifiers = new Set(
    source.columns.filter((c) => c.classification === "direct_identifier").map((c) => c.name.toUpperCase()),
  );
  if (identifiers.size === 0) return null;
  for (const token of lexSql(sql)) {
    if ((token.kind === "word" || token.kind === "quotedIdent") && identifiers.has(token.value.toUpperCase())) {
      return token.value;
    }
  }
  return null;
}
```

Then in `decideRelease`, still inside `if (sensitive)`:

1. **Reassembling denial** — when `inspectStatementShape(sql, [relation]).reassembles` is true, return `POLICY_DENIED` with message `"Sensitive datasets release aggregates only; <fn>() reassembles a raw row value and cannot release."` (reuse the failure shape of the existing aggregate denial at `kernel.ts:366-372`; put the function name in `details.blockedFields` or a new `details.blockedConstruct` — match whichever the neighboring failures use for machine-readability).
2. **Identifier-provenance denial** — when `referencesIdentifierColumn(sql, source)` returns a name, return `POLICY_DENIED` with message `"The result would derive from direct-identifier values, which never leave custody."` and `details.blockedFields` set to the returned column name. (Statement-level scanning is deliberately coarse: on a sensitive source, *any* identifier-derived expression — aliased, wrapped, or through a CTE — is denied. This closes the alias hole without fragile positional alignment; note the accepted over-denial of things like `LENGTH(mrn)` in the commit message.)

Why statement-level scanning is correct here: on a sensitive source the authorized relation is the dataset itself, so *any* reference to an identifier column anywhere in the statement — select list, CTE body, or expression — can only feed the result. `WHERE`-scoped references were already cohort-guarded; they are now denied earlier by the same rule, which is strictly safer and simpler to reason about.

**Verify**: `pnpm typecheck` → exit 0; `pnpm test -- preset-numbers` → still passes (canonical demo SQL never references identifier columns; if it does, STOP).

### Step 4: Tests

In `src/dataset-custody/kernel.test.ts` (model after the existing `decideRelease` cases there — same fake-source fixtures):

1. `SELECT FIRST(mrn) AS x FROM healthcare_pii`-shaped release → denied, `POLICY_DENIED` (reassembling rule).
2. `SELECT mrn AS patient_ref FROM …` (non-aggregate) → already denied today by the aggregate check; keep a case asserting it stays denied.
3. `SELECT COUNT(mrn) AS n FROM …` (aggregate + identifier reference) → denied by the provenance rule (counting an identifier still discloses).
4. `SELECT COUNT(*) AS n FROM … GROUP BY diagnosis` with `minCohortCount ≥ 10` → releases (the canonical allowed shape must keep working).
5. `SELECT ANY_VALUE(diagnosis) AS d FROM …` → denied (reassembling rule; `ANY_VALUE` was previously invisible).
6. Same-shaped reassembling query over the **public** `saas_churn` source → releases unchanged (public behavior must not regress).

In `src/dataset-custody/sql-inspector.test.ts`: assert `inspection.reassembles` is `true` for `SELECT FIRST(x) FROM t` and `false` for `SELECT COUNT(x) FROM t` (model after existing shape-assertion cases).

**Verify**: `pnpm test -- kernel` and `pnpm test -- sql-inspector` → all pass including new cases; `pnpm test` → full floor green (the e2e-adjacent contract suites exercise real release flows and catch over-denial).

## Test plan

As in Step 4. Structural patterns: existing `decideRelease` cases in `kernel.test.ts`; shape cases in `sql-inspector.test.ts`.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm lint:strict` exit 0
- [ ] `pnpm test` exits 0; the new cases from Step 4 exist and pass
- [ ] `pnpm test -- preset-numbers` passes (no canonical demo SQL denied)
- [ ] `grep -n "REASSEMBLING_WORDS" src/dataset-custody/sql-inspector.ts` → the set exists and is consulted in the token loop
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts no longer match the live code (drift).
- The preset-numbers contract test fails — canonical demo SQL is being denied; over-denial of the pinned demo is a product decision, not an implementation detail.
- A legitimate healthcare-preset aggregate shape that the PRD/demo requires (`docs/prd.md` §6, the cohort scenarios in `e2e/qa-custody.spec.ts`) is denied — that means the rule needs narrowing above this plan's pay grade.
- The fix appears to require touching `store.ts`, the engine, or the cohort probe.

## Maintenance notes

- New reassembling functions in future DuckDB versions belong in `REASSEMBLING_WORDS`; the set, not the kernel, is the extension point.
- The provenance scan is intentionally statement-level (coarse but sound). If the product later needs per-column provenance (e.g. allow `UPPER(LEFT(mrn,1))`), that is a design change — start from `docs/agent-system-design.md` §5, not from this code.
- Reviewer focus: confirm neither new denial fires for the public preset path, and that the failure details stay machine-readable (stable codes, no prose-only denials — `CONTEXT.md` envelope rules).
