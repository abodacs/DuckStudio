# Derived from docs/prd.md §3 + Amendment 3 and docs/agent-system-design.md §3, §4.2, §4.4, §8.5, §9, §11, §14.
# Canonical documents own the facts; this file must not invent behavior.

@analyst @local-file-import
Feature: Bring your own file — drag-and-drop CSV import that never leaves the tab
  As an analyst working under an egress ban
  I want to import a local CSV by dropping it into the page
  In order to analyze my own file under the same custody rules as the presets without one byte leaving my browser

  The import is the seventh domain command and the third human-only one: the file's bytes ride
  an out-of-band one-shot ticket, the command carries only the handle, and the imported relation
  becomes the active dataset under the default "sensitive_aggregate_only" policy. Import never
  uploads: the "0 Bytes of Dataset Uploaded" badge stays truthful before and after.

  Background:
    Given a fresh DuckStudio workspace "ws_local_01" at revision 0
    And the header badge reads "0 Bytes of Dataset Uploaded"

  # ---------------------------------------------------------------------------

  @PRD @ASD-2
  Rule: A dropped CSV becomes the active dataset in this tab only

    Scenario: The drop dispatches the human-only import command
      When the human drops "my_sales.csv" onto the import dropzone
      Then the file's bytes are read in the tab and dispatched as "importLocalFile" with a one-shot ticket handle
      And the workspace revision is 1
      And the imported relation "local_<slug>_<digest>" is active with policy "sensitive_aggregate_only" and the file's row count
      And the header shows "local_<slug>_<digest> · sensitive_aggregate_only" and the badge still reads "0 Bytes of Dataset Uploaded"
      And the operation stream shows the import as a cancelable operation

    Scenario: An analysis on the imported relation is governed like any other
      Given a dropped CSV's relation is active
      When one aggregate SELECT is executed against it
      Then the artifact commits with lineage starting at the local dataset relation
      And the envelope returns the safe summary and measured metrics but no result rows
      And custody evidence reports zero dataset bytes uploaded

  # ---------------------------------------------------------------------------

  @PRD
  Rule: Ceilings deny pre-execution as VALIDATION_ERROR

    Scenario: A file that is not a CSV is refused before the engine
      When the human drops a file whose name does not end in ".csv"
      Then the envelope fails with error code "VALIDATION_ERROR" and a human sentence beside the code chip
      And no request reaches the engine, no dataset activates, and the revision is unchanged

    Scenario: A file above the import ceilings is refused before the engine
      When the human drops a CSV larger than 200 MB
      Then the envelope fails with error code "VALIDATION_ERROR" naming the ceiling
      When the human drops a CSV with more than 5,000 columns
      Then the envelope fails with error code "VALIDATION_ERROR" naming the ceiling
      When the human drops an empty file
      Then the envelope fails with error code "VALIDATION_ERROR"

  # ---------------------------------------------------------------------------

  @PRD @ASD-11
  Rule: Cancel and failure leave zero trace

    Scenario: Cancelling mid-import leaves nothing behind
      Given an import is running as the single active operation
      When the human dispatches "cancelActiveOperation"
      Then the operation reports "OPERATION_CANCELLED" and the revision increments once
      And no dataset is active, no relation was created, and the ticket's bytes are gone

    Scenario: A failed import consumes its bytes so nothing leaks
      When an import fails after the engine phase started
      Then the materialized relation is dropped and the ticket's bytes are deleted
      And a later import with the same ticket handle finds nothing and says so

  # ---------------------------------------------------------------------------

  @PRD
  Rule: Custody on imported files matches the preset contract

    Scenario: Direct identifiers stay in metadata and never enter the relation
      Given a dropped CSV carries a "patient_id" column
      Then the dataset metadata lists "patient_id" as an omitted direct identifier
      And the materialized relation excludes the column, so no identifier value ever reaches DuckDB

    Scenario: The imported dataset defaults to sensitive_aggregate_only
      Given a dropped CSV and no classification UI
      Then the active dataset policy is "sensitive_aggregate_only"
      And the Rows explains the policy suppression instead of painting rows

    Scenario: Two files behind one slug derive different relations
      When "my sales.csv" and "my-sales.csv" are imported as different files
      Then each import derives a distinct "local_<slug>_<digest>" relation and both analyses reference the right one

  # ---------------------------------------------------------------------------

  @PRD
  Rule: The WebMCP surface stays exactly four tools

    Scenario: The import command is never registered
      When the agent lists the registered tools
      Then exactly "duckdb_get_context", "duckdb_activate_dataset", "duckdb_execute_sql_to_canvas", and "duckdb_verify_zero_egress" are registered
      And "importLocalFile" is dispatchable only by the human dropzone

    Scenario: The local-file selection next action is real
      When an analysis is attempted while no dataset is active
      Then the "DATASET_UNAVAILABLE" recovery includes the human action "select_local_file"
      And the import dropzone is the surface that performs it
