# DuckStudio — Agent-Native Demo Video Contract

**The WebMCP Challenge** · public YouTube · target runtime 2:45 · hard cap 2:55
**Format:** 1920×1080, 60 fps if smooth, otherwise 30 fps · stereo voiceover · burned-in captions

This tape proves one system: a browser agent can understand a governed local workspace, perform useful analysis atomically, leave reusable lineage, and verify custody without receiving the dataset.

## 1. The Sentence to Remember

> The agent can operate the database in this tab, but DuckStudio—not the model—keeps custody and decides what may cross into tools or the shared canvas.

If the tape is muted, the artifact handle, policy label, safe-release indicator, and zero-dataset-upload badge must still communicate this.

## 2. Scoring Map

| Criterion | What the tape proves | Beat |
|---|---|---|
| **WebMCP Leverage** | Compact context bootstrap, atomic page-local analysis, artifact handles, and custody evidence over state inaccessible to a server API. | 3–4, 7 |
| **Execution** | One revisioned workspace drives tool cards, artifact, KPIs, chart, grid, SQL, lineage, and policy on one screen. | 2–6 |
| **Potential Impact** | Sensitive local records remain under a shared safe-release policy for both tools and DOM. | 1, 6–7 |
| **Creativity & Ambition** | WebMCP acts as a local analytical control plane whose work compounds into immutable artifacts. | 3–5, 8 |

## 3. Pre-Roll

Keep these out of the submitted cut:

- Enable Chrome WebMCP testing and remote debugging when required.
- Warm the app shell once, then hard-refresh for the take.
- Keep DevTools Network available for optional labeled B-roll.
- Hide third-party wordmarks and all keys or environment data.
- Verify both adapters: native WebMCP when present, Agent Simulator otherwise.
- Confirm both adapters dispatch the same domain commands; no tape-only setters or mocked cards.
- Confirm first paint has no dataset, artifact, or fake benchmark.

When native WebMCP is absent, say “agent,” not “simulator.” The visible capability chip may read `simulator_only · same workspace`.

## 4. Shot Grammar

| Code | Meaning |
|---|---|
| **WS** | Whole two-pane lab with dataset, policy, revision, and upload badge readable |
| **CU-left** | Context, tool operation, error, and artifact cards |
| **CU-right** | Insights, Data Grid, SQL & Lineage, or Custody projection |
| **CU-policy** | Dataset policy plus safe-release state |
| **CODE** | Four to six seconds of exact registration/command source |
| **POP** | Instant cut; no crossfade |

Cursor language: move, brief hover, click. Never wander.

## 5. Picture-Lock

### TITLE — 0:00–0:03

**VISUAL:** Black. `DuckStudio`. Subline: `Agent-native local data lab · WebMCP`.

**VO:** Silence.

### BEAT 1 — Custody, not locality alone — 0:03–0:20

**VISUAL:** WS of empty lab. Header shows `no dataset`, `rev 0`, and `0 Bytes of Dataset Uploaded`.

**SUPER:** `Local execution · controlled release`

**VO:**

> A patient file or finance ledger cannot be uploaded to a model. But keeping SQL local is not enough: a browser agent can also see tool output and the page. DuckStudio governs both. The agent may operate the lab; the custody kernel controls release.

**CUT:** CU-policy showing no active policy and no raw data.

### BEAT 2 — Activate governed local data — 0:20–0:35

**VISUAL:** Click `250k SaaS Churn`. Header becomes `saas_churn · public_synthetic · rev 1`. Data Grid stays empty: activation does not paint rows.

**SUPER:** `250,000 seeded rows · local RAM · revision 1`

**VO:**

> This preset creates two hundred and fifty thousand seeded rows inside DuckDB-WASM. Activation is an explicit workspace transition. The dataset, its policy, and revision are now visible to both operators.

Do not speak a fixed load time. If shown, it must be measured.

### BEAT 3 — One read makes the workspace legible — 0:35–0:55

**VISUAL:** CU-left. Send `Analyze churn against support tickets.` Amber pill:

`duckdb_get_context · readOnlyHint`

Result card:

`ws_local_01 · rev 1 · saas_churn · public_synthetic`
`14 cols · budget 5s / 10k rows / 2k points · no rows returned`

**SUPER:** `One bounded read: state · policy · budget · legal next actions`

**VO:**

> The agent starts with one compact context call. It gets stable IDs, the current revision, safe schema, policy, budgets, and legal next actions. It does not scrape the interface or spend tokens reconstructing state from chat.

### BEAT 4 — One atomic analysis leaves an artifact — 0:55–1:25

**VISUAL:** Hold CU-left until one operation completes:

