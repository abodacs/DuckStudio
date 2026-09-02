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
    <div className="relative flex h-dvh flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
      <div aria-hidden className="lamp-field" />
      <div className="glass-island relative z-10 flex max-w-md flex-col items-center gap-4 px-8 py-10">
        <h1 className="title">This view failed to render</h1>
        <p className="meta max-w-prose">{message}</p>
        <p className="mono-value text-xs">{code}</p>
        <Link to="/" className="button-recovery">
          Back to the workspace
        </Link>
      </div>
    </div>
  );
}
