# Product

<!-- impeccable:product-schema 1 -->

## Platform

Web.

## Stack

Fresh Vite + React + TypeScript + Tailwind CSS scaffold. `@duckdb/duckdb-wasm` runs in a dedicated Web Worker; ECharts renders charts; the SQL view uses a highlighted textarea. The static build deploys to Cloudflare Pages with COOP/COEP headers. DuckDB-WASM, fonts, and chart assets are self-hosted because `Cross-Origin-Embedder-Policy: require-corp` makes third-party assets fragile and unnecessary.

## Users

- **Healthcare and finance analysts under egress bans or DPAs.** They need answers from sensitive files without uploading those files or exposing sensitive rows to an agent.
- **Browser agents.** They need compact context, explicit state, bounded commands, stable handles, deterministic retries, and actionable failures—not DOM inference or a transcript they must repeatedly reread.
- **WebMCP Challenge judges.** They need visible proof that WebMCP enables local analysis that a server API cannot safely perform.

## Product Purpose

DuckStudio is a zero-upload, in-browser data lab where people and agents operate the same local analytical workspace. A custody kernel keeps datasets inside the tab, a policy boundary controls what may be released to tools and the shared canvas, DuckDB-WASM performs bounded analysis, and each successful operation leaves an immutable artifact that later work can reference.

Success means the one-day build works, `docs/video-script.md` can be recorded without fakery, and the system demonstrates a use that depends on page-local WebMCP actuation.

## Positioning

Data cannot leave the client, and a cloud model cannot directly query browser RAM. DuckStudio bridges that gap without giving the model custody of the file: the agent receives safe metadata, aggregate releases, stable artifact handles, and operation evidence while DuckDB executes locally.

This is not a chatbot wrapping `fetch`, DOM scraping, or a generic exploration playground. The frame is **custody with controlled release**: the agent may actuate the lab, but the custody kernel decides what may cross the agent-visible boundary.

## System Model

DuckStudio is a tower of linked abstractions:

1. **Revisioned workspace** is the deep module every operator crosses. Its interface is the domain commands. It owns `workspaceId`, monotonic `revision`, idempotency, single-flight operations, events, and atomic commit.
2. **Custody kernel** sits behind that interface and owns datasets, sensitivity policy, SQL inspection, release, cohort confirmation, and upload/release evidence.
3. **DuckDB execution plane** runs one bounded, read-only analytical statement in an isolated worker.
4. **Immutable artifact graph** makes every result addressable, inspectable, reusable, and attributable to its source and SQL.
5. **Safe projection plane** releases one policy-approved summary to tool envelopes, left-pane cards, and the shared canvas.
6. **Thin adapters** expose a subset of workspace commands as four WebMCP tools with one compact envelope. Human controls and the simulator may also dispatch `selectArtifact` and `cancelActiveOperation`.
7. **Human evidence plane** renders the same projection. It is never a second state store.

## Agent Control Plane

WebMCP registers exactly these four tools. They are a subset of the revisioned-workspace interface, not a second command set.

| Tool | Role |
|---|---|
| `duckdb_get_context` | Read-only bootstrap or delta read of capabilities, revision, dataset policy, schema digest, budgets, operations, artifacts, and legal next actions. |
| `duckdb_activate_dataset` | Activate a local preset with optimistic concurrency and idempotent retry. |
| `duckdb_execute_sql_to_canvas` | Validate, execute, create an immutable artifact, infer or apply a safe presentation, and select that artifact in one atomic command. |
| `duckdb_verify_zero_egress` | Return scoped upload, release, interceptor, and lineage evidence with explicit limitations. |

Human controls and the simulator also dispatch `selectArtifact` and `cancelActiveOperation` through the same workspace. Those commands are not WebMCP tools.

The shortest normal path is `duckdb_get_context` → `duckdb_execute_sql_to_canvas`. Activation is needed only when the desired dataset is not active. Verification is called when custody evidence is requested. Presentation may be omitted; the workspace infers a safe spec.

Every response uses one discriminated envelope:

- Success: `ok`, `schemaVersion`, `workspaceId`, `revision`, `data`, optional `contextDelta`, `warnings`, `nextActions`.
- Failure: `ok: false`, stable `error.code`, message, retryability, field details, current revision, and parameterized recovery actions.

Mutations require `expectedRevision` and `idempotencyKey`. Context supports `sinceRevision`. Results return artifact IDs rather than raw rows or ambient “last result” state.

## Operating Context

- One-day hackathon build → demo tape → Devpost submission.
- `PRODUCT.md` owns product intent and invariants. `docs/agent-system-design.md` owns protocol and state mechanics. `docs/prd.md` owns scope and acceptance. `docs/video-script.md` is derived evidence. `README.md` is onboarding. `ARCHITECTURE.md` constrains implementation architecture, `SECURITY.md` custody and release, `CONTRIBUTING.md` workflow.
- WebMCP runs in ChatGPT’s in-app browser or Chrome with WebMCP testing enabled. Setup lives in `CONTRIBUTING.md` and `README.md`.
- When `document.modelContext` is absent, the built-in Agent Simulator invokes the same domain commands and produces the same operations, artifacts, events, and UI projections. Only the language model is simulated.
- Browser file selection remains a human gesture. Tools may activate datasets already present in the workspace but may not invent paths or bypass browser permissions.
- No backward compatibility: obsolete tool names and state paths are removed rather than aliased.

