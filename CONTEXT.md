# DuckStudio

A zero-upload, in-browser data lab where people and browser agents operate one local analytical workspace. This glossary holds the shared language — tool names, policy terms, state vocabulary — at one spelling across product, contract, and code.

## Language

### Workspace and state

**Custody**:
The controlling idea that datasets stay inside the browser tab and only policy-approved releases cross into tool responses or the shared canvas.
_Avoid_: data privacy, security, isolation

**Revisioned workspace**:
The single control module every operator — human, agent, simulator — crosses to act. It owns revision counting, idempotency, single-flight operations, events, and atomic commit.
_Avoid_: store, state manager, backend

**Revision**:
The workspace's monotonic counter: starts at 0, increments exactly once per committed mutation, never on reads.
_Avoid_: version

**Idempotency key**:
The caller-supplied key that makes mutation retries deterministic: the same key with the same input replays the original result; the same key with different input is a conflict.
_Avoid_: request ID, nonce

**Operation**:
One single-flight piece of mutating work (`activate_dataset` or `run_analysis`) with a measured status; at most one runs at a time.
_Avoid_: job, task, request

**Domain command**:
A workspace verb (`getContext`, `activateDataset`, `runAnalysis`, `verifyCustody`, `selectArtifact`, `cancelActiveOperation`). Commands and WebMCP tools are two vocabularies for one seam and deliberately do not share names; never rename one to match the other.
_Avoid_: using "command" and "tool" interchangeably

**Event**:
The immutable record of one committed workspace change, retained in a bounded buffer and readable as a delta from a revision.
_Avoid_: log entry, telemetry

**Capability**:
An enum value in context declaring what this workspace can do (including `webmcp_native` vs `simulator_only`), so agents read state instead of inferring it from the UI.
_Avoid_: feature, mode

### Custody and release

**Custody kernel**:
The one decision module behind the workspace that owns dataset policy, SQL inspection, release, cohort confirmation, and evidence. Its pieces are never invoked directly.
_Avoid_: security module, egress audit, sanitizer

**Dataset policy**:
Per-dataset metadata governing release: `public_synthetic` permits raw rows on an artifact; `sensitive_aggregate_only` permits aggregates only, after cohort checks, and never a raw grid.
_Avoid_: sensitivity level, redaction mode

**Minimum cohort size**:
The smallest group an aggregate may reveal on a sensitive dataset; any smaller cohort denies the release. Both presets set 10.
_Avoid_: k-anonymity, threshold

**Zero egress**:
The measured evidence that no dataset bytes were uploaded and no raw sensitive values were released, gathered by transport interception and always reported with its limitations. Operational evidence, not a formal proof.
_Avoid_: zero knowledge, "no data ever leaves the browser", proof

**Badge**:
The persistent custody indicator whose copy is exactly `0 Bytes of Dataset Uploaded`; it counts dataset uploads only, never application shell traffic.
_Avoid_: reworded badge copy

**Release**:
The custody kernel's decision to let analysis output cross to tools or the shared canvas, recorded on the artifact as `allowed` or `downgraded`.
_Avoid_: publish, export

### Artifacts and presentation

**Analysis artifact**:
The immutable, addressable result of one successful analysis, carrying its SQL, schema, lineage, release decision, presentation, and measured metrics. Refinements read it as a source; nothing rewrites it.
_Avoid_: result, output, "last result"

**Lineage**:
The recorded chain of the dataset and prior artifacts an artifact was derived from.
_Avoid_: provenance, dependency graph

**Bindings**:
Named values supplied separately from the SQL statement so the kernel can redact them; raw binding values appear nowhere — not in envelopes, canvas, errors, or logs.
_Avoid_: variables, string-interpolated values

**Presentation**:
The committed KPI, chart, and grid specification on an artifact — inferred when omitted (policy-aware by construction); a supplied element that crosses policy denies the whole request (`POLICY_DENIED` + `permittedPresentation`), it is never stripped. It never includes which view tab is open.
_Avoid_: dashboard, visualization, view config

**Safe summary**:
The one policy-approved summary (KPIs, chart, schema, lineage) shared verbatim by tool envelopes, left-pane cards, and canvas views.
_Avoid_: response body, tool output

**One-read budget**:
The byte cap (default 8 KB) that keeps the summary actionable from a single bounded read; measured in bytes, never exceeded silently.
_Avoid_: token limit, character cap

### Surfaces and protocol

**WebMCP tool**:
One of exactly four registered functions: `duckdb_get_context`, `duckdb_activate_dataset`, `duckdb_execute_sql_to_canvas`, `duckdb_verify_zero_egress`. Tool names are always exact, with no friendly aliases, and use the execution verbs get, activate, execute, verify.
_Avoid_: `duckdb_run_analysis`, `duckdb_verify_custody` (removed, not aliased), "MCP server"

**Envelope**:
The single discriminated response shape for every command: success carries `data`, optional `contextDelta`, `warnings`, and `nextActions`; failure carries a stable error code with retryability and recovery actions. It is the trust seam.
_Avoid_: response wrapper, payload, return value

**Next actions**:
Bounded, executable suggestions in every envelope — a tool call or a named human gesture — never prose advice.
_Avoid_: hints, tips

**Human gesture**:
The browser file selection only a person can perform, surfaced as a named human action in `nextActions` and never simulated, fabricated, or bypassed by tools.
_Avoid_: file upload (nothing is uploaded)

**Canvas**:
The shared, agent-visible view of the selected artifact across four tabs (Insights, Data Grid, SQL & Lineage, Custody). Tab choice is view state, never workspace state.
_Avoid_: dashboard, right pane

**Safe projection**:
The single derived view of committed state that every surface renders — envelopes, cards, and canvas all draw from one projection; it is never a second state store.
_Avoid_: view model, second store, cache

**Adapter**:
A thin entry surface (human UI, prompt chips, simulator, WebMCP) that validates input and dispatches domain commands, owning no revision, policy, or SQL logic.
_Avoid_: controller, integration

**Agent Simulator**:
The built-in client used when native WebMCP is absent; it dispatches the same commands and must produce the same events, artifacts, and projections — only the language model is simulated.
_Avoid_: mock agent, demo mode, fake mode

### Datasets and demo

**Preset**:
A checked-in local synthetic dataset usable without any upload: `saas_churn` (policy `public_synthetic`) and `healthcare_pii` (policy `sensitive_aggregate_only`).
_Avoid_: sample data, demo upload

**Dataset**:
A local relation with a schema digest, row count, and policy. Activation makes it the analysis source but paints no rows — views bind only to artifacts.
_Avoid_: table, file
