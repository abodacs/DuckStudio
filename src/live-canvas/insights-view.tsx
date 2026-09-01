/** Insights evidence view — empty state per the shell decisions (ticket 06). */
export function InsightsView() {
  return (
    <p className="flex min-h-36 items-center justify-center text-center text-sm text-ink-secondary">
      No artifact selected — approved KPIs appear with your first analysis.
    </p>
  );
}
