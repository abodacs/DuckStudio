# DuckStudio — Agent Worker Demo

This is the recordable use case for the full custody arc. It is derived from
the PRD §8 demo contract, the file-drop step in docs/sales-pitch.md, and the
shot grammar/checklists in docs/video-script.md. It describes shipped behavior
only: the human file drop is a human-only workspace command, the agent
operates the four registered tools, and every tool response is the shared
duckstudio.webmcp/v1 envelope with no result rows.

## Goal and what the tape proves

The agent worker operates one local DuckStudio workspace while the custody
kernel governs both tool release and the shared canvas. The automated tape
proves, in one session:

- first paint is <code>rev 0 · no dataset</code> with the exact badge
  <code>0 Bytes of Dataset Uploaded</code>;
- a real <code>regional_sales.csv</code> drop becomes a local relation under
  <code>sensitive_aggregate_only</code>, without dataset upload;
- a bounded imported aggregate creates <code>a_01</code>, with a chart and a
  suppressed Rows view;
- <code>saas_churn</code> is activated, <code>duckdb_get_context</code> makes its
  state legible, and the canonical churn analysis computes <code>14.2%</code>,
  <code>4.8</code>, and <code>$182,400</code> into <code>a_02</code>;
- SQL, hash, lineage, measured runtime, policy, and artifact identity agree;
- <code>healthcare_pii</code> marks
  <code>mrn · direct identifier · omitted</code>, refuses raw or
  identifier-derived release, then permits one aggregate with
  <code>k ≥ 10</code> as <code>a_03</code> while the Rows view remains
  suppressed; and
- <code>duckdb_verify_zero_egress</code> reports zero dataset bytes and zero
  raw sensitive releases with the limitation
  <code>Runtime interception is operational evidence, not a formal proof.</code>

The video has no fabricated transcript cards, rows, timings, or audit claims.
The recorder asserts the actual envelopes and captures the product projection.
Measured runtimes remain measured; they are never targets.

## Cast and prerequisites

### Automated tape

- Node dependencies installed with <code>pnpm install</code>.
- The self-hosted DuckDB-WASM assets present under
  <code>public/duckdb/</code>; if they are missing, run
  <code>pnpm duckdb:download</code>.
- Playwright's Chromium installed
  (<code>pnpm exec playwright install chromium</code> if needed).
- Chromium with WebMCP enabled by the recorder's
  <code>--enable-features=WebMCPTesting</code> and
  <code>--enable-experimental-web-platform-features</code> arguments.
- <code>localhost</code>/<code>127.0.0.1</code> is the secure context for the
  flagged automated take.
- The recorder starts Vite on port 5199 when that port is not already serving
  the app. It reuses a live server there when one is already present.

### Manual ChatGPT tape

- A public HTTPS deployment, because ChatGPT's in-app browser cannot use this
  local Vite origin. The secure context is the deployed origin.
- ChatGPT's in-app browser with native WebMCP available to the page.
- A screen recorder configured for a readable 16:9 browser frame. Use the
  wording “agent” when native WebMCP is present; do not call the native agent
  a simulator.

## Full-arc beat table

Each row below is one recorder beat. <code>localRelation</code> is not a
guessed name: it is the exact <code>local_&lt;slug&gt;_&lt;4 hex&gt;</code> relation
read from the committed header after the real drop. Failed policy requests are
intentional and commit no revision, artifact, or canvas state. Mutation calls
use the current revision and a fresh idempotency key; reads never advance the
revision.

