# ADR 0003 — Lint and format with oxlint + oxfmt

- Status: Accepted
- Date: 2026-08-31
- Deciders: @senior-frontend-architect
- Technical Area: Build, Tooling
- Amendment 2: 2026-08-31 (template conformance: Deciders, Technical Area, reformat Alternatives, split Consequences into Positive/Negative/Neutral, add Implementation, References, Decision Log)
- Amendment 1: 2026-08-31 (rule-coverage honesty, lint-strict contents, fallback for missing rules)

## Context

The repo enforces strict TypeScript, React, and a small set of safety rules around the custody kernel and SQL inspector. CI runs lint, typecheck, test, and build on every push. A slow or plugin-heavy toolchain blocks the one-day build and slows every later change.

## Alternatives Considered (amended 2)

### Option 1: oxlint + oxfmt

**Description**: Two binaries sharing the oxc parser, ~50–100× faster than ESLint, Prettier-compatible formatter, no plugin zoo.
**Pros**: Same parser as the bundler, fast on a CI budget, single mental model, `lint-strict` config for the custody hot path.
**Cons**: Rule set is growing, not complete. `react-hooks/exhaustive-deps` has no equivalent; the gap is owned by a Vitest contract test.
**Why rejected**: N/A — selected.

### Option 2: Biome

**Description**: Single Rust binary, fast, own opinionated rule set and formatter.
**Pros**: One tool, no Prettier-vs-ESLint race, fast.
**Cons**: Own opinionated formatter that drifts from Prettier conventions. Less mature React/TypeScript rule coverage than ESLint today.
**Why rejected**: Strong runner-up. We chose oxlint + oxfmt because the rule coverage on the paths we lint-strict (custody, registration, projection, SQL inspector) is better, and because oxlint shares the oxc parser with the Vite pipeline.

### Option 3: ESLint + Prettier

**Description**: Maximum rule coverage, mature plugin ecosystem, two tools that must be kept in sync.
**Pros**: `react-hooks/exhaustive-deps`, `eslint-plugin-react-hooks`, every TypeScript rule under the sun, mature ecosystem.
**Cons**: Slow on a CI budget. Two tools that drift. Plugin zoo per import. Not fast enough for a one-day build.
**Why rejected**: Speed and lockfile size matter on hackathon day. The ESLint plugin we would miss most (`react-hooks/exhaustive-deps`) is owned by a Vitest contract test in `live-canvas/`.

## Decision

Use **oxlint** for lint and **oxfmt** for format. Pin both in `package.json`. CI runs `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` on every push.

### Rule coverage (amended)

oxlint's rule set is **growing, not complete.** We rely on:

- TypeScript correctness rules (`no-unused-vars`, `no-explicit-any` is *not* in the default; we add it).
- React correctness rules that oxlint ships.
- `no-floating-promises` style rules where oxlint supports them.

We explicitly do **not** rely on:

- `react-hooks/exhaustive-deps`. oxlint does not yet have an equivalent. We add a Vitest contract test in `live-canvas/` that exercises the hook dependency arrays on the canvas projection selector. A test is not a lint rule, but it catches the regression class.
- A custom rule for "no raw row released." This is enforced by the custody kernel at runtime, not by the linter.

### lint-strict config (amended)

`lint-strict` applies to `dataset-custody/**`, `agent-control-plane/envelope.ts`, `agent-control-plane/registration.ts`, `revisioned-workspace/projection.ts`, and `duck-engine/sql-inspector.ts`. The strict config enables:

- `no-explicit-any` (error)
- `no-non-null-assertion` (error)
- `no-console` (error — custody may not log raw values)
- All TypeScript correctness rules at error level

The rest of the repo runs at default config plus `no-floating-promises` where available.

### Fallback for missing rules (amended)

If oxlint does not have a rule we need, the replacement is:

1. A focused Vitest contract test that runs in CI, or
2. A code-review checklist in `ARCHITECTURE.md` and `SECURITY.md` (already in place for "no private UI setter," "no raw row release," and "no third-party CDN").

A code review is the last resort. The order is: oxlint rule → Vitest contract test → `ARCHITECTURE.md`/`SECURITY.md` checklist.

## Consequences (amended 2)

### Positive

- No `eslint --fix` vs `prettier --write` races. The two tools share a parser.
- `ARCHITECTURE.md` remains the source of architectural law; the linter is the safety net, not the policy.
- `lint-strict` gives the custody hot path error-level rules (`no-explicit-any`, `no-non-null-assertion`, `no-console`) that catch the regression class before CI.

### Negative

- A future rule that Biome or ESLint has and oxlint lacks can be added by hand or by a focused Vitest assertion. **Honest framing:** this is a benchmark claim, not a coverage guarantee; the gaps are named above.
- The `react-hooks/exhaustive-deps` gap is owned by a Vitest contract test in `live-canvas/`. A test is not a lint rule; it runs only on the canvas projection selector, not the whole tree.
- oxlint 0.9 / oxfmt 0.3 are pre-1.0. We accept the churn risk because the alternative is too slow for the one-day build.

### Neutral

- The fallback order for missing rules is fixed: oxlint rule → Vitest contract test → `ARCHITECTURE.md`/`SECURITY.md` checklist. Code review is the last resort.

## Implementation (amended 2)

- `pnpm lint`, `pnpm lint-strict`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e` are the contract. CI runs all six on every push.
- `lint-strict` config in `.oxlintrc.json` covers `dataset-custody/**`, `agent-control-plane/envelope.ts`, `agent-control-plane/registration.ts`, `revisioned-workspace/projection.ts`, and `duck-engine/sql-inspector.ts`. It enables `no-explicit-any`, `no-non-null-assertion`, `no-console`, and the full TypeScript correctness rules at error level.
- The Vitest contract test for the canvas projection selector dependency arrays lives in `live-canvas/_contract/`. It must pass on every push.
- oxlint 0.9 / oxfmt 0.3 are pinned in `package.json` (see ADR 0006 version table). The fallback if oxlint blocks us is Biome 1.9.

## References (amended 2)

- ADR 0005 — `src/` follows the screaming architecture in `ARCHITECTURE.md` (folder ownership for the lint-strict paths)
- ADR 0006 — Tooling versions and Cloudflare Pages deployment (oxlint / oxfmt version pins)
- oxlint: https://oxc.rs/docs/guide/usage/linter.html
- oxfmt: https://oxc.rs/docs/guide/usage/formatter.html
- Biome (rejected alternative): https://biomejs.dev/

---

## Decision Log

| Date       | Change   | By                       |
| ---------- | -------- | ------------------------ |
| 2026-08-31 | Proposed | @senior-frontend-architect |
| 2026-08-31 | Amendment 1: rule-coverage honesty, lint-strict contents, fallback for missing rules | @senior-frontend-architect |
| 2026-08-31 | Amendment 2: template conformance | @senior-frontend-architect |
| 2026-08-31 | Accepted | @senior-frontend-architect |
