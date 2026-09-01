# TypeScript handbook — Error boundaries

This handbook is the language-level view of how DuckStudio catches, names, and renders errors. The product-level rules — no raw row release, no second projection, no top-level `components/` bucket — live in `ARCHITECTURE.md`, `SECURITY.md`, `docs/agent-system-design.md`, and the ADRs. This document derives from those rules and pins the implementation shape so every adapter and view agrees.

The ADRs this handbook derives from:

- ADR 0001 — App framework: Vite + React 18.3 + TanStack Router 1.170.x. We render in React; we recover through the same workspace store the router syncs to.
- ADR 0002 — DuckDB-WASM in a dedicated Web Worker. The worker is the only place that can throw a SQL execution error; the main thread must translate, not propagate, raw DuckDB errors.
- ADR 0004 — Colocated state, `zod@4.5` schemas, single trust seam. Every error that crosses a trust boundary parses against the same envelope schema; nothing is hand-typed.
- ADR 0005 — `src/` follows screaming architecture. Error UI is not a top-level `components/` directory; it is a feature module that lives where the failure can occur.
- ADR 0006 — Tooling versions (React `^18.3.0`, Vitest `^2.1.0`, `@testing-library/react` `^16.0.0`, oxlint `^0.9.0`). Error-boundary tests run on this stack.
- ADR 0003 — `lint-strict` on the custody and projection files. Error code that touches `dataset-custody/**`, `revisioned-workspace/projection.ts`, `agent-control-plane/envelope.ts`, `agent-control-plane/registration.ts`, or `duck-engine/sql-inspector.ts` is held to `no-explicit-any`, `no-non-null-assertion`, `no-console`, and the TypeScript correctness rules.

## Scope and non-goals

In scope:

- React render-tree error boundaries. Where they mount, what they catch, and what they render.
- Async/worker error translation at the workspace boundary.
- The shape of an error envelope returned to WebMCP and the simulator.
- Recovery actions that the UI and the agent can act on without re-running the unsafe SQL.

Out of scope:

- SQL allow/deny policy. Owned by `dataset-custody/sql-inspector.ts` and the deny list in `docs/agent-system-design.md` §6.
- Artifact immutability after a failure. Owned by `revisioned-workspace/`.
- Custody release decisions. Owned by `dataset-custody/release.ts`.
- A generic "toast" system. Not a feature of this product.

## One trust seam, one envelope

ADR 0004 fixes the trust seam at `zod@4.5` with `z.strictObject` and `z.compile`. Errors follow the same seam. There is exactly one error envelope, defined in `agent-control-plane/envelope.ts`, and every adapter that returns an error — human UI, WebMCP, simulator, route guard, `beforeLoad` — parses through `CompiledEnvelopeFailure`.

```ts
// agent-control-plane/envelope.ts
import * as z from "zod";
import "zod/v4";

export const ErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "STALE_REVISION",
  "POLICY_DENIED",
  "BUDGET_EXCEEDED",
  "CANCELLED",
  "UNSUPPORTED_CAPABILITY",
  "WORKER_FAILURE",
  "INTERNAL_ERROR",
]);

export const RecoveryActionSchema = z.strictObject({
  kind: z.enum([
    "refresh",
    "selectArtifact",
    "cancelActiveOperation",
    "narrowSql",
    "retryWithBackoff",
    "useHttpsOrLocalhost",
  ]),
  label: z.string().min(1).max(80),
  detail: z.string().max(400).optional(),
});

export const EnvelopeFailureSchema = z.strictObject({
  ok: z.literal(false),
  schemaVersion: z.literal("duckstudio.webmcp/v1"),
  workspaceId: z.string().min(1).max(80),
  revision: z.number().int().nonnegative(),
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string().max(400),
    field: z.string().max(80).optional(),
    artifactId: z.string().min(1).max(80).optional(),
  }),
  recovery: z.array(RecoveryActionSchema).max(3),
  contextDelta: z.record(z.string(), z.unknown()).optional(),
  warnings: z.array(WarningSchema).max(8),
});
export const CompiledEnvelopeFailure = z.compile(EnvelopeFailureSchema);
```

`CompiledEnvelopeFailure` is the only shape the UI, WebMCP, and the simulator read. There is no second error type. A thrown `Error` that reaches a boundary is `Error.code` mapped into the schema; anything that does not map becomes `INTERNAL_ERROR` with a sanitized message and a `refresh` recovery action.

## Where the boundary sits

Error boundaries are colocated with the feature that owns the failure surface (ADR 0005). They are not a top-level `components/` directory and not a `utils/` helper.

```text
src/
├── studio-shell/
│   └── error-shell.tsx           # top-level boundary; renders the "something went wrong" view
├── live-canvas/
│   ├── view-error-boundary.tsx   # one boundary per evidence view
│   └── view-error-boundary.test.tsx
├── revisioned-workspace/
│   ├── dispatch-error.ts         # dispatch() throws here; never in the worker
│   └── dispatch-error.test.ts
├── duck-engine/
│   └── worker-error.ts           # worker postMessage error translation
└── agent-control-plane/
    └── envelope.ts               # CompiledEnvelopeFailure lives here
```