## Safety and Resource Invariants

1. **One safe-release boundary.** Sensitive raw values appear neither in tool responses nor in agent-visible shared canvas views, logs, errors, or telemetry. A browser agent may observe the DOM, so “not returned by the tool” is not sufficient.
2. **Policy is dataset metadata.** `public_synthetic` permits row display on an artifact. `sensitive_aggregate_only` suppresses raw grids, direct identifiers, sensitive top values, and aggregate cohorts below `minimumCohortSize` (both one-day presets set `10`).
3. **Read-only SQL only.** Accept one `SELECT` or `WITH` statement with parameter bindings. Reject DDL, DML, transactions, multiple statements, `ATTACH`, `COPY`, `INSTALL`, `LOAD`, URLs, external scans, exports, unauthorized relations, and network-capable extensions. The full deny list lives in `docs/agent-system-design.md`.
4. **Bounded work.** Default command budgets are 5,000 ms execution, 10,000 materialized rows, 2,000 chart points, 8 KB tool summary, and 20 retained artifacts. Hard maxima are defined in `docs/agent-system-design.md`.
5. **Explicit state.** There is no global “last SQL” or “last result.” Views bind to an artifact by ID; activating a dataset paints no rows. Every artifact carries SQL, schema, lineage, policy release, and measured runtime metadata. Canvas tabs are not workspace state.
6. **Deterministic control.** Revisions prevent stale writes; idempotency keys make retries safe; stable error codes make recovery programmable.
7. **Accretive work.** Every successful analysis creates a reusable artifact. Refinements use an artifact as their source instead of repeating context or recomputing earlier work.
8. **Honest evidence.** The badge reads `0 Bytes of Dataset Uploaded`. It does not claim zero shell traffic, formal non-interference, SOC 2, or zero knowledge. Runtime telemetry is operational evidence, not a formal proof.

## Confirmed Product Contract

- One screen, two panes: agent operations and context on the left; selected artifact on the right with Insights, Data Grid, SQL & Lineage, and Custody views.
- Visible state includes workspace revision, active dataset, policy mode, selected artifact ID, operation status, and measured execution metrics.
- Two local synthetic presets:
  - `saas_churn`: 250,000 rows, approximately 14.2 MB, 14 columns including `tickets`, `churned`, `churn_rate`, and `mrr`; policy `public_synthetic`.
  - `healthcare_pii`: 100,000 rows with `diagnosis` and `mrn`; policy `sensitive_aggregate_only`.
- The seeded SaaS analysis computes, rather than hardcodes, Churn Rate `14.2%`, Avg Tickets `4.8 / mo`, and Impacted MRR `$182,400`, with a visible increase above five tickets.
- The healthcare preset visibly suppresses the raw grid and permits only policy-approved aggregates with cohorts of at least ten.
- `duckdb_execute_sql_to_canvas` atomically creates the artifact, infers or applies KPI/chart/grid presentation, and selects that artifact. It returns a compact safe summary and handle, never result rows. The summary is the projected KPI/chart spec plus measured values, not a dataset-specific struct.
- Egress monitoring covers `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, and `WebTransport`; evidence distinguishes dataset upload bytes from application traffic.
- License: MIT.

## Cut List

Multi-file join wizards, cloud/S3 connectors, multi-agent coordination, voice, routing, authentication, 3D charts, paid-model key flows, arbitrary file export, compliance claims, differential privacy, formal information-flow proofs, and additional demo datasets are out of scope.

## Brand Commitments

- **Name:** DuckStudio.
- **Badge:** `0 Bytes of Dataset Uploaded`.
- **Tone:** a legible analytical lab, not a brand film.
- **Tool names:** always exact; no friendly aliases.
- **Palette:** background `#0A0B0F`, surfaces `#161821`, borders `#2D3139`, cyan `#00F2FE`, WebMCP amber `#FFB347` reserved for tool operations and warnings.
- **Typography:** Inter for UI, Space Grotesk for metrics, JetBrains Mono for SQL, IDs, revisions, and logs.

## Product Principles

1. **Custody is the thesis.** Local execution matters only if release into tools and the shared DOM is also controlled.
2. **Bootstrap before action.** One compact context call tells an agent what exists, what is allowed, what it costs, and what to do next.
3. **Explicit beats ambient.** IDs, revisions, policy modes, and capability enums replace inference from UI state or prose.
4. **Atomic beats choreography.** One analysis command validates, executes, records lineage, infers or applies presentation, and selects the artifact; partial multi-tool UI states are eliminated.
5. **Every call compounds.** Successful work leaves immutable artifacts and delta-readable events that make the next call cheaper and more accurate.
6. **Errors teach recovery.** Failures include stable codes and legal next actions, not stack traces or generic advice.
7. **People and agents use one kernel.** Human controls, prompt chips, simulator, and WebMCP tools dispatch the same workspace commands. WebMCP exposes four of them; select and cancel remain on the workspace interface.
8. **Evidence is scoped and honest.** Claims name exactly what was measured, where, and with what limitations.
9. **The tape proves the system.** Demo beats derive from product acceptance criteria; they do not create a parallel fake path.
10. **Substance over scope.** The smallest coherent control system outranks a larger collection of disconnected features.
