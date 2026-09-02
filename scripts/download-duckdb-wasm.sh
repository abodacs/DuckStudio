#!/usr/bin/env bash
# Self-host the DuckDB-WASM runtime assets (ADR 0002; COEP `require-corp`
# blocks third-party responses, so the wasm and worker scripts must be
# same-origin). Adapted from the vetted `.scratch/example/scripts/
# download-duckdb-wasm.sh` pattern — but without its `|| true`, which hides
# a bad glob: this script fails loudly when any expected file is missing and
# when zero files copy.
#
# The version is the exact pin from package.json (`@duckdb/duckdb-wasm`,
# no caret — dist-tags drift and `latest` is a dev build). Run from the
# repo root: `bash scripts/download-duckdb-wasm.sh`.

set -euo pipefail

TARGET_DIR="public/duckdb"
PACKAGE="@duckdb/duckdb-wasm"
VERSION="1.32.0"

# The four runtime assets the engine loads (see duck-engine/duckdb.worker.ts):
# no coi/pthread bundle ships, so selectBundle returns eh and execution stays
# single-threaded; mvp covers engines without wasm exceptions.
EXPECTED_FILES=(
  "duckdb-mvp.wasm"
  "duckdb-eh.wasm"
  "duckdb-browser-mvp.worker.js"
  "duckdb-browser-eh.worker.js"
)

echo "→ Preparing directory: $TARGET_DIR"
mkdir -p "$TARGET_DIR"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo "→ Packing $PACKAGE@$VERSION (exact pin)..."
npm pack "$PACKAGE@$VERSION" --pack-destination "$TMP_DIR" >/dev/null
tar -xzf "$TMP_DIR"/*.tgz -C "$TMP_DIR"

DIST_DIR="$TMP_DIR/package/dist"
if [ ! -d "$DIST_DIR" ]; then
  echo "❌ ERROR: no dist/ inside the $PACKAGE@$VERSION package."
  exit 1
fi

echo "→ Copying runtime assets to $TARGET_DIR ..."
copied=0
for file in "${EXPECTED_FILES[@]}"; do
  if [ ! -f "$DIST_DIR/$file" ]; then
    echo "❌ ERROR: expected asset '$file' not in the package dist/ — the pin or file list is stale."
    exit 1
  fi
  cp "$DIST_DIR/$file" "$TARGET_DIR/$file"
  copied=$((copied + 1))
done

if [ "$copied" -eq 0 ]; then
  echo "❌ ERROR: zero files copied — refusing to continue."
  exit 1
fi

echo "✅ Copied $copied files to $TARGET_DIR:"
ls -1 "$TARGET_DIR"
