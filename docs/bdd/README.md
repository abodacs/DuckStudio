# BDD acceptance scenarios

Structured (Gherkin) expression of the acceptance criteria that `docs/prd.md` §10 and
`docs/agent-system-design.md` §15 own. These files are **derived documents**: they introduce no
behavior. If any scenario disagrees with the canonical documents, the canonical documents win and
this directory must be corrected in the same change.

| File | Covers | Derives from |
|---|---|---|
| `analyst-sql-analysis.feature` | SQL authoring against an activated dataset, aggregation, and chart verification | `docs/prd.md` §5, §6, §10; `docs/agent-system-design.md` §5, §6, §9, §15 |
| `agent-webmcp-interaction.feature` | Driving the app through WebMCP agents: bootstrap, atomic analysis, retry semantics, custody evidence, parity | `docs/prd.md` §4, §10; `docs/agent-system-design.md` §7, §8, §10, §14, §15 |
| `local-file-import.feature` | Bringing your own file: drag-and-drop CSV import, ceilings, zero-trace cancel, identifier omission, the four-tool pin | `docs/prd.md` §3 + Amendment 3; `docs/agent-system-design.md` §3, §4.2, §4.4, §8.5, §9, §11, §14 |

## Conventions

- **Vocabulary is canonical.** Tool names, preset IDs (`saas_churn`, `healthcare_pii`), policy
  names (`public_synthetic`, `sensitive_aggregate_only`), error codes, budget numbers, and badge
  copy use the one spelling defined in `PRODUCT.md` and `docs/agent-system-design.md`.
- **Traceability tags.** `@ASD-n` maps a scenario to scenario *n* of `docs/agent-system-design.md`
  §15; `@PRD` marks scenarios that assert a `docs/prd.md` §10 acceptance line.
- **Executable counterparts.** The runnable Playwright specs live in `e2e/qa-*.spec.ts`. When a
  scenario here changes behavior, update the canonical documents first, then `e2e/`, then these
  files — never this directory alone.