The rule: a boundary lives at the root of the feature whose failure it must contain. `studio-shell/error-shell.tsx` is the only boundary that is allowed to render a full-page fallback. Every other boundary must render in place, inside the same two-pane chrome, without re-mounting the workspace.

## Render-tree boundary shape

React 18.3 class component, typed strictly, no `any`, no non-null assertion. The boundary catches only what the React render tree throws — synchronous render exceptions and lifecycle errors from descendants. It does not catch event-handler errors, async work, or worker errors; those are translated before they reach the boundary.

```ts
// live-canvas/view-error-boundary.tsx
import { Component, type ReactNode } from "react";
import type { CompiledEnvelopeFailure } from "../agent-control-plane/envelope";
import { getWorkspace } from "../revisioned-workspace";

type Props = {
  view: "insights" | "grid" | "sql_lineage" | "custody";
  children: ReactNode;
  fallback: (envelope: CompiledEnvelopeFailure) => ReactNode;
};
type State = { envelope: CompiledEnvelopeFailure | null };

export class ViewErrorBoundary extends Component<Props, State> {
  state: State = { envelope: null };

  static getDerivedStateFromError(error: unknown): State {
    const envelope = toEnvelope(error);
    return { envelope };
  }

  override componentDidCatch(error: unknown): void {
    const ws = getWorkspace();
    ws.recordBoundaryFailure({
      view: this.props.view,
      envelope: this.state.envelope!,
    });
  }

  override render(): ReactNode {
    if (this.state.envelope !== null) {
      return this.props.fallback(this.state.envelope);
    }
    return this.props.children;
  }
}
```

Two rules enforced here:

1. `componentDidCatch` calls `ws.recordBoundaryFailure`, not `dispatch`. A boundary failure is an event, not a workspace mutation. The workspace records the failure against the current revision and never re-runs the analysis.
2. The fallback is **injected by the parent**, not picked from a global map. `live-canvas/` decides what the Custody view's failure looks like; `studio-shell/` decides what the top-level failure looks like. The boundary itself does not own presentation.

The non-null assertion in `componentDidCatch` is a deliberate exception to ADR 0003 `no-non-null-assertion`. It is the one place we have statically proven that `this.state.envelope` is set, because `getDerivedStateFromError` ran first. The Vitest contract test in `view-error-boundary.test.tsx` covers the sequence and the file is excluded from `no-non-null-assertion` via a focused oxlint inline disable scoped to that line.

## Async and worker error translation

Worker errors do not crash the React tree. They are translated at the `revisioned-workspace/dispatch-error.ts` seam, wrapped into `CompiledEnvelopeFailure`, and routed through the workspace event log so the projection and the envelope see the same shape.

```ts
// revisioned-workspace/dispatch-error.ts
import type { CompiledEnvelopeFailure } from "../agent-control-plane/envelope";
import { CompiledEnvelopeFailure } from "../agent-control-plane/envelope";
import { isDuckDbError, isAbortError } from "../duck-engine/worker-error";

export function toEnvelope(error: unknown, ctx: { revision: number; workspaceId: string }): CompiledEnvelopeFailure {
  if (CompiledEnvelopeFailure.safeParse(error).success) {
    return error as CompiledEnvelopeFailure;
  }
  if (isDuckDbError(error)) {
    return CompiledEnvelopeFailure.parse({
      ok: false,
      schemaVersion: "duckstudio.webmcp/v1",
      workspaceId: ctx.workspaceId,
      revision: ctx.revision,
      error: {
        code: mapDuckDbErrorCode(error),
        message: sanitizeDuckDbMessage(error),
      },
      recovery: duckDbRecovery(error),
      warnings: [],
    });
  }
  if (isAbortError(error)) {
    return CompiledEnvelopeFailure.parse({
      ok: false,
      schemaVersion: "duckstudio.webmcp/v1",
      workspaceId: ctx.workspaceId,
      revision: ctx.revision,
      error: { code: "CANCELLED", message: "Operation was cancelled." },
      recovery: [{ kind: "retryWithBackoff", label: "Run again" }],
      warnings: [],
    });
  }
  return CompiledEnvelopeFailure.parse({
    ok: false,
    schemaVersion: "duckstudio.webmcp/v1",
    workspaceId: ctx.workspaceId,
    revision: ctx.revision,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
    recovery: [{ kind: "refresh", label: "Refresh" }],
    warnings: [],
  });
}
```

Three rules:

- The translator never includes the raw DuckDB message. The DuckDB-WASM error string can echo column names from the user's SQL; for `sensitive_aggregate_only` datasets that is a release defect. The message is reduced to a category and a short label.
- `toEnvelope` is idempotent. If the caller already produced a `CompiledEnvelopeFailure`, it is returned unchanged. The Vitest contract test asserts this on a sample of every error code.
- The translator never logs. `dataset-custody/**` is on `lint-strict` with `no-console`; this file is not in that path, but it is on the projection hot path and `console.error` would be a regression of the no-raw-value rule.

