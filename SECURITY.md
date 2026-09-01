# Security

Custody and safe-release posture for DuckStudio. This is the canonical home for the implementation rules that enforce controlled release into tool payloads and agent-visible DOM.

Layered documents: `PRODUCT.md` owns the product-level invariants ("Safety and Resource Invariants"); `docs/agent-system-design.md` §5–§6 owns the policy tables and SQL allow/deny list; this document owns the implementation rules. `ARCHITECTURE.md` owns structure; `AGENTS.md` owns agent behavior.

## Custody and Safe Release

Treat tool payloads and agent-visible DOM as one release boundary.

- Never place sensitive raw values in tool responses, shared canvas views, logs, errors, telemetry, test snapshots, or analytics.
- `public_synthetic` datasets may render bounded demo-safe rows; `sensitive_aggregate_only` datasets never render raw grid rows.
- Enforce direct-identifier suppression and minimum aggregate cohort size at runtime.
- Dataset policy is explicit metadata. Name-based detection is defense in depth only.
- Keep the badge copy exact: `0 Bytes of Dataset Uploaded`.
- Distinguish dataset upload accounting from application-shell traffic.
- Describe runtime interception as operational evidence, never formal proof or compliance certification.

## SQL and Resource Boundaries

- Accept one read-only `SELECT` or `WITH` statement with separate parameter bindings.
- Reject multiple statements, DDL, DML, transactions, external URLs/files, unauthorized relations, extension loading, and attach/copy/export/install/load operations before worker execution. The full deny list is `docs/agent-system-design.md` §6.
- Enforce execution, materialization, chart, response, context, and artifact-retention budgets from the canonical system design.
- Return measured metrics only. Never replace runtime values with demo targets.
- Do not commit partial results after timeout, budget failure, policy denial, or cancellation.
