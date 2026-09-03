# Plan 005: Arm egress monitoring once — a boot retry must not stack transport wrappers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat ff604ab..HEAD -- src/studio-shell/boot.ts src/studio-shell/boot.test.ts src/dataset-custody/egress.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ff604ab`, 2026-09-03
- **Issue**: (pending publication)

## Why this matters

Egress interception is what makes the headline custody evidence — the `0 Bytes of Dataset Uploaded` badge and `duckdb_verify_zero_egress` — measured rather than asserted. `warmDefault` arms it unconditionally on every call, and the boot contract explicitly supports re-running the warm step: a boot failure before the register step clears the `start()` memo "so the next `start()` re-runs the plan" (`boot.ts:52-58`). On that retry path, `armEgressMonitoring` wraps the *current* `scope.fetch` — which is already the first monitor — and stacks a second wrapper. Every later dataset-payload send is then accounted **twice** (each wrapper calls `account(kernel, body)` → `kernel.recordDatasetUpload`). The moment a real dataset byte crosses a transport — exactly the event the monitor exists to catch — the recorded evidence overstates it 2×, silently and permanently for the session. Custody-evidence integrity is the product's thesis; the accounting must be as trustworthy as the policy.

## Current state

Relevant files:

- `src/studio-shell/boot.ts` — the ordered startup module; `warmDefault` is the warm step, `start()` the memoized entry.
- `src/dataset-custody/egress.ts` — `armEgressMonitoring(scope, kernel)` wraps the five monitored transports in the given scope; returns `{ monitoredTransports, disarm }`.
- `src/studio-shell/boot.test.ts` — the headless boot-order test with injectable seams (structural pattern).
- `src/dataset-custody/egress.test.ts` — the transport-accounting tests (where the double-arm regression case belongs).

The unconditional arm, and the retry path that re-runs it:

```ts
// boot.ts:35-38
export async function warmDefault(): Promise<void> {
  armEgressMonitoring(globalThis, custodyKernel);
  await warmEngine();
}

// boot.ts:60-71
let app: Promise<App> | undefined;
let registrationReached = false;

export function start(inject: StartInjection = {}): Promise<App> {
  app ??= boot(inject).catch((error: unknown) => {
    if (!registrationReached) {
      app = undefined;          // next start() re-runs the whole plan, warm included
    }
    throw error;
  });
  return app;
}
```

The wrapping that stacks on a second arm — `originalFetch` is whatever `scope.fetch` holds *now*, so on the second call it is the first monitor:

```ts
// egress.ts:45-65 (abridged)
export function armEgressMonitoring(scope: EgressScope, kernel: CustodyKernel): EgressMonitor {
  const coverage: string[] = [];
  const restore: Array<() => void> = [];

  const wrap = <T>(owner: object, key: string, replacement: T, original: unknown): void => {
    (owner as Record<string, unknown>)[key] = replacement;
    restore.push(() => { (owner as Record<string, unknown>)[key] = original; });
  };

  if (typeof scope.fetch === "function") {
    const originalFetch = scope.fetch as (...args: unknown[]) => Promise<unknown>;
    const monitored = (input: unknown, init?: { body?: unknown }) => {
      if (init && "body" in init) account(kernel, init.body);   // runs once per wrapper layer
      return originalFetch(input, init);
    };
    wrap(scope as object, "fetch", monitored, originalFetch);
    coverage.push("fetch");
  }
  ...
```

And the function's tail — no memoization, and coverage re-recorded per arm:

```ts
// egress.ts:130-138
  kernel.recordTransportCoverage(coverage);
  return {
    monitoredTransports: coverage,
    disarm() {
      for (const restoreFn of restore) restoreFn();
      restore.length = 0;
      kernel.recordTransportCoverage([]);
    },
  };
```

Conventions to honor:

- The warm step is deliberately before mount "so no command can outrun a warm engine and zero dataset uploads are provable from first paint" (`boot.ts:19-25`). Arming must still happen exactly once, before anything mounts — this plan does not touch ordering.
- `disarm()` is the documented "test and lifecycle escape hatch" (`egress.ts:28`) — keep it working unchanged.
- `start()`'s injectable-seam style (`StartInjection` with `container`/`gate`/`warm`, `boot.ts:41-48`) is the pattern for any new test seam.

## Commands you will need

All commands assume Node 26. If `node --version` is not v26, first run:

```sh
export PATH="$HOME/.nvm/versions/node/v26.8.1/bin:$PATH"   # or: nvm use
```

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Install   | `pnpm install`                       | exit 0              |
| Typecheck | `pnpm typecheck`                     | exit 0              |
| Lint      | `pnpm lint`                          | exit 0              |
| Tests     | `pnpm test -- boot` / `pnpm test -- egress` | all pass, including new tests |
| Full floor| `pnpm test`                          | all pass            |

## Scope

**In scope** (the only files you should modify):

- `src/studio-shell/boot.ts` — `warmDefault` (and, if needed for the test seam, an optional-injection parameter)
- `src/studio-shell/boot.test.ts` — new double-arm case
- `src/dataset-custody/egress.test.ts` — new single-accounting case

**Out of scope** (do NOT touch, even though they look related):

