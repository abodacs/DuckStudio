#!/usr/bin/env bash
# The scriptable doc-diff check (grilling 62's resolution, PRD §10 parity
# clause): the canonical tool names, policy labels, and badge copy must be
# spelled identically everywhere they appear. Presence checks only — a
# missing canonical string fails the release checklist, so typos and aliases
# cannot survive into a submission.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

check() {
  local needle="$1"
  shift
  for file in "$@"; do
    if ! grep -qF -- "$needle" "$file"; then
      echo "MISSING: \"$needle\" not found in $file"
      fail=1
    fi
  done
}

# Presence in at least one of the files (the derived-directory form of `check`).
check_in_any() {
  local needle="$1"
  shift
  if ! grep -qF -- "$needle" "$@"; then
    echo "MISSING: \"$needle\" not found in any of: $*"
    fail=1
  fi
}

TOOLS=(
  docs/agent-system-design.md
  docs/prd.md
  docs/video-script.md
  docs/submission.md
  README.md
  src/agent-control-plane/registration.ts
)
for tool in duckdb_get_context duckdb_activate_dataset duckdb_execute_sql_to_canvas duckdb_verify_zero_egress; do
  check "$tool" "${TOOLS[@]}"
done

POLICIES=(
  docs/agent-system-design.md
  docs/prd.md
  docs/video-script.md
  docs/submission.md
  src/demo-presets/schemas.ts
)
for policy in public_synthetic sensitive_aggregate_only; do
  check "$policy" "${POLICIES[@]}"
done

check "0 Bytes of Dataset Uploaded" docs/prd.md docs/video-script.md docs/submission.md src/revisioned-workspace/projection.ts
check "document.modelContext.registerTool" CONTRIBUTING.md docs/video-script.md

# The derived BDD scenarios must use the canonical spellings too. These are
# directory-level presence checks: each string must appear in at least one
# feature file (individual scenarios need not name every tool).
BDD_FILES=(docs/bdd/*.feature)
for tool in duckdb_get_context duckdb_activate_dataset duckdb_execute_sql_to_canvas duckdb_verify_zero_egress; do
  check_in_any "$tool" "${BDD_FILES[@]}"
done
for policy in public_synthetic sensitive_aggregate_only; do
  check_in_any "$policy" "${BDD_FILES[@]}"
done
check_in_any "0 Bytes of Dataset Uploaded" "${BDD_FILES[@]}"

if [ "$fail" -ne 0 ]; then
  echo "doc parity check FAILED — fix the canonical spellings, not this script."
  exit 1
fi
echo "doc parity check: all canonical strings present."
