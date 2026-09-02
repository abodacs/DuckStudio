# Submission Pack

The Devpost submission copy, verbatim from `docs/video-script.md` §10 (the
canonical source — edit there first). Tool names, policy labels, and badge
copy are pinned by `pnpm docs:parity` (PRD §10 parity clause).

- **Live URL:** <https://duckstudio.pages.dev>
- **Repo URL:** <https://github.com/abodacs/DuckStudio>
- **License:** MIT (`LICENSE`)
- **Video:** target 2:45, hard cap 2:55, burned captions. YouTube title:
  `DuckStudio — Agent-Native Local Data Lab on WebMCP`. The description
  includes the live URL, repo URL, the four tool names, and the
  safe-release limitation (video-script §8).
- **Checklists:** the PRD §8 demo checklist and `docs/video-script.md` §8
  recording checklist are the acceptance lists. Scripted boxes are proven by
  the e2e suite (record the run summary + date below at release time);
  human-only boxes (warm shell + hard refresh, flag toggles, B-roll capture,
  hiding wordmarks/keys, the recording, the mute test judged by eye) are
  named in grilling 62's take sheet.

## Why WebMCP is a strong fit

The governed dataset and analytical workspace live in browser memory. A
server API cannot operate on them without uploading the file, while WebMCP
can actuate the page-local custody and execution system directly.

## Better user experience

One bounded context read gives the agent stable IDs, revision, policy,
schema, budgets, and legal next actions. One atomic analysis creates an
inspectable artifact with SQL, lineage, measured cost, KPIs, and chart—
without fragile multi-call choreography.

## What people and agents can do together that was impossible before

An analyst can delegate local computation while DuckStudio retains custody
and controls release into both tools and the agent-visible DOM. Subsequent
work builds on immutable artifact handles instead of repeatedly exposing
context or recomputing results.

## How WebMCP was implemented

Four imperative tools—`duckdb_get_context`, `duckdb_activate_dataset`,
`duckdb_execute_sql_to_canvas`, and `duckdb_verify_zero_egress`—are a subset
of the revisioned-workspace interface. They use one schema module plus
runtime validation, a shared response envelope, optimistic revisions,
idempotent retries, bounded DuckDB-WASM execution, immutable artifact
lineage, one safe projection, and scoped custody telemetry. Human controls,
native WebMCP, and the simulator share that workspace.

## Release-time record (fill at submission)

- e2e run against the live origin: `<date, test count, green>`
- Audit four-pillar breakdown (≥ 70): `<paste from the release PR>`
- Mute test: judged by eye on the final cut — artifact handle,
  `sensitive_aggregate_only` / `public_synthetic` policy labels, and
  `0 Bytes of Dataset Uploaded` tell the custody story with no audio.
