<!--
Standalone: a reader who opens no files still knows why this exists and what it does.
Length tracks the diff — small diff gets bullets, empty section gets "None".
Title: type(scope): description — type=feat|fix|chore, lowercase, no period, <72 chars.
Voice: subject is the change, never the author (no "I"/"me"/"my").
Flow/topology changes → separate before/after Mermaid flowcharts.
Draft by default; stack separable steps; run /simplify on non-trivial diffs before final checks.
-->

## Why

<!-- Who is this for, what can they now do (or what broke), why now. First line is the human difference, not the code path. -->

<!-- Closes #ISSUE_ID -->

## Non-goals

<!-- Explicitly out of scope. "None" if nothing. -->

## Constraints

<!-- What would make this wrong even if tests pass — budgets, custody/safe-release, layer rules, idempotency, no-PII. "None" if no new invariant. -->

## What changed

<!-- 2-4 line shape of the solution, then ordered walkthrough (where to look first). User-visible first — what a person will see or do differently — then mechanical. -->

<!-- Frontend changes: include screenshots / Figma link. No customer data, secrets, or internal info. -->

## How verified

<!-- How we know it's correct: commands + outcomes (link evidence, don't recite CI counts). Steps to reproduce + expected result. Tests added → regression they catch that no existing test did. What wasn't checked. Long logs in <details>. Agents: don't claim manual testing you didn't do. -->

- [ ] `pnpm lint && pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build` (skip if docs-only)
- [ ] `npx ax webmcp-audit http://localhost:5173` (if WebMCP/canvas touched)
- [ ] Manual / integration:

## Risks & rollback

<!-- How it fails in prod and how to undo (flag %, migration, revert). "Low — revert commit" if trivial. -->

<details>
<summary>Agent context</summary>

<!-- Keep to 1-3 short paragraphs or bullets — not a transcript. Paraphrase intent, don't paste prompts. -->

- **Autonomy:** Human-driven (agent-assisted) — or — Fully autonomous
- **Prompt summary (not transcript):**
- **Repo anchors used:**
- **Decisions:**
- **Tools / skills invoked:**

Patch coverage: changed lines are covered or justified under How verified. Public artifact: no non-public material in code, fixtures, comments, or description.
</details>

## Checklist

- [ ] Read `AGENTS.md` (+ relevant ADRs); used ubiquitous language; no new ADR needed or ADR drafted
- [ ] Docs updated (or not needed) — add `skip-inkeep-docs` label to suppress docs agent
- [ ] Publish to changelog? (check if user-visible)