| # | Beat | Exact input or human gesture | Expected envelope and visible proof |
|---:|---|---|---|
| 1 | Empty shell | No tool call. Load the app. | No envelope is needed. Header is exactly <code>rev 0 · no dataset</code>; badge is exactly <code>0 Bytes of Dataset Uploaded</code>; no artifact card and no dataset rows exist. |
| 2 | Human gesture | Create a real <code>File</code> named <code>regional_sales.csv</code> with the recorder fixture, put it in a browser <code>DataTransfer</code>, dispatch <code>dragover</code>, then <code>drop</code> on <code>Drop a CSV here — it never leaves this tab.</code> | <code>importLocalFile</code> is human-only and is not on the four-tool surface, so there is no WebMCP envelope. The committed header is <code>rev 1 · localRelation · sensitive_aggregate_only</code>; the Activity pill says <code>Import file</code>; the badge is unchanged. The fixture has 120 rows: four regions with 30 rows each. |
| 3 | Agent context on the import | <code>duckdb_get_context({"scope":"summary"})</code> | <code>ok: true</code>, <code>schemaVersion: "duckstudio.webmcp/v1"</code>, <code>workspaceId: "ws_local_01"</code>, <code>revision: 1</code>; <code>data.activeDataset</code> names <code>localRelation</code> and <code>sensitive_aggregate_only</code>; <code>data.budgets</code> is present; <code>selectedArtifactId</code> is <code>null</code>; <code>recentArtifacts</code> is empty; <code>warnings</code> and <code>nextActions</code> are empty. There is no result-row array. |
| 4 | Imported aggregate and release guard | First prove the guard with the same aggregate plus <code>presentation.grid.visible: true</code>; then retry the safe chart-only presentation. The exact calls are in the input fixtures below. | The first envelope is <code>ok: false</code>, <code>revision: 1</code>, <code>error.code: "POLICY_DENIED"</code>, with <code>error.details.blockedFields: "grid"</code>; no artifact is committed. The safe retry is <code>ok: true</code>, <code>revision: 2</code>, and <code>data.artifact.artifactId: "a_01"</code>, source <code>localRelation</code>, row count <code>4</code>, chart <code>region → revenue</code>, and cohort minimum <code>10</code>. The imported release is <code>sensitive_aggregate_only</code>/<code>downgraded</code> with raw rows to tools and canvas both <code>0</code>. Charts shows the measured aggregate; Rows shows <code>Rows — suppressed by policy</code> and zero <code>[data-grid-row]</code> elements. |
| 5 | Activate <code>saas_churn</code> | <code>duckdb_activate_dataset({"datasetId":"saas_churn","expectedRevision":2,"idempotencyKey":"record-activate-saas-r2"})</code> | <code>ok: true</code>, <code>revision: 3</code>; <code>data.datasetId: "saas_churn"</code>; <code>policy: "public_synthetic"</code>; <code>rowCount: 250000</code>; <code>minimumCohortSize: 10</code>; a schema digest and byte estimate are present. Header is exactly <code>rev 3 · saas_churn · public_synthetic</code>. Activation itself paints no dataset rows. |
| 6 | Agent context on the preset | <code>duckdb_get_context({"scope":"summary"})</code> | <code>ok: true</code>, <code>revision: 3</code>; <code>data.activeDataset</code> is exactly the <code>saas_churn</code>/<code>public_synthetic</code>/<code>250000</code> state; budgets are present; <code>selectedArtifactId</code> is still <code>a_01</code>; the response has no result-row array. |
| 7 | Churn-vs-tickets analysis | <code>duckdb_execute_sql_to_canvas</code> with the exact <code>saas_churn</code> SQL and presentation fixture below, <code>expectedRevision: 3</code>, and <code>idempotencyKey: "record-saas-churn-r3"</code>. | <code>ok: true</code>, <code>revision: 4</code>; <code>data.artifact.artifactId: "a_02"</code>; source and lineage are <code>saas_churn</code>; the measured summary contains <code>Churn Rate = 0.142</code>, <code>Avg Tickets = 4.8</code>, and <code>Impacted MRR = 182400</code>, which render as <code>14.2%</code>, <code>4.8</code>, and <code>$182,400</code>; chart is a scatter with <code>tickets</code> on x and <code>churn_rate_pct</code> on y; release is <code>public_synthetic</code>/<code>allowed</code>; no result rows are returned. The UI shows the artifact and chart. |
| 8 | SQL & Lineage on <code>a_02</code> | Human view action only: click the <code>SQL & Lineage</code> tab while <code>a_02</code> is selected. | Tab choice does not mutate the workspace: revision remains <code>4</code>. The panel shows the exact canonical SQL, the first 16 characters plus <code>…</code> of its SHA-256 hash, <code>source saas_churn</code>, lineage <code>dataset:saas_churn → artifact:a_02</code>, release <code>allowed</code>, and measured <code>ms · rows · points</code>. |
| 9 | Activate healthcare, suppress, aggregate | Call activation at revision 4; read the schema; request the canonical healthcare aggregate with <code>presentation.grid.visible: true</code> to prove the raw-grid policy denial; then call the exact healthcare aggregate and presentation below at revision 5. Click <code>Rows</code> after <code>a_03</code> commits. | Activation is <code>ok: true</code>, <code>revision: 5</code>, with <code>datasetId: "healthcare_pii"</code> and policy <code>sensitive_aggregate_only</code>. The schema read is <code>ok: true</code> and contains <code>{name: "mrn", classification: "direct_identifier", omitted: true}</code> with no value. The raw-grid request is <code>ok: false</code>, remains at revision <code>5</code>, and has <code>error.code: "POLICY_DENIED"</code> plus <code>error.details.blockedFields: "grid"</code>; it creates no artifact. The safe aggregate is <code>ok: true</code>, <code>revision: 6</code>, artifact <code>a_03</code>, eight diagnosis cohorts, chart <code>diagnosis → patients</code>, <code>cohortMinimum: 10</code>, <code>rawRowsToSharedCanvas: 0</code>, and omitted direct identifier <code>mrn</code>. Rows shows <code>Rows — suppressed by policy</code> and no raw rows. |
| 10 | Verify custody | <code>duckdb_verify_zero_egress({"scope":"artifact","artifactId":"a_03"})</code> | <code>ok: true</code>, <code>revision: 6</code>; evidence scope is <code>artifact:a_03</code>; <code>datasetBytesUploaded: 0</code>; <code>rawSensitiveValuesReleasedToTools: 0</code>; <code>rawSensitiveValuesReleasedToSharedCanvas: 0</code>; policy is <code>sensitive_aggregate_only</code>; lineage ends in <code>artifact:a_03</code>; limitations include <code>Application shell traffic is outside dataset-upload accounting.</code> and <code>Runtime interception is operational evidence, not a formal proof.</code>. |
| 11 | Close | No tool call. Switch to <code>Zero Upload</code> if needed and hold the whole frame. | One shot contains the selected <code>a_03</code> artifact card, <code>healthcare_pii · sensitive_aggregate_only</code>, the exact badge <code>0 Bytes of Dataset Uploaded</code>, and the scoped evidence card. The recorder prints every beat as <code>PASS</code> and exits 0. |