- `src/dataset-custody/egress.ts` internals — the wrappers, `account()`, and `disarm()` are correct; the bug is the unguarded call site. (Making `armEgressMonitoring` itself idempotent would need wrapper-detection heuristics — rejected as more fragile than memoizing at the one call site.)
- `kernel.ts` counters, `warmEngine()`, the `BOOT_PLAN` order, registration retry semantics.
- The egress wrapper **coverage gaps** (a `Request`-object body sent as `fetch(input, …)` is unaccounted — audit finding SEC-04); separate finding, do not fix here.

## Git workflow

- Branch: `fix/egress-arm-once` off the branch you were dispatched from.
- Commit style: `fix(custody): arm egress monitoring once across boot retries`.
- Do NOT push or open a PR unless the operator instructed it. Never target `main` directly.

## Steps

### Step 1: Memoize the monitor at the arming call site

In `boot.ts`, hold the monitor in module scope and arm only when absent:

```ts
import { armEgressMonitoring, type EgressMonitor } from "../dataset-custody/egress";

let egressMonitor: EgressMonitor | null = null;

export async function warmDefault(): Promise<void> {
  egressMonitor ??= armEgressMonitoring(globalThis, custodyKernel);
  await warmEngine();
}
```

Rationale to keep in a one-line comment: a failed warm leaves interception armed — correct, since it must cover first paint regardless; re-arming must never stack wrappers.

To keep `warmDefault` headlessly testable, extend it the way `start()` does injection — an optional parameter, defaulting to today's behavior:

```ts
export async function warmDefault(inject: {
  scope?: EgressScope;
  kernel?: CustodyKernel;
  warm?: () => Promise<void>;
} = {}): Promise<void> {
  const scope = inject.scope ?? globalThis;
  const kernel = inject.kernel ?? custodyKernel;
  if (!egressMonitor) egressMonitor = armEgressMonitoring(scope, kernel);
  await (inject.warm ?? warmEngine)();
}
```

If you take the injection shape, thread a no-op `warm` through `boot.test.ts`'s existing injections (the file already injects `warm` at the `start()` level; `warmDefault` defaults keep every existing caller working unchanged). Keep the memo `let` binding module-level so a test can observe/reset it — export a test-only `__resetEgressMemo()` ONLY if the existing test style in `boot.test.ts` supports such helpers; otherwise restructure the memo into a tiny exported `armOnce(scope, kernel)` whose state the test can reach. Pick whichever matches the file's existing seam style; do not add a new testing framework.

**Verify**: `pnpm typecheck` → exit 0; `pnpm test -- boot` → existing boot-order tests pass unchanged.

### Step 2: Regression tests

1. **Single accounting (the bug)** — in `src/dataset-custody/egress.test.ts` or `boot.test.ts` (whichever holds the seam you test against; model after the existing accounting cases that stub `kernel.recordDatasetUpload`): arm twice against a stub scope and a counting kernel stub; then `scope.fetch("https://x", { body: registeredPayload })` where the payload is registered via the kernel stub's `datasetPayloadBytes` returning a positive byte count → assert `recordDatasetUpload` was called **exactly once** with the same byte count. (Pre-fix this fails with 2.)
2. **Coverage recorded once**: after the double `warmDefault()`, `kernel.recordTransportCoverage` saw the transport list (idempotent value; assert the final coverage still lists all five transports).
3. **disarm still restores**: after `egressMonitor.disarm()`, `scope.fetch` is the original function (existing egress tests likely pin this — extend only if the memoized path changed it).
4. **Existing boot contract unchanged**: `pnpm test -- boot` — the ordered `BOOT_PLAN` assertions must pass untouched.

**Verify**: `pnpm test -- boot` and `pnpm test -- egress` → all pass including the new case (case 1 must fail before Step 1 and pass after — verify the red state first by writing the test before the fix if your workflow allows).

### Step 3: Full floor

**Verify**: `pnpm lint` → exit 0; `pnpm test` → all pass.

## Test plan

Covered in Step 2. Structural patterns: the accounting cases in `src/dataset-custody/egress.test.ts` (kernel stubs + stub scopes) and the injection style of `src/studio-shell/boot.test.ts`.

## Done criteria

- [ ] `pnpm typecheck` and `pnpm lint` exit 0
- [ ] `pnpm test` exits 0; the double-arm case from Step 2 exists and passes
- [ ] `git diff src/studio-shell/boot.ts` shows the memoized arming (no second `armEgressMonitoring` call site anywhere: `grep -rn "armEgressMonitoring(" src/ | grep -v egress.ts` → exactly one call site, guarded)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts no longer match the live code (drift) — in particular if `warmDefault` already memoizes or `armEgressMonitoring` gained idempotence.
- Any existing test **requires** double-arming to produce fresh wrappers (that would mean the retry semantics are pinned differently than the boot doc describes — a ruling above this plan).
- HMR or test setup in this repo depends on `warmDefault` re-arming after module reload (check `boot.test.ts` and any dev-only callers before assuming).
- The fix appears to require changing `egress.ts` wrapper internals.

## Maintenance notes

- If a second arming call site ever appears (e.g. a future test harness), it must go through the same memo — a reviewer should reject a bare `armEgressMonitoring(...)` outside `boot.ts`.
- The memo lives for the page's lifetime; `disarm()` remains the explicit escape hatch. If a future lifecycle ever disarms and re-arms, reset the memo as part of that change.
- Related, deliberately deferred: SEC-04's accounting gaps (Request-object bodies, derived payload copies, the never-incremented tools counter). This plan fixes double-counting, not under-counting.
