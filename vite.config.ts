import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // Never collect the local prototype extract; e2e/ belongs to Playwright.
    exclude: [...configDefaults.exclude, ".scratch/**", "e2e/**"],
  },
});
