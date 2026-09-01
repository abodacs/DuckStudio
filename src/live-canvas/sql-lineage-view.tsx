/** SQL & Lineage evidence view — empty state per the shell decisions (ticket 06). */
export function SqlLineageView() {
  return (
    <p className="flex min-h-36 items-center justify-center text-center text-sm text-ink-secondary">
      No artifact — lineage appears with your first analysis.
    </p>
  );
}