### Exact input fixtures

These are the complete JSON inputs used by the recorder. The only substituted
value is <code>localRelation</code>, which is discovered from the real imported
header.

Imported aggregate SQL:

~~~sql
SELECT region, ROUND(SUM(amount), 2) AS revenue FROM localRelation GROUP BY region ORDER BY revenue DESC
~~~

Policy-denial input in beat 4:

~~~json
{
  "source": { "kind": "dataset", "id": "localRelation" },
  "sql": "SELECT region, ROUND(SUM(amount), 2) AS revenue FROM localRelation GROUP BY region ORDER BY revenue DESC",
  "bindings": {},
  "presentation": {
    "chart": { "type": "bar", "x": "region", "y": "revenue", "title": "Revenue by region" },
    "grid": { "visible": true }
  },
  "expectedRevision": 1,
  "idempotencyKey": "record-import-grid-denial-r1"
}
~~~

Safe imported aggregate input:

~~~json
{
  "source": { "kind": "dataset", "id": "localRelation" },
  "sql": "SELECT region, ROUND(SUM(amount), 2) AS revenue FROM localRelation GROUP BY region ORDER BY revenue DESC",
  "bindings": {},
  "presentation": {
    "chart": { "type": "bar", "x": "region", "y": "revenue", "title": "Revenue by region" }
  },
  "expectedRevision": 1,
  "idempotencyKey": "record-import-aggregate-r1"
}
~~~

<code>saas_churn</code> SQL (kept byte-for-byte with the canonical SQL
imported by the e2e agent driver):

