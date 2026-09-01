import { Link, type ErrorComponentProps } from "@tanstack/react-router";

/**
 * Route-level error frame: names the problem, offers one recovery action, and
 * never renders a stack trace (PRD §7.1 — errors teach recovery).
 */
export function WorkspaceError({ error }: ErrorComponentProps) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-canvas p-6 text-center">
      <h1 className="text-lg font-semibold tracking-[-0.01em]">This view failed to render</h1>
      <p className="max-w-prose text-sm text-ink-secondary">
        {error.message || "An unexpected error occurred in the workspace."}
      </p>
      <Link
        to="/"
        className="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm transition-[background-color,border-color] duration-150 ease-out hover:border-ink-secondary focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"
      >
        Back to the workspace
      </Link>
    </div>
  );
}
