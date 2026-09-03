# Derived from docs/prd.md §4, §10 and docs/agent-system-design.md §7, §8, §10, §14, §15.
# Canonical documents own the facts; this file must not invent behavior.

@agent @webmcp
Feature: An agent operates the local data lab through the WebMCP control plane
  As a browser agent acting for an analyst under an egress ban
  I want to bootstrap, analyze, refine, and verify custody through four registered WebMCP tools
  In order to complete bounded analysis on data I must never take custody of

  Exactly four tools are registered: `duckdb_get_context`, `duckdb_activate_dataset`,
  `duckdb_execute_sql_to_canvas`, `duckdb_verify_zero_egress`. They are a subset of the
  revisioned workspace interface, not a second command set. Every response uses one
  discriminated envelope ("duckstudio.webmcp/v1") and mutations require `expectedRevision`
  plus `idempotencyKey`.

  Background:
    Given the DuckStudio page is open in a WebMCP-capable browser
    And each of the four tools is registered exactly once with its full JSON Schema
    And read tools carry the "readOnlyHint"

  # ---------------------------------------------------------------------------

  @PRD @ASD-1
  Rule: Bootstrap before action — one read makes the workspace actionable

    Scenario: A single context read is sufficient to choose a legal next action
      When the agent calls "duckdb_get_context" for a full read
      Then the envelope succeeds with "schemaVersion" "duckstudio.webmcp/v1", the workspace id, and the current revision
      And the summary under 8 KB includes capabilities, active policy, schema digest, budgets, operations, artifacts, and legal next actions
      And no result rows are included
      And the agent can choose its next action from "nextActions" alone without reading the DOM

    Scenario: A delta context read returns only what changed since a revision
      Given the agent has already read the workspace at revision 2 and the workspace is now at revision 4
      When the agent calls "duckdb_get_context" with "sinceRevision" 2
      Then the response restricts itself to fields that changed since revision 2
      And it is the same projection restricted, not a second model of the workspace

  # ---------------------------------------------------------------------------

  @PRD @ASD-2 @ASD-4
  Rule: The shortest path is one read plus one atomic mutation, and no response ever carries rows

    Scenario: Two calls take an agent from ready workspace to selected artifact
      Given "saas_churn" is already active through a human gesture
      When the agent calls "duckdb_get_context" and then "duckdb_execute_sql_to_canvas" with the current revision and a fresh idempotency key
      Then both calls succeed and the workspace revision advances by exactly one
      And the mutation envelope returns the artifact handle, the projected summary, and measured metrics, but no result rows
      And the mutation envelope's next action suggests "duckdb_verify_zero_egress" scoped to the new artifact
      And the human's Controls pane shows the same operation, Saved results card, and revision without any separate agent channel

    Scenario: No tool response contains result rows
      When each of the four registered tools is invoked with legal inputs
      Then every success envelope carries summaries, handles, and metrics only
      And every failure envelope carries stable codes and recovery details only
      And no response of any tool contains a result-row array

  # ---------------------------------------------------------------------------

  @PRD @ASD-8 @ASD-9
  Rule: Deterministic control — stale writes are safe, retries are idempotent

    Scenario: A stale revision executes nothing and teaches the agent how to catch up
      Given the workspace is at revision 4
      When the agent submits a mutation with "expectedRevision" 3
      Then the envelope fails with error code "STALE_REVISION", retryable true
      And the details report expected revision 3 and current revision 4
      And no SQL is executed, no artifact is committed, and no UI state changes
      And the envelope offers a delta-read next action scoped from revision 3

    Scenario: Replaying the same mutation exactly returns the original result
      Given a successful analysis committed artifact "a_01" at revision 2 under idempotency key "k-01"
      When the same mutation is replayed with key "k-01" and identical input
      Then the original envelope is returned with artifact "a_01" and revision 2
      And no duplicate artifact is created and the revision does not advance

    Scenario: Reusing an idempotency key for a different command is refused
      Given idempotency key "k-01" already committed one command
      When a different command is submitted with the same key "k-01"
      Then the envelope fails with error code "IDEMPOTENCY_CONFLICT", retryable false
      And the recovery guidance is to generate a new key or resend the original command exactly

  # ---------------------------------------------------------------------------

  @PRD @ASD-12
  Rule: Custody evidence is scoped, honest, and read-only

    Scenario: Verifying zero egress scopes its claim to the requested artifact
      Given artifact "a_01" exists on dataset "saas_churn"
      When the agent calls "duckdb_verify_zero_egress" with scope "artifact" for "a_01"
      Then the evidence reports zero dataset upload bytes, distinguished from measured application traffic
      And it lists the monitored transports: fetch, XMLHttpRequest, sendBeacon, WebSocket, and WebTransport
      And it includes the release counters and lineage for "a_01"
      And it states its explicit limitations instead of claiming zero shell traffic or formal proof
      And the workspace revision is unchanged because verification is a read

  # ---------------------------------------------------------------------------

  @PRD @ASD-13 @ASD-14 @ASD-16
  Rule: One kernel for every operator — parity and lifecycle

    Scenario: Human chips, the simulator, and native WebMCP produce identical domain effects
      Given the same legal command sequence is dispatched once by the human prompt chip, once by the Agent Simulator, and once by native WebMCP
      Then each run produces the same domain events, artifacts, revisions, errors, and projections
      And no adapter calls a private UI setter or fabricates a result

    Scenario: Human-only mutations stay off the agent surface but share the workspace
      When the agent lists the registered tools
      Then exactly "duckdb_get_context", "duckdb_activate_dataset", "duckdb_execute_sql_to_canvas", and "duckdb_verify_zero_egress" are registered
      And "selectArtifact" and "cancelActiveOperation" are dispatchable only by human controls and the simulator
      And an artifact-card click dispatches "selectArtifact" and Cancel dispatches "cancelActiveOperation" through the same workspace

    Scenario: Remounting the page never duplicates a tool registration
      When the page unmounts and remounts through the lifecycle-managed adapters
      Then each of the four tools remains registered exactly once

    Scenario: Without "document.modelContext" the simulator drives the same kernel
      Given the browser does not expose "document.modelContext"
      When the analyst uses the built-in Agent Simulator
      Then the simulator invokes the same domain commands and produces the same operations, artifacts, events, and UI projections
      And only the language model is simulated, not the workspace

  # ---------------------------------------------------------------------------

  @PRD
  Rule: The agent-visible surface is safe even though the agent can read the page

    Scenario: Sensitive values appear nowhere the agent can observe
      Given "healthcare_pii" is active with policy "sensitive_aggregate_only" and a legal aggregate artifact is selected
      When the agent inspects every tool response, the shared canvas, Saved results cards, error details, and the visible page text
      Then no raw record, direct identifier "mrn" value, or sub-minimum cohort appears in any of them
      And the Rows explains the policy suppression instead of painting rows

    Scenario: Errors teach recovery instead of leaking internals
      When any mutation fails
      Then the failure envelope carries a stable error code, a concise message, retryability, and recovery-useful details
      And the details never echo raw rows, sensitive bindings, or stack traces
      And at least one legal recovery action is offered whenever recovery exists