~~~sql

SELECT
  tickets,
  COUNT(*) AS accounts,
  SUM(CASE WHEN churned THEN 1 ELSE 0 END) AS churned_accounts,
  SUM(CASE WHEN churned THEN mrr ELSE 0 END) AS churned_mrr,
  ROUND(100.0 * SUM(CASE WHEN churned THEN 1 ELSE 0 END) / COUNT(*), 1) AS churn_rate_pct,
  ROUND(SUM(SUM(CASE WHEN churned THEN 1 ELSE 0 END)) OVER () / SUM(COUNT(*)) OVER (), 4) AS churn_rate,
  ROUND(SUM(tickets * COUNT(*)) OVER () / SUM(COUNT(*)) OVER (), 4) AS avg_tickets,
  ROUND(SUM(SUM(CASE WHEN churned THEN mrr ELSE 0 END)) OVER (), 2) AS impacted_mrr
FROM saas_churn
GROUP BY tickets
ORDER BY tickets

~~~

<code>saas_churn</code> presentation:

~~~json
{
  "kpis": [
    { "label": "Churn Rate", "column": "churn_rate", "format": "percent" },
    { "label": "Avg Tickets", "column": "avg_tickets", "format": "decimal" },
    { "label": "Impacted MRR", "column": "impacted_mrr", "format": "currency_usd" }
  ],
  "chart": {
    "type": "scatter",
    "x": "tickets",
    "y": "churn_rate_pct",
    "title": "Churn rate by support tickets",
    "threshold": { "column": "tickets", "value": 5, "label": "churn accelerates above 5 tickets" }
  }
}
~~~

Healthcare policy-denial input (the canonical aggregate with a raw-grid request):

~~~json
{
  "source": { "kind": "dataset", "id": "healthcare_pii" },
  "sql": "\nSELECT\n  diagnosis,\n  COUNT(*) AS patients,\n  ROUND(AVG(visit_count), 2) AS avg_visits,\n  ROUND(AVG(billed_amount), 2) AS avg_billed_amount\nFROM healthcare_pii\nGROUP BY diagnosis\nHAVING COUNT(*) >= 10\nORDER BY patients DESC\n",
  "bindings": {},
  "presentation": {
    "kpis": [
      { "label": "Patients", "column": "patients", "format": "integer" },
      { "label": "Avg Visits", "column": "avg_visits", "format": "decimal" },
      { "label": "Avg Billed", "column": "avg_billed_amount", "format": "currency_usd" }
    ],
    "chart": {
      "type": "bar",
      "x": "diagnosis",
      "y": "patients",
      "title": "Cohort sizes by diagnosis (every cohort k ≥ 10)"
    },
    "grid": { "visible": true }
  },
  "expectedRevision": 5,
  "idempotencyKey": "record-healthcare-grid-denial-r5"
}
~~~

Healthcare aggregate SQL and presentation:

~~~sql

SELECT
  diagnosis,
  COUNT(*) AS patients,
  ROUND(AVG(visit_count), 2) AS avg_visits,
  ROUND(AVG(billed_amount), 2) AS avg_billed_amount
FROM healthcare_pii
GROUP BY diagnosis
HAVING COUNT(*) >= 10
ORDER BY patients DESC

~~~

~~~json
{
  "source": { "kind": "dataset", "id": "healthcare_pii" },
  "sql": "\nSELECT\n  diagnosis,\n  COUNT(*) AS patients,\n  ROUND(AVG(visit_count), 2) AS avg_visits,\n  ROUND(AVG(billed_amount), 2) AS avg_billed_amount\nFROM healthcare_pii\nGROUP BY diagnosis\nHAVING COUNT(*) >= 10\nORDER BY patients DESC\n",
  "bindings": {},
  "presentation": {
    "kpis": [
      { "label": "Patients", "column": "patients", "format": "integer" },
      { "label": "Avg Visits", "column": "avg_visits", "format": "decimal" },
      { "label": "Avg Billed", "column": "avg_billed_amount", "format": "currency_usd" }
    ],
    "chart": {
      "type": "bar",
      "x": "diagnosis",
      "y": "patients",
      "title": "Cohort sizes by diagnosis (every cohort k ≥ 10)"
    }
  },
  "expectedRevision": 5,
  "idempotencyKey": "record-healthcare-aggregate-r5"
}
~~~

