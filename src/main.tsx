if (import.meta.env.DEV) {
  import("react-grab");
}

import { start } from "./studio-shell/boot";

// A failed boot rejects visibly here (DevTools console) instead of dying as
// an unhandled rejection behind an empty page; a pre-registration failure
// also cleared boot's memo, so the next start() re-runs the plan.
start().catch((error: unknown) => {
  console.error("duckstudio: boot failed", error);
});