`duckdb_execute_sql_to_canvas · op_01 · rev 1 → 2`

Then artifact card:

`a_01 · source saas_churn · safe summary · no rows returned`

Right pane atomically lands:

- Churn Rate `14.2%`;
- Avg Tickets `4.8 / mo`;
- Impacted MRR `$182,400`;
- scatter with a visible increase above five tickets.

**OPTIONAL CODE INSERT:**

```ts
document.modelContext.registerTool({
  name: "duckdb_execute_sql_to_canvas",
  description: "Run one bounded local analysis and create an immutable artifact.",
  inputSchema: runAnalysisSchema,
  execute: (input) => workspace.runAnalysis(input)
})
```

**VO:**

> One analysis command carries the source, read-only SQL, parameter bindings, expected revision, and retry key. DuckStudio infers a safe presentation, validates once, executes once, creates artifact `a_01`, and updates the canvas atomically. The model receives a projected summary and handle—never result rows.

**SUPER:** `One command · one commit · one reusable artifact`

### BEAT 5 — Inspectability and accretion — 1:25–1:48

**VISUAL:** CU-right. Select `SQL & Lineage`. Show exact SQL, hash, `saas_churn → a_01`, policy decision, measured runtime, materialized rows, and chart points. Switch to Data Grid and scroll, then back to Insights.

**SUPER:** `Artifact a_01 · SQL · hash · lineage · measured cost`

**VO:**

> The SQL is not ambient “last state.” It belongs to an immutable artifact with source, hash, lineage, release decision, and measured cost. A later analysis can use `a_01` directly instead of repeating this work or context.

### BEAT 6 — Shared safe-release boundary — 1:48–2:10

**VISUAL:** Activate `Healthcare PII`. Header becomes `healthcare_pii · sensitive_aggregate_only`. Context card marks `mrn · direct identifier · omitted`. Select Data Grid: show policy suppression panel, no records. Optionally show one aggregate with cohort size at least ten.

**SUPER:** `Tool payload: no rows · Shared canvas: raw grid suppressed · k ≥ 10`

**VO:**

> Switch to clinical records and the same system tightens its release policy. MRN is an omitted direct identifier. Tool payloads still contain no rows, and now the shared grid is suppressed too. Only aggregates whose cohorts contain at least ten records may cross the boundary.

### BEAT 7 — Evidence with scope and limits — 2:10–2:30

**VISUAL:** Run `duckdb_verify_zero_egress` scoped to the selected artifact or workspace. Render a permanent card:

- `datasetBytesUploaded: 0`;
- `rawSensitiveValuesReleasedToTools: 0`;
- `rawSensitiveValuesReleasedToSharedCanvas: 0`;
- monitored transports;
- policy and lineage;
- `Operational evidence · not a formal proof`.

If the custody card pulses the badge, that is the canvas painting the same evidence snapshot; the read itself does not mutate chrome.

**SUPER:** `Scoped custody evidence · explicit limitations`

**VO:**

> Custody is itself inspectable. This read-only tool reports dataset uploads, sensitive releases into tools and canvas, monitored transports, policy, and lineage. It also states the limit: runtime telemetry is operational evidence, not a formal proof.

### BEAT 8 — Close on the system — 2:30–2:45

**VISUAL:** WS. Keep artifact card, policy label, and badge together. End card:

```text
DuckStudio
Agent-native local data lab

context → atomic analysis → immutable artifact → custody evidence

duckdb_get_context
duckdb_activate_dataset
duckdb_execute_sql_to_canvas
duckdb_verify_zero_egress

MIT · public repo · live URL on Devpost
```

**VO:**

> WebMCP is the fit because the governed workspace lives where a server cannot. One context read, one atomic analysis, reusable lineage, and controlled release: the agent drives the lab without taking the dataset.

Hold two seconds, then hard cut.

## 6. Teleprompter Copy

