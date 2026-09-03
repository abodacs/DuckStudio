# Plan 002: Re-escape every interpolated identifier before engine DDL — the gate's guarantee must hold behind the seam

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat ff604ab..HEAD -- src/duck-engine/duckdb.worker.ts src/duck-engine/node-duckdb.ts src/duck-engine/intake.ts src/duck-engine/intake.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (touches the intake path used by every import; benign weird headers must keep working)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `ff604ab`, 2026-09-03
- **Issue**: (pending publication)

## Why this matters

The SQL inspector's docstring promise is "unsafe SQL never crosses the worker boundary" (`sql-inspector.ts:4-6`). Three DuckDB DDL assembly sites undermine that promise from behind the seam: they re-interpolate runtime strings — agent-authored result column aliases and dropped-file CSV headers — into `CREATE TABLE` statements that run via `connection.query(...)`, which executes a **whole script**, not one statement. A value containing a double quote (which SQL escapes by doubling, `""`) is decoded to its raw form upstream and re-interpolated here **without re-escaping**, so the decoded quote terminates the identifier, the following text executes as a new statement the gate never saw, and a trailing `--` comments the remains. The intake variant needs nothing more than a CSV whose header contains a quote — untrusted file content — to inject a statement into the worker. The benign face of the same bug: importing a legal CSV with a quote in a header currently fails as a misleading `INTERNAL_ERROR`.

This plan makes identifier quoting safe at the assembly sites. It deliberately does **not** change what the inspector accepts — agent-visible behavior at the gate is unchanged; only the engine-side statement assembly becomes injection-proof.

## Current state

Relevant files:

- `src/duck-engine/duckdb.worker.ts` — the browser runtime adapter; owns `materialize` and `intake`.
- `src/duck-engine/node-duckdb.ts` — the headless test runtime (same `DuckEngineRuntime` seam, real DuckDB via `@duckdb/node-api`); duplicates `materialize`/`intake`.
- `src/duck-engine/intake.ts` — intake helpers shared by both adapters; `buildIntakeSql` assembles the import DDL.
- `src/duck-engine/intake.test.ts` — existing intake tests against the node runtime (the structural pattern for new tests).

Site 1 — browser `materialize` interpolates the result schema's column names (these originate from agent SQL aliases; the inspector deliberately permits quoted identifiers, and DuckDB decodes `""` inside them, so a name can carry a raw `"`):

```ts
// duckdb.worker.ts:117-124
async materialize(relationName, result) {
  const columns = result.schema.map((column) => column.name);
  const columnList = result.schema
    .map((column) => `"${column.name}" ${column.type}`)
    .join(", ");
  await connection.query(`CREATE TABLE ${relationName} (${columnList})`);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const insert = await connection.prepare(`INSERT INTO ${relationName} VALUES (${placeholders})`);
```

Site 2 — node `materialize`, the identical pattern:

```ts
// node-duckdb.ts:81-88
async materialize(relationName, result) {
  const columns = result.schema.map((column) => column.name);
  const columnList = result.schema
    .map((column) => `"${column.name}" ${column.type}`)
    .join(", ");
  await connection.run(`CREATE TABLE ${relationName} (${columnList})`);
```

Site 3 — intake projection interpolates CSV header names, i.e. untrusted file content (headers come verbatim from `DESCRIBE SELECT * FROM read_csv(...)` in both adapters):

```ts
// intake.ts:103-106
export function buildIntakeSql(relation: string, fileName: string, columns: readonly EngineColumn[]): string {
  const projection = columns.map((column) => `"${column.name}"`).join(", ");
  return `CREATE OR REPLACE TABLE ${relation} AS SELECT ${projection} FROM read_csv('${fileName}')`;
}
```

Adjacent facts the executor needs:

- The `INSERT INTO ${relationName} VALUES ($1, …)` placeholders are **positional parameters** — values never touch SQL text. Untouched by this plan.
- `column.type` values come from the engine's own type map (`result-decode.ts` `duckDbType`) or from `DESCRIBE`'s `column_type` — engine-controlled enums like `VARCHAR`, not user text. Out of scope (see Maintenance).
- `relationName` values are store-generated (`artifact_a_NNNN`, `local_<slug>_<digest>`), so they are safe today — but quoting them costs nothing and closes the whole class.
- `warm()`'s column spec (`duckdb.worker.ts:75`) uses single-quoted string-map entries built from **code-owned preset constants** — out of scope.
- Module rule (`ARCHITECTURE.md`): the engine "consumes [custody decisions] verbatim; it never re-derives them." Safe statement *assembly* is not custody re-derivation — this fix adds no policy.

## Commands you will need

All commands assume Node 26. If `node --version` is not v26, first run:

```sh
export PATH="$HOME/.nvm/versions/node/v26.8.1/bin:$PATH"   # or: nvm use
```

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Install   | `pnpm install`                       | exit 0              |
| Typecheck | `pnpm typecheck`                     | exit 0              |
| Lint      | `pnpm lint`                          | exit 0              |
| Tests     | `pnpm test -- duck-engine`           | all pass, including new tests |
| Full floor| `pnpm test`                          | all pass            |

## Scope

**In scope** (the only files you should modify):

- `src/duck-engine/identifiers.ts` (create) — the new quoting helper
- `src/duck-engine/duckdb.worker.ts` — `materialize` only
- `src/duck-engine/node-duckdb.ts` — `materialize` only
- `src/duck-engine/intake.ts` — `buildIntakeSql` only
- `src/duck-engine/intake.test.ts` — new regression tests

