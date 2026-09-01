/** Custody evidence view — empty state per the shell decisions (ticket 06). */
export function CustodyView() {
  return (
    <p className="flex min-h-36 items-center justify-center text-center text-sm text-ink-secondary">
      No custody evidence yet — verification runs on artifacts.
    </p>
  );
}
