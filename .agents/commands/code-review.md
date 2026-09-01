# AI Code Review

You are reviewing a pull request for **LearnYourWay** — an AI-powered personalized learning platform (FastAPI + SQLAlchemy async + SQLite, DDD/Onion architecture).

Follow this exact review process:

## Step 1: Establish the diff

```bash
git merge-base origin/main HEAD | xargs git diff --stat
git merge-base origin main HEAD | xargs git diff
```

## Step 2: Measure change size

Count total code lines changed (added + removed):
- **S** (1-100): proceed normally
- **M** (101-300): proceed if one logical change
- **L** (301-700): flag for splitting, note reduced quality
- **XL** (700+): block — "This change is too large for reliable review (N lines). Split before requesting review."

## Step 3: Read spec/task context

Check PR description, linked issues, commit messages for the motivating spec. If none found, warn: "No linked spec or issue found. Correctness based on code intent only."

Read project conventions:
- `CLAUDE.md` (coding standards, DDD layer rules)
- `ARCHITECTURE.md` (system design)

## Step 4: Analyze blast radius

Use code-review-graph tools if available:
1. `build_or_update_graph_tool()`
2. `get_review_context_tool(base="main")`
3. `get_impact_radius_tool(base="main")`

Fallback: grep for callers of changed public symbols.

Record: changed symbols, files, direct dependents (d=1), indirect dependents (d=2), affected flows, test coverage.

## Step 5: Review tests first

For each test file:
- Does name describe behavior tested?
- Tests behavior (what), not implementation (how)?
- Covers happy path + edge case?
- Guards against regression this change introduces?
- Assertion meaningful?

Flag untested functions by domain tier: P0 T1, P1 T2, P2 T3, INFO T4.

## Step 6: Evaluate each changed file across 8 axes

Score each axis 0-4 for every significantly-changed file.

**Axis 1 — Correctness**: Spec match, edge cases (null, empty, boundary, unicode), error paths, off-by-one, invalid state transitions, return type consistency.
0=crashes/wrong. 1=happy path only. 2=most cases. 3=minor gaps. 4=all handled + tests prove it.

**Axis 2 — Readability**: Descriptive names, no 3+ nesting, no 200-line functions, logical grouping, no dead code, no AI slop.
0=incomprehensible. 1=needs author explanation. 2=effort needed. 3=clear minor issues. 4=self-documenting.

**Axis 3 — Architecture**: Existing patterns, no circular deps, correct abstraction level, dependency direction, minimal public API, DDD layer compliance (domain = NO framework imports).
0=violates architecture. 1=major divergence. 2=minor inconsistencies. 3=fits well. 4=clean fit.

**Axis 4 — Security**: Injection (SQL, cmd, template), auth/authz, secrets in code/logs, XSS/CSRF, unsafe deserialization, path traversal.
0=exploitable. 1=significant exposure. 2=minor issues. 3=solid. 4=defense in depth.

**Axis 5 — Performance**: N+1 queries, unbounded ops, missing pagination, sync bottlenecks, memory in hot paths, missing indexes.
0=outage. 1=significant bottleneck. 2=suboptimal. 3=good. 4=efficient.

**Axis 6 — Data Integrity**: Migration safety under concurrency, API backward compat, data transform correctness, idempotency, transaction boundaries.
0=data corruption. 1=breaking without migration. 2=minor risk. 3=compatible. 4=fully compatible + migration path.

**Axis 7 — Concurrency**: Race conditions, deadlocks, check-then-act atomicity, retry safety, idempotent workers, timeout config.
0=corrupts data. 1=significant bug. 2=timing issues. 3=mostly safe. 4=properly synchronized.

**Axis 8 — Observability**: Logging at appropriate levels, no sensitive data in logs, errors surfaced to monitoring, metrics for new features, rollback safety, audit trail.
0=undebuggable. 1=major gap. 2=some logging. 3=well-instrumented. 4=full observability.

**T4-only changes** (docs, CI config): score axes 1-3 only. Mark 4-8 as N/A.

## Step 7: Compute risk level

Sum scores (0-32). Apply modifiers:
- -4 if touches auth, payments, or data-deletion
- -3 if blast radius has >20 direct dependents
- -2 if no test coverage on changed code
- -2 if includes database migration
- -1 if size L or XL
- -1 if crosses 3+ modules

Clamp min 0. Classify:
| Score | Risk     | Action                      |
| ----- | -------- | --------------------------- |
| 28-32 | LOW      | Approve                     |
| 22-27 | MODERATE | Approve with suggestions    |
| 16-21 | ELEVATED | Request changes             |
| 10-15 | HIGH     | Request changes + re-review |
| 0-9   | CRITICAL | Block, escalate             |

T1/T2 code + AI reviewer = always add escalation note recommending human review.

## Step 8: Classify findings

| Severity      | Meaning                                            | Blocks?    |
| ------------- | -------------------------------------------------- | ---------- |
| P0 BLOCKER    | Vuln, data loss, crash, broken func                | Yes        |
| P1 MUST-FIX   | Missing critical test, wrong abstraction, bug risk | Yes        |
| P2 SHOULD-FIX | Suboptimal but functional                          | No (defer) |
| P3 NIT        | Style, naming, minor opt                           | No         |

Every P0/P1 must include: axis, `file:line`, description, concrete fix.

## Step 9: Produce report

Output ONLY this template filled in. No preamble, no closing summary.

```
## Code Review: [PR ref / branch name]

### Context
- **Spec/Issue**: [link or "none found"]
- **Change size**: [S/M/L/XL] ([N] lines)
- **Risk level**: [LOW/MODERATE/ELEVATED/HIGH/CRITICAL] ([score]/32)
- **Domain tier**: [T1/T2/T3/T4]

### Blast Radius
- Changed: [N] symbols in [M] files
- Direct dependents (d=1): [count/list]
- Affected flows: [list or "none"]
- Test coverage: [N]/[M] changed functions have tests

### Axis Scores

| #         | Axis           | Score   | Key Finding |
| --------- | -------------- | ------- | ----------- |
| 1         | Correctness    | /4      |             |
| 2         | Readability    | /4      |             |
| 3         | Architecture   | /4      |             |
| 4         | Security       | /4      |             |
| 5         | Performance    | /4      |             |
| 6         | Data Integrity | /4      |             |
| 7         | Concurrency    | /4      |             |
| 8         | Observability  | /4      |             |
| **Total** |                | **/32** |             |

### Findings

#### P0 — Blockers
[list or "None."]

#### P1 — Must Fix
[list or "None."]

#### P2 — Should Fix
[list or "None."]

#### P3 — Nits
[list or "None."]

### Untested Code
[list or "All covered."]

### What's Done Well
- [specific positive]

### Verdict
**[APPROVE / REQUEST CHANGES / BLOCK — ESCALATE]**

[1-2 sentence rationale]
```

## Step 10: Self-check

Before outputting verify:
- Every finding has `file:line`
- Every P0/P1 has concrete fix
- Scores consistent with findings (no 4/4 with P1 on that axis)
- Blast radius honest ("could not be determined" if tools failed)
- At least one item in "What's Done Well"