## Automated recording how-to

Run from the repository root:

~~~sh
node .hallmark/record-demo.mjs
~~~

The recorder:

1. serves the app from Vite on <code>http://127.0.0.1:5199/</code> (or reuses
   that already-running server);
2. launches flagged Chromium with a 1920×1080 viewport and
   <code>recordVideo: { dir, size: { width: 1920, height: 1080 } }</code>;
3. waits for the real agent surface and requires native
   <code>document.modelContext</code> registration with exactly the four
   canonical tools;
4. performs the real <code>DataTransfer</code> drag-over/drop, then invokes tools
   through <code>window.__duckstudioAgentSurface.invoke</code> with tracked
   revisions and unique idempotency keys;
5. waits 600–1200 ms between beats, holds each proof frame for narration, and
   writes stills beside the video;
6. fails immediately with the beat number and assertion message if any envelope,
   policy, ID, header, badge, SQL, hash, lineage, or DOM proof is wrong; and
7. closes the video context, writes <code>demo.webm</code>, and, when
   <code>ffmpeg</code> is available, writes <code>demo.mp4</code> and a
   <code>poster.jpg</code> frame.

Output is <code>.hallmark/demo-recording/</code>:

~~~text
.hallmark/demo-recording/
├── demo.webm
├── demo.mp4       # when ffmpeg is available
├── poster.jpg     # when ffmpeg is available
└── 01-*.png … 11-*.png
~~~

The final console checklist includes the selected surface, actual revisions,
artifact IDs, video duration when <code>ffprobe</code> is available, and the
ffmpeg result. If ffmpeg is absent, the recorder keeps the playable WebM and
says that no MP4/poster was produced.

## Manual ChatGPT in-app-browser recording guide

This is the authentic agent take. It cannot be driven from this environment,
and ChatGPT's in-app browser cannot be treated as a local-file picker. The
automated tape owns the <code>regional_sales.csv</code> human gesture; the
manual tape uses the seeded local presets and proves the same agent/custody
contract over public HTTPS.

### Deploy

Build the shipped static origin and deploy <code>dist</code>:

~~~sh
pnpm build
npx wrangler pages deploy dist
~~~

Reuse the existing <code>https://…pages.dev</code> URL if it already serves the
current build. Open that public HTTPS URL in ChatGPT's in-app browser and wait
for the DuckStudio shell to finish warming. Do not record a localhost URL in
this take.

### Scripted prompt sequence

Paste these prompts one at a time. Let ChatGPT use the tool response's current
revision and next action; do not invent a revision, artifact, KPI, runtime, or
SQL variant in the transcript.

1. **Open and bootstrap**

   > Open <code>&lt;PUBLIC_HTTPS_URL&gt;</code> in the in-app browser. Once
   > DuckStudio is ready, call <code>duckdb_get_context</code> with exactly
   > <code>{ "scope": "summary" }</code>. Report the workspace ID, revision,
   > active dataset, policy, budgets, and legal next actions. Confirm that the
   > response contains no result rows.

2. **Activate the public preset**

   > Activate <code>saas_churn</code> with
   > <code>duckdb_activate_dataset</code>, using the current revision from the
   > context response and a fresh idempotency key. Report the returned
   > <code>public_synthetic</code> policy and revision. Do not ask for rows.

3. **Run the canonical churn analysis**

   > Follow the activation envelope's
   > <code>duckdb_execute_sql_to_canvas</code> next action exactly. Keep its
   > canonical SQL, <code>{}</code> bindings, current revision, and fresh
   > idempotency key. Report the committed artifact ID and measured summary,
   > then leave the chart visible. Do not paraphrase the SQL or request raw
   > result rows.

