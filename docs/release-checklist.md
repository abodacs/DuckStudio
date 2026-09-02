# Release Checklist

The gates a release PR asserts before submission. CI owns the pipeline gates
(lint, typecheck, unit, build, e2e, deploy — `.github/workflows/ci.yml`); the
items here are the ones that can only be proven against the **live origin**,
recorded in the release PR next to the audit breakdown (grilling 62's
resolution, ticket 65).

Live origin: `https://duckstudio.pages.dev` (production deploys fire from CI
on `main` only; the `audit` job records the four-pillar breakdown after each
deploy — informational by ruling).

## 1. Audit gate — score ≥ 70

- [ ] The latest `Audit (webmcp-audit on the live origin)` job log for the
      deployed commit shows the availability gate **passed**.
- [ ] The overall score is **≥ 70 / 100** across the four pillars
      (shared experience 30 / task completion 25 / tool quality 25 /
      trust 20). Paste the breakdown in the release PR.

## 2. Deployed-origin isolation proofs

- [ ] COOP / COEP / CORP headers on `/` and on every asset class
      (font, wasm, worker, JS bundle):

  ```sh
  for p in / /fonts/geist-latin-var.woff2 /duckdb/duckdb-eh.wasm; do
    curl -sI "https://duckstudio.pages.dev$p" | grep -i cross-origin
  done
  ```

- [ ] One flagged-Chrome pass (`#enable-webmcp-testing`, per
      `CONTRIBUTING.md`) against the live origin:
      `E2E_BASE_URL=https://duckstudio.pages.dev pnpm e2e` — includes
      `window.crossOriginIsolated === true` and the rev-0 first paint.
- [ ] No third-party requests on the tool path (the suite's
      same-origin assertions run against the deployed origin with the
      command above).

## 3. Dataset-upload accounting

- [ ] The badge reads `0 Bytes of Dataset Uploaded` on the live origin.
- [ ] `duckdb_verify_zero_egress` evidence on the live origin reports
      `datasetBytesUploaded: 0` with both limitations
      (the e2e smoke pass asserts this; eyeball it once in flagged Chrome).

## 4. Canonical-copy parity

- [ ] `pnpm docs:parity` green — tool names, policy labels, and badge copy
      are identical across the canonical docs and the built shell.

## 5. Submission pack

- [ ] Video ≤ 2:55 (target 2:45) with burned captions; the PRD §8 demo
      checklist and `docs/video-script.md` §8 recording checklist ticked or
      named human-only.
- [ ] Devpost copy from `docs/submission.md`; live URL + repo URL + MIT note
      in the description.