## Recovery actions

Every failure carries at least one recovery action. The action set is fixed and lives in the schema. The UI renders it as a button; the agent receives it as a machine-readable `kind`. There is no prose-only recovery.

| `kind` | When | UI label | Agent behavior |
|---|---|---|---|
| `refresh` | `INTERNAL_ERROR`, unclassified failure | "Refresh" | Re-fetch context, re-dispatch the last command |
| `selectArtifact` | `STALE_REVISION` | "Open latest artifact" | Call `selectArtifact` with the suggested `artifactId` |
| `cancelActiveOperation` | Worker stuck after timeout | "Cancel running analysis" | Dispatch `cancelActiveOperation` |
| `narrowSql` | `BUDGET_EXCEEDED` on rows or materialization | "Narrow the query" | Reduce `resultRows` or remove a `WITH` clause |
| `retryWithBackoff` | `CANCELLED`, transient worker fault | "Run again" | Re-dispatch with the same `idempotencyKey` |
| `useHttpsOrLocalhost` | `UNSUPPORTED_CAPABILITY` on a LAN IP | "Use HTTPS or localhost" | None; this is a deployment gate, not a runtime recovery |

Recovery actions are the only thing a human or an agent is allowed to do next. The envelope never suggests running an unsanitized query or re-uploading data; the API surface is closed.

## Projection, custody, and the render boundary

ADR 0005 pins `revisioned-workspace/projection.ts` as the single owner of "what to render." Error rendering follows the same rule. The projection function returns a `Projection` that already contains a fallback `Envelope` for any view that errored; the boundary's job is to render the projection's fallback, not to invent one.

```ts
// revisioned-workspace/projection.ts
import type { CompiledEnvelopeFailure } from "../agent-control-plane/envelope";

export type Projection = {
  summary: string;
  artifactCards: ReadonlyArray<ArtifactCard>;
  views: {
    insights: ViewProjection;
    grid: ViewProjection;
    sql_lineage: ViewProjection;
    custody: ViewProjection;
  };
};

export type ViewProjection =
  | { kind: "ok"; payload: ViewPayload }
  | { kind: "error"; envelope: CompiledEnvelopeFailure };
```

When the projection's `views.grid.kind === "error"`, `live-canvas/grid-view.tsx` renders the envelope's `error.message` and the first `recovery` action. The boundary does not interfere. This is the only place the recovery button is rendered; the envelope owns the copy, the view owns the chrome.

## Testing

Three Vitest files cover this handbook. They run on the pinned stack (Vitest 2.1, `@testing-library/react` 16, jsdom via the default Vitest environment).

- `live-canvas/view-error-boundary.test.tsx` — asserts that `getDerivedStateFromError` produces a `CompiledEnvelopeFailure`, that `componentDidCatch` records against the workspace without re-dispatching, and that the injected `fallback` is called with the envelope. Uses `@testing-library/react` `render` plus a fake `getWorkspace`.
- `revisioned-workspace/dispatch-error.test.ts` — parameterized over every `ErrorCode` and every recovery `kind`. Asserts that `toEnvelope` is idempotent, that DuckDB-shaped errors map to `WORKER_FAILURE` or `BUDGET_EXCEEDED` with a sanitized message, and that aborted promises map to `CANCELLED` with `retryWithBackoff`.
- `revisioned-workspace/_contract/error-vs-projection-parity.test.ts` — the cross-cutting contract. For every `ErrorCode`, the envelope that `toEnvelope` returns must be referentially equal to the envelope that `projection.ts` returns for the same failure state. A diff fails the build. This is the same parity test pattern as `agent-control-plane/_contract/webmcp-vs-simulator-parity.test.ts` from ADR 0005.

The contract test is the load-bearing one. Without it, the boundary, the projection, and the envelope can drift. With it, the three call sites cannot disagree on what a failure looks like.

## Rules in one place

- One error envelope, `CompiledEnvelopeFailure` in `agent-control-plane/envelope.ts`. No second type.
- One translator, `toEnvelope` in `revisioned-workspace/dispatch-error.ts`. The boundary, the projection, and the agent all read its output.
- One ownership rule: a boundary lives at the root of the feature whose failure it contains. No top-level `components/`, no shared "ErrorBoundary" utility.
- One fallback: the projection owns the `ViewProjection` for a failed view; the boundary owns the chrome; the envelope owns the copy and the recovery action.
- One trust rule: raw DuckDB messages are never rendered, never logged, never included in the envelope. The translator sanitizes.
- One lint rule: error code that touches `dataset-custody/**`, `agent-control-plane/envelope.ts`, `agent-control-plane/registration.ts`, `revisioned-workspace/projection.ts`, or `duck-engine/sql-inspector.ts` is held to `lint-strict`.
- One test rule: a Vitest contract test asserts envelope/projection parity on every error code.