4. **Inspect the artifact**

   > Keep the selected artifact visible. Show <code>SQL & Lineage</code>, then
   > <code>Rows</code>, then return to <code>Charts</code>. Point out the exact
   > SQL, hash, lineage, measured runtime, release policy, and the computed
   > <code>14.2%</code>, <code>4.8</code>, and <code>$182,400</code> values. Keep
   > the header badge in frame.

5. **Switch to the sensitive preset**

   > Activate <code>healthcare_pii</code> with
   > <code>duckdb_activate_dataset</code>, using the current revision and a
   > fresh idempotency key. Then call <code>duckdb_get_context</code> with
   > <code>{ "scope": "schema", "datasetId": "healthcare_pii" }</code>.
   > Confirm that <code>mrn</code> is classified as
   > <code>direct_identifier</code> and marked omitted; do not reveal a value.

6. **Prove safe release and suppression**

   > Run the canonical healthcare aggregate with
   > <code>duckdb_execute_sql_to_canvas</code>, using the current revision,
   > <code>{}</code> bindings, and a fresh idempotency key. The statement groups
   > by <code>diagnosis</code>, counts patients, measures average visits and
   > billed amount, uses <code>HAVING COUNT(*) &gt;= 10</code>, and orders by
   > patients descending. Show the resulting artifact in Charts, then open Rows
   > and confirm the <code>sensitive_aggregate_only</code> policy suppresses raw
   > records.

7. **Verify custody and close**

   > Call <code>duckdb_verify_zero_egress</code> with exactly
   > <code>{ "scope": "artifact", "artifactId": "&lt;the healthcare artifact ID&gt;" }</code>.
   > Read the scoped evidence: <code>datasetBytesUploaded: 0</code>, zero raw
   > sensitive releases to tools and shared canvas, policy, lineage, monitored
   > transports, and both limitations. Keep the selected artifact, policy, and
   > exact <code>0 Bytes of Dataset Uploaded</code> badge together for the
   > closing frame. Say “Operational evidence; not a formal proof,” not “formal
   > proof.”

The in-app browser may present native tool activity differently from the
automated stills. That is expected. The claims and spellings are not flexible:
use <code>duckdb_get_context</code>, <code>duckdb_activate_dataset</code>,
<code>duckdb_execute_sql_to_canvas</code>, <code>duckdb_verify_zero_egress</code>,
<code>public_synthetic</code>, <code>sensitive_aggregate_only</code>, and
<code>0 Bytes of Dataset Uploaded</code> exactly.

### Pre-roll checklist

Borrowed from docs/video-script.md §3:

- [ ] Build/deploy the current revision and open the public HTTPS URL.
- [ ] Warm the shell once, then hard-refresh for the take.
- [ ] Hide third-party wordmarks, keys, environment data, and unrelated tabs.
- [ ] Confirm the page exposes native WebMCP tools; when it does, say “agent,”
      not “simulator.”
- [ ] Confirm the empty first paint has no dataset, artifact, rows, fake timing,
      or benchmark.

### Capture checklist

Borrowed from docs/video-script.md §4 and §8:

- [ ] Keep the whole two-pane shell readable when showing workspace, policy,
      revision, and badge (WS).
- [ ] Use close framing for context/tool activity, Charts, Rows, SQL & Lineage,
      and Zero Upload (CU-left/CU-right/CU-policy).
- [ ] Move the cursor deliberately: move, brief hover, click; never wander.
- [ ] Hold the context → analysis → artifact transition long enough for the
      viewer to read the exact strings.
- [ ] Keep <code>mrn</code> omitted and the healthcare Rows view visibly
      suppressed.
- [ ] Keep <code>datasetBytesUploaded: 0</code> and both zero sensitive-release
      counters in the custody frame.
- [ ] End with the selected artifact, policy, and exact badge in one shot.
- [ ] Apply the mute test: the frame must still communicate artifact identity,
      policy, controlled release, and zero dataset upload without narration.

### Honest wording

Use “local,” “controlled release,” “scoped custody evidence,” and “operational
evidence.” Do not say “no application traffic,” “formal proof,” “compliance
certification,” or “zero knowledge.” The badge counts dataset uploads only;
application-shell traffic is explicitly outside that accounting.
