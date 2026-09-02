/**
 * The wasm-serving function (ADR 0008): Cloudflare Pages rejects files over
 * 25 MiB, so the build ships `dist/duckdb/*.wasm.gz` and this function
 * answers `/duckdb/*.wasm` by streaming the gzipped twin decompressed — the
 * edge strips a function-set `Content-Encoding`, so the function decompresses
 * server-side instead and the engine's URL handling and
 * `WebAssembly.instantiateStreaming` see plain wasm, same-origin as ever.
 *
 * Every other file in this directory (the worker scripts) falls through to
 * the static asset pipeline with its `_headers` isolation rules — functions
 * otherwise shadow the statics that share the path.
 */

/**
 * @param {EventContext<Record<string, unknown>, "file">} context
 * @returns {Promise<Response>}
 */
async function serveWasm({ env, params, request, next }) {
  const file = params.file;
  // One segment, and only ever a wasm binary; anything else — the worker
  // scripts, a stray path — continues to the static pipeline.
  if (typeof file !== "string" || !file.endsWith(".wasm")) {
    return next();
  }
  const gzUrl = new URL(`/duckdb/${file}.gz`, request.url);
  const gz = await env.ASSETS.fetch(gzUrl);
  // A Pages miss falls back to the SPA's index.html — never pass that off as
  // a wasm binary; a missing twin must fail loudly at engine boot.
  const type = gz.headers.get("content-type") ?? "";
  if (!gz.ok || type.includes("text/html")) {
    return new Response("Not found", { status: 404 });
  }
  const wasm = gz.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(wasm, {
    status: 200,
    headers: {
      "Content-Type": "application/wasm",
      // Short freshness on purpose: the filename is version-stable, so a
      // stale poisoned entry would outlive a deploy — 5 minutes bounds that
      // blast radius (the broken-response lesson from this ADR's birth).
      "Cache-Control": "public, max-age=300",
    },
  });
}

export const onRequestGet = serveWasm;
export const onRequestHead = serveWasm;
