#!/usr/bin/env bash
# ADR 0008: Cloudflare Pages rejects files over 25 MiB, so the deployed dist
# carries gzipped wasm twins and functions/duckdb/[file].js serves them with
# Content-Encoding: gzip. public/ keeps the plain files for the dev server,
# which has no size limit.
set -euo pipefail
cd "$(dirname "$0")/.."

for wasm in dist/duckdb/*.wasm; do
  if [ ! -f "$wasm" ]; then
    echo "❌ ERROR: no dist/duckdb/*.wasm found — run \`pnpm build\` before this script." >&2
    exit 1
  fi
  gzip -9 -c "$wasm" > "$wasm.gz"
  rm "$wasm"
  echo "→ gzipped $(basename "$wasm") ($(du -h "$wasm.gz" | cut -f1))"
done
