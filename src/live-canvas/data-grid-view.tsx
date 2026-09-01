/** Data Grid evidence view — empty state per the shell decisions (ticket 06). */
export function DataGridView() {
  return (
    <p className="flex min-h-36 items-center justify-center text-center text-sm text-ink-secondary">
      No artifact — the grid paints rows only from an approved artifact.
    </p>
  );
}
