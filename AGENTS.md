# Agent Instructions

## Document Authority

Keep each fact in its canonical document and derive the others from it:

- `PRODUCT.md` owns product purpose, positioning, principles, and non-negotiable invariants.
- `docs/agent-system-design.md` owns tool schemas, state mechanics, policy rules, envelopes, errors, and agent playbooks.
- `docs/prd.md` owns one-day scope, implementation slices, UI behavior, and acceptance criteria.
- `docs/video-script.md` is derived proof. It must not invent behavior absent from the PRD.
- `README.md` is onboarding, not a competing specification.
- `ARCHITECTURE.md` owns implementation architecture: folder structure, command path, state rules, module lifecycle.
- `SECURITY.md` owns custody and safe-release implementation rules.
- `CONTRIBUTING.md` owns tests, checks, the pre-publish audit, and browser setup.
- `AGENTS.md` owns agent behavior and document authority.

When a contract changes, update every derived document in the same change. Tool names, policy names, badge copy, preset IDs, budgets, and demo order must have one spelling everywhere.

## Where the Rules Live

The rules in `ARCHITECTURE.md`, `SECURITY.md`, and `CONTRIBUTING.md` bind agents exactly as they bind humans. Do not restate them here; follow them from their canonical homes.

## Agent Behavioral Guidelines

### Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

### Simplicity First
- No features beyond what was asked.
- No abstractions for single-use code.
- **If you write 200 lines and it could be 50, rewrite it.**

### Surgical Changes
- Don't "improve" adjacent code or formatting.
- Match existing style, even if you'd do it differently.
- Every changed line should trace directly to the user's request.

### Goal-Driven Execution
Define success criteria. Loop until verified.
- "Add validation" → Write tests for invalid inputs, then make them pass
- "Fix bug" → Write test that reproduces it, then make it pass

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