> A patient file or finance ledger cannot be uploaded to a model. But keeping SQL local is not enough: a browser agent can also see tool output and the page. DuckStudio governs both. The agent may operate the lab; the custody kernel controls release.
>
> This preset creates two hundred and fifty thousand seeded rows inside DuckDB-WASM. Activation is an explicit workspace transition. The dataset, its policy, and revision are now visible to both operators.
>
> The agent starts with one compact context call. It gets stable IDs, the current revision, safe schema, policy, budgets, and legal next actions. It does not scrape the interface or spend tokens reconstructing state from chat.
>
> One analysis command carries the source, read-only SQL, parameter bindings, expected revision, and retry key. DuckStudio infers a safe presentation, validates once, executes once, creates artifact `a_01`, and updates the canvas atomically. The model receives a projected summary and handle—never result rows.
>
> The SQL is not ambient “last state.” It belongs to an immutable artifact with source, hash, lineage, release decision, and measured cost. A later analysis can use `a_01` directly instead of repeating this work or context.
>
> Switch to clinical records and the same system tightens its release policy. MRN is an omitted direct identifier. Tool payloads still contain no rows, and now the shared grid is suppressed too. Only aggregates whose cohorts contain at least ten records may cross the boundary.
>
> Custody is itself inspectable. This read-only tool reports dataset uploads, sensitive releases into tools and canvas, monitored transports, policy, and lineage. It also states the limit: runtime telemetry is operational evidence, not a formal proof.
>
> WebMCP is the fit because the governed workspace lives where a server cannot. One context read, one atomic analysis, reusable lineage, and controlled release: the agent drives the lab without taking the dataset.

Recount the final recorded script after edits. Cut adjectives before tool names, policies, or limitations.

## 7. Captions and Supers

Burn captions from the final teleprompter take. Keep exact strings intact:

- `duckdb_get_context`
- `duckdb_activate_dataset`
- `duckdb_execute_sql_to_canvas`
- `duckdb_verify_zero_egress`
- `document.modelContext.registerTool`
- `sensitive_aggregate_only`
- `0 Bytes of Dataset Uploaded`

Use cyan for conceptual supers and amber only for tool operations and warnings.

## 8. Recording Checklist

**State and contracts**

- [ ] First paint is empty at revision 0.
- [ ] SaaS activation visibly changes dataset, policy, and revision.
- [ ] Context response is under 8 KB and contains no rows.
- [ ] One analysis operation creates exactly one artifact and one atomic presentation.
- [ ] KPI values are computed from the seed.
- [ ] SQL, hash, lineage, artifact ID, policy, revision, and measured metrics agree.
- [ ] Healthcare Data Grid is suppressed and `mrn` is marked omitted.
- [ ] Healthcare aggregate, if shown, has no cohort below ten.
- [ ] Custody card is scoped and includes both evidence and limitations.
- [ ] Tool names match registration exactly.
- [ ] Native and simulator paths produce equivalent operations and artifacts.

**Capture**

- [ ] Header badge reads `0 Bytes of Dataset Uploaded`.
- [ ] No third-party trademarks, keys, fake timings, or compliance claims appear.
- [ ] Browser scale keeps IDs, revision, policy, and badge readable.
- [ ] Capture multiple takes of context → analysis → artifact.
- [ ] Export under 2:55 with burned captions and clear audio.
- [ ] YouTube title: `DuckStudio — Agent-Native Local Data Lab on WebMCP`.
- [ ] Description includes live URL, repo URL, four tool names, and safe-release limitation.

## 9. Backup Cut

| Time | Proof |
|---|---|
| 0:00 | Empty lab, policy thesis, upload badge |
| 0:12 | Activate SaaS preset |
| 0:20 | Context response |
| 0:32 | Atomic analysis and artifact |
| 0:55 | SQL & Lineage |
| 1:08 | Healthcare grid suppression |
| 1:22 | Custody evidence and close |

Do not remove the context call, artifact identity, or safe-release proof; those are the agent-native story.

## 10. Devpost Copy

**Why WebMCP is a strong fit.**
The governed dataset and analytical workspace live in browser memory. A server API cannot operate on them without uploading the file, while WebMCP can actuate the page-local custody and execution system directly.

**Better user experience.**
One bounded context read gives the agent stable IDs, revision, policy, schema, budgets, and legal next actions. One atomic analysis creates an inspectable artifact with SQL, lineage, measured cost, KPIs, and chart—without fragile multi-call choreography.

**What people and agents can do together that was impossible before.**
An analyst can delegate local computation while DuckStudio retains custody and controls release into both tools and the agent-visible DOM. Subsequent work builds on immutable artifact handles instead of repeatedly exposing context or recomputing results.

**How WebMCP was implemented.**
Four imperative tools—`duckdb_get_context`, `duckdb_activate_dataset`, `duckdb_execute_sql_to_canvas`, and `duckdb_verify_zero_egress`—are a subset of the revisioned-workspace interface. They use one schema module plus runtime validation, a shared response envelope, optimistic revisions, idempotent retries, bounded DuckDB-WASM execution, immutable artifact lineage, one safe projection, and scoped custody telemetry. Human controls, native WebMCP, and the simulator share that workspace.

## 11. Director’s Last Note

The winning frame is no longer merely an amber pill beside a zero badge. It is the **artifact handle, sensitive release policy, and zero-dataset-upload badge in one shot**. Together they show useful agent work, durable understanding, and retained custody.