**Out of scope** (do NOT touch, even though they look related):

- `src/dataset-custody/sql-inspector.ts` — the gate's acceptance rules stay exactly as they are.
- `warm()` in both adapters — preset names are code constants.
- `column.type` interpolation — engine-controlled type names.
- The per-row `INSERT` loop (a separate performance finding); its shape must survive this plan unchanged apart from the relation name quoting.
- `protocol.ts`, `worker-handler.ts`, e2e specs.

## Git workflow

- Branch: `fix/engine-identifier-quoting` off the branch you were dispatched from.
- Commit style (match the repo): `fix(duck-engine): quote interpolated identifiers in DDL assembly`.
- Do NOT push or open a PR unless the operator instructed it. Never target `main` directly.

## Steps

### Step 1: Add the quoting helper

Create `src/duck-engine/identifiers.ts`:

```ts
/**
 * DuckDB delimited-identifier quoting: a `"` inside a name is escaped by
 * doubling. Every identifier interpolated into engine DDL must pass through
 * here — a decoded alias or CSV header can otherwise terminate the statement
 * and execute what follows.
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
```

Match the module docstring style of neighboring files (see `intake.ts:3-10`).

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Route the three sites through it

1. `duckdb.worker.ts` `materialize`: build `columnList` with `` `${quoteIdentifier(column.name)} ${column.type}` `` and issue `CREATE TABLE ${quoteIdentifier(relationName)} (${columnList})`. Keep the `INSERT` statement's relation name quoted the same way (it is the same interpolated identifier class).
2. `node-duckdb.ts` `materialize`: identical changes.
3. `intake.ts` `buildIntakeSql`: `projection` items become `quoteIdentifier(column.name)`; the target relation becomes `${quoteIdentifier(relation)}`. The `'${fileName}'` literal stays as-is — file names are sanitized to `[-A-Za-z0-9_]` by `intakeFileName` (`intake.ts:88-95`); note that in a comment, do not change it.
4. Add the import of `quoteIdentifier` to each file.

**Verify**: `pnpm typecheck` → exit 0; `grep -n '"${column.name}"' src/duck-engine` → no matches; `grep -n '${relationName}' src/duck-engine/duckdb.worker.ts src/duck-engine/node-duckdb.ts` → only inside `quoteIdentifier(...)` calls.

### Step 3: Regression tests

Add to `src/dataset-custody`-style real-engine tests in `src/duck-engine/intake.test.ts`, modeling the existing cases there (they already drive `createNodeDuckRuntime()` end to end):

1. **Benign round trip**: `runBounded` on `SELECT 42 AS "we""ird"` → schema name is `we"ird`; then `materialize("artifact_test", result)` succeeds, and `SELECT COUNT(*) FROM artifact_test` returns the row count. (This is the decode→re-encode path: the alias that used to produce broken DDL now materializes.)
2. **Hostile-header import (unit level)**: `buildIntakeSql("local_x_ab12", "file.csv", [{ name: 'a"b', type: "VARCHAR" }])` produces SQL that `connection.run` executes without error against the node runtime, and `SELECT COUNT(*) FROM "local_x_ab12"` works. Assert the composed statement contains `\"\"\"`-style doubled quotes (i.e. `""a""b""` appears in the projection) so the escaping itself is pinned.
3. **Hostile-header import (runtime level)**: write a CSV whose header row contains a quoted name (e.g. a column literally named `a"b`) through the node adapter's `intake()`; assert it resolves with the correct `rowCount` and that the described columns keep the odd name (metadata) while nothing throws.
4. **Benign headers unchanged**: the existing intake tests must still pass untouched.

**Verify**: `pnpm test -- duck-engine` → all pass, including the new cases.

### Step 4: Full floor

**Verify**: `pnpm lint` → exit 0; `pnpm test` → all pass (includes the store/mutation contracts, which materialize through the node runtime on every analysis commit — the strongest signal the quoting changed nothing observable).

## Test plan

Covered in Step 3. Structural pattern: the existing `createNodeDuckRuntime()` cases in `src/duck-engine/intake.test.ts`.

## Done criteria

- [ ] `pnpm typecheck` exits 0; `pnpm lint` exits 0
- [ ] `pnpm test` exits 0; the new quoting tests exist and pass
- [ ] `grep -rn '"${column.name}"' src/duck-engine` → no matches
- [ ] Every `CREATE TABLE`/`INSERT INTO`/`CREATE OR REPLACE TABLE` in `src/duck-engine/` interpolates identifiers only through `quoteIdentifier`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts no longer match the live code (drift).
- Any `column.type` value reaching `materialize` can contain a quote or whitespace that the composed DDL cannot carry (inspect `duckDbType` and the `DESCRIBE` path first; if genuinely possible, stop — type handling is out of scope and needs a ruling).
- Quoting the relation name breaks a test that asserts the *unquoted* relation name in user-visible output (report; do not strip quotes downstream to make it pass).
- The e2e suite (if run by the operator) shows dataset naming drift.

## Maintenance notes

- New DDL assembly in `duck-engine` must route identifiers through `quoteIdentifier`; a reviewer should reject any `"...${name}..."` identifier interpolation on sight.
- If `column.type` ever becomes runtime-derived text, it needs its own escaping decision (types are engine enums today).
- Deferred on purpose: batching the per-row `INSERT` loop (performance finding PERF-01). If it lands later, keep the identifier quoting — multi-row `VALUES` still interpolates only `?` placeholders and the relation name.
