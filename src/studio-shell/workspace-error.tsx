import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { ZodError } from "zod";

/**
 * Map a route error to a stable code and a human message. Validation failures
 * (strict search schema) must never leak their serialized issue lists —
 * product principle 6: stable codes and legal next actions, not stack traces.
 */
function describe(error: Error): { code: string; message: string } {
  const message = error.message.trimStart();
  const isValidation =
    error instanceof ZodError ||
    error.name === "ZodError" ||
    message.startsWith("[") ||
    message.startsWith("{");
  if (isValidation) {
    return {
      code: "E_URL_INVALID_PARAM",
      message: "This link contains an unknown or invalid parameter.",
    };
  }
  return {
    code: "E_RENDER_FAILED",
    message: message || "An unexpected error occurred in the workspace.",
  };
}

/** Route-level error frame: names the problem, offers one recovery action. */
export function WorkspaceError({ error }: ErrorComponentProps) {
  const { code, message } = describe(error);
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-canvas p-6 text-center">
      <h1 className="text-lg font-semibold tracking-[-0.01em]">This view failed to render</h1>
      <p className="max-w-prose text-xs text-ink-secondary">{message}</p>
      <p className="font-mono text-xs text-ink-secondary">{code}</p>
      <Link
        to="/"
        className="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm transition-[background-color,border-color] duration-150 ease-out hover:border-ink-secondary focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"
      >
        Back to the workspace
      </Link>
    </div>
  );
}
