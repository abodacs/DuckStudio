# Derived from docs/prd.md §5–§6, §10 and docs/agent-system-design.md §5, §6, §9, §15.
# Canonical documents own the facts; this file must not invent behavior.

@analyst @sql-analysis
Feature: Governed SQL analysis over a local dataset with chart verification
  As a healthcare or finance analyst working under an egress ban
  I want to aggregate an activated local dataset with read-only SQL and verify the resulting KPIs and charts in the app
  In order to get defensible numbers from sensitive files without one dataset byte leaving my browser

  Every analysis is one atomic command: validate SQL, execute in the local DuckDB worker,
  commit one immutable artifact, attach a policy-approved presentation, and select it.
  There is no partial commit: if any step fails, the prior workspace state stands.

  Background:
    Given a fresh DuckStudio workspace "ws_local_01" at revision 0
    And the header badge reads "0 Bytes of Dataset Uploaded"
    And no dataset is active and no artifact exists

  # ---------------------------------------------------------------------------

  @PRD @ASD-17
  Rule: Activation comes first and paints no rows

    Scenario: Activating a preset exposes safe metadata without painting a grid
      When "saas_churn" is activated with expectedRevision 0 and a fresh idempotency key
      Then the workspace revision is 1
      And the activation envelope reports policy "public_synthetic", 250000 rows, and a schema digest, but no rows
      And the header shows active dataset "saas_churn" with policy "public_synthetic"
      And the Data Grid shows an empty-workspace notice, not rows

    Scenario: Analysis against a workspace with no active dataset is recoverably refused
      When one read-only SELECT is executed against dataset "saas_churn" while no dataset is active
      Then the envelope fails with error code "DATASET_UNAVAILABLE" and retryable true
      And no artifact is created and the revision is still 0
      And the envelope offers an executable next action to activate an available preset or request local file selection

  # ---------------------------------------------------------------------------

  @PRD @ASD-7
  Rule: Only one safe, read-only statement against authorized sources may reach the worker

    Scenario Outline: Rejected SQL constructs never reach DuckDB or the canvas
      When the following statement is submitted for execution on the authorized source:
        """
        <sql>
        """
      Then the envelope fails with error code "UNSAFE_SQL"
      And the error details name the blocked construct and no stack trace
      And the statement is rejected before worker execution
      And no artifact is created, the revision is unchanged, and the previously selected artifact stays selected

      Examples: mutation and transaction control
        | sql                                                              |
        | CREATE TABLE stolen AS SELECT * FROM saas_churn                  |
        | INSERT INTO saas_churn SELECT * FROM saas_churn                  |
        | UPDATE saas_churn SET churned = 0                                |
        | DELETE FROM saas_churn                                           |
        | BEGIN; SELECT COUNT(*) FROM saas_churn; COMMIT                   |
        | SELECT COUNT(*) FROM saas_churn; SELECT 1                        |

      Examples: external access and environment control
        | sql                                                              |
        | ATTACH 'https://evil.example/x.db' AS x                          |
        | COPY saas_churn TO '/tmp/out.csv'                                |
        | INSTALL httpfs                                                   |
        | LOAD httpfs                                                      |
        | SELECT * FROM read_csv_auto('/data/secret.csv')                  |
        | SELECT * FROM 'https://evil.example/dump.parquet'                |
        | PRAGMA database_list                                             |

    Scenario: A reference outside the authorized source relation set is rejected
      Given "saas_churn" is the active dataset
      When a SELECT referencing a relation other than the authorized source is submitted
      Then the envelope fails with error code "UNSAFE_SQL" before worker execution
      And no artifact is created

    Scenario: Values travel in bindings so sensitive values never enter stored SQL
      Given "healthcare_pii" is the active dataset with policy "sensitive_aggregate_only"
      When a legal aggregate SELECT is executed with the cohort threshold supplied as a named binding
      Then the artifact commits and its SQL & Lineage view shows the statement with bindings redacted
      And no binding value appears in the projected SQL

  # ---------------------------------------------------------------------------

  @PRD @ASD-2
  Rule: One atomic aggregation produces one immutable artifact with a safe presentation

    Scenario: The canonical SaaS churn aggregation lands as KPIs and a scatter chart in one commit
      Given "saas_churn" is active at revision 1
      When the canonical group-by-tickets aggregation is executed with presentation omitted
      Then exactly one artifact is committed and selected in the same command
      And the envelope returns the artifact handle, a safe summary under 8 KB, and measured runtime, but no result rows
      And the Insights view shows KPIs computed from the query: Churn Rate "14.2%", Avg Tickets "4.8 / mo", Impacted MRR "$182,400"
      And the Insights scatter charts ticket buckets and visibly increases for tickets greater than 5
      And the SQL & Lineage view shows the exact statement, SQL hash, dataset lineage, release decision "allowed", and measured runtime
      And the workspace revision is 2 and the header reflects the new revision

    Scenario: An omitted presentation is inferred, never defaulted from stale UI state
      When a read-only aggregation returns numeric result columns with no presentation supplied
      Then the committed artifact carries an inferred KPI per numeric result column in result order
      And the first two numeric columns become the chart axes of a scatter specification
      And the envelope summary, the left artifact card, and the Insights view render the same summary object

    Scenario: A refinement sources the prior artifact instead of recomputing it
      Given artifact "a_01" exists from a prior aggregation on "saas_churn"
      When a second aggregation executes with source artifact "a_01"
      Then the new artifact's lineage chains to "a_01" and its source query is not recomputed
      And both artifacts remain inspectable with their original SQL, hash, and metrics

  # ---------------------------------------------------------------------------

  @PRD @ASD-5 @ASD-6
  Rule: Chart and grid verification is governed by the dataset policy

    Scenario: A public artifact renders bounded rows in the Data Grid
      Given "saas_churn" is active and artifact "a_01" holds a public aggregation
      When the Data Grid is opened for "a_01"
      Then bounded public rows render virtually

    Scenario: A sensitive artifact renders a suppression panel and never raw records
      Given "healthcare_pii" is active and a legal aggregate artifact with all cohorts of at least 10 is selected
      When the Data Grid is opened for that artifact
      Then a policy suppression panel explains that "sensitive_aggregate_only" withholds raw rows
      And no raw record or direct identifier "mrn" value is painted anywhere in the shared DOM

    Scenario: A sensitive aggregate with any cohort below the minimum is denied before commit
      Given "healthcare_pii" is active with policy "sensitive_aggregate_only" and minimum cohort size 10
      When an aggregation produces at least one group with fewer than 10 source rows
      Then the envelope fails with error code "POLICY_DENIED" and no artifact is committed
      And the error details identify the failing cohort without exposing its raw rows

    Scenario: An unsafe presentation request is denied, never silently stripped
      Given "healthcare_pii" is active with policy "sensitive_aggregate_only"
      When an analysis supplies a presentation that would release a direct identifier or a raw grid
      Then the envelope fails with error code "POLICY_DENIED" carrying "blockedFields"
      And when a legal aggregate-only presentation exists the details carry "permittedPresentation"
      And no downgraded or partially safe artifact is committed

    Scenario: Chart downsampling is disclosed, not hidden
      Given "saas_churn" is active
      When an aggregation yields more chart points than the committed chart budget allows
      Then the artifact commits with at most the budgeted points
      And the envelope carries a "CHART_DOWNSAMPLED" warning and the committed chart specification is unchanged

  # ---------------------------------------------------------------------------

  @PRD @ASD-10 @ASD-11
  Rule: Work stays bounded and one operation runs at a time

    Scenario: Execution over budget returns no partial artifact
      Given "saas_churn" is active with the default budgets of 5000 ms execution and 10000 materialized rows
      When an aggregation exceeds an execution or materialization limit
      Then the envelope fails with error code "BUDGET_EXCEEDED", retryable true
      And the details carry the budget axis, elapsed value, and limit value
      And no partial artifact or partial canvas commit exists and the prior selected artifact stays intact

    Scenario: A requested budget above the hard maximum is a validation failure, not a clamp
      When an analysis requests an execution budget above the hard maximum
      Then the envelope fails with error code "VALIDATION_ERROR" naming the offending field
      And no execution starts

    Scenario: A second analysis while one is running is refused without corrupting the first
      Given one analysis is running as the single active operation
      When another activation or analysis is dispatched
      Then it fails with error code "OPERATION_CONFLICT" and retryable true
      And the running operation continues undisturbed

    Scenario: Cancelling the active operation restores the prior selection
      Given one analysis is running and a previously committed artifact is selected
      When the human dispatches "cancelActiveOperation"
      Then the operation reports "OPERATION_CANCELLED" and the revision increments
      And no artifact from the cancelled operation is committed
      And the previously selected artifact remains selected
