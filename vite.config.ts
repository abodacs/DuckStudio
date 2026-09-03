import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The engine worker is a module worker (duckdb.worker.ts instantiates
  // DuckDB before answering the handshake), so the worker chunk ships as
  // ESM to match `new Worker(..., { type: "module" })` in duck-engine.
  worker: {
    format: "es",
  },
  test: {
    // Never collect local prototypes or nested worktrees; e2e/ belongs to
    // Playwright and each nested worktree owns its own test dependencies.
    exclude: [...configDefaults.exclude, ".scratch/**", ".claude/**", "e2e/**"],
  },
});
