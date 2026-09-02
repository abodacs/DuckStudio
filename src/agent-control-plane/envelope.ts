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
  CompiledEnvelopeFailure,
  CompiledEnvelopeSuccess,
  CompiledGetContextEnvelopeSuccess,
  CompiledGetContextEventsEnvelopeSuccess,
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
  BudgetLimitsSchema,
  CapabilitySchema,
  CompiledGetContextInput,
  GET_CONTEXT_TOOL_DESCRIPTION,
  GetContextEventsDataSchema,
  GetContextInputSchema,
  GetContextSummaryDataSchema,
  OperationSummarySchema,
  PolicySchema,
  WorkspaceEventSchema,
  WorkspaceSchema,
} from "../revisioned-workspace/schemas";
export { ErrorCodeSchema } from "../revisioned-workspace/schemas";
export type {
  BudgetLimits,
  Capability,
  ErrorCode,
  GetContextEventsData,
  GetContextInput,
  GetContextSummaryData,
  OperationSummary,
  Policy,
  Workspace,
  WorkspaceEvent,
} from "../revisioned-workspace/schemas";
