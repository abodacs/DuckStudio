/**
 * The adapter import surface for the §7 envelope (ADR 0004 am5): every
 * export here is a re-export of a domain binding, so adapters and tests keep
 * one import path while each definition lives in the module that owns it —
 * the envelope vocabulary and shape in `revisioned-workspace/envelope.ts`,
 * the workspace schemas in `revisioned-workspace/schemas.ts`. This module
 * owns nothing: deleting `agent-control-plane/` removes no domain type, at
 * the type level and at the build level. Import-equality is contract-tested
 * in `_contract/`.
 */

// --- Envelope vocabulary and shape (defined in revisioned-workspace/envelope.ts) ---

export {
  CompiledActivateDatasetEnvelopeSuccess,
  CompiledCancelActiveOperationEnvelopeSuccess,
  CompiledEnvelopeFailure,
  CompiledEnvelopeSuccess,
  CompiledGetContextArtifactEnvelopeSuccess,
  CompiledGetContextEnvelopeSuccess,
  CompiledGetContextEventsEnvelopeSuccess,
  CompiledGetContextSchemaEnvelopeSuccess,
  CompiledRunAnalysisEnvelopeSuccess,
  CompiledSelectArtifactEnvelopeSuccess,
  CompiledVerifyCustodyEnvelopeSuccess,
  EnvelopeFailureSchema,
  EnvelopeSuccessSchema,
  NextActionSchema,
  SchemaVersionSchema,
  ToolNameSchema,
  WarningCodeSchema,
  WarningSchema,
  type Envelope,
  type EnvelopeFailure,
  type EnvelopeSuccessData,
} from "../revisioned-workspace/envelope";

// --- Domain schemas (import-equality is contract-tested in _contract/) ---

export {
  ActivateDatasetDataSchema,
  ActivateDatasetInputSchema,
  ACTIVATE_DATASET_TOOL_DESCRIPTION,
  BudgetLimitsSchema,
  CapabilitySchema,
  CancelActiveOperationDataSchema,
  CancelActiveOperationInputSchema,
  CompiledActivateDatasetInput,
  CompiledCancelActiveOperationInput,
  CompiledGetContextInput,
  CompiledRunAnalysisInput,
  CompiledSelectArtifactInput,
  CompiledVerifyCustodyInput,
  EXECUTE_SQL_TO_CANVAS_TOOL_DESCRIPTION,
  GET_CONTEXT_TOOL_DESCRIPTION,
  GetContextArtifactDataSchema,
  GetContextEventsDataSchema,
  GetContextInputSchema,
  GetContextSchemaDataSchema,
  GetContextSummaryDataSchema,
  OperationSummarySchema,
  PolicySchema,
  RecentArtifactSchema,
  RunAnalysisDataSchema,
  RunAnalysisInputSchema,
  SelectArtifactDataSchema,
  SelectArtifactInputSchema,
  VERIFY_ZERO_EGRESS_TOOL_DESCRIPTION,
  VerifyCustodyInputSchema,
  WorkspaceEventSchema,
  WorkspaceSchema,
  workspaceSearchSchema,
} from "../revisioned-workspace/schemas";
export { ErrorCodeSchema } from "../revisioned-workspace/schemas";
export type {
  ActivateDatasetData,
  ActivateDatasetInput,
  BudgetLimits,
  Capability,
  CancelActiveOperationData,
  CancelActiveOperationInput,
  ErrorCode,
  GetContextArtifactData,
  GetContextEventsData,
  GetContextInput,
  GetContextSchemaData,
  GetContextSummaryData,
  OperationSummary,
  Policy,
  RecentArtifact,
  RunAnalysisData,
  RunAnalysisInput,
  SelectArtifactData,
  SelectArtifactInput,
  VerifyCustodyInput,
  Workspace,
  WorkspaceEvent,
  WorkspaceSearch,
} from "../revisioned-workspace/schemas";
