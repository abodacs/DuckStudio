/**
 * CSV serialization for materializing preset relations (worker warm path;
 * the preset contract test loads the same bytes through real DuckDB). The
 * direct-identifier column is never present in the materialized column
 * list — the custody omission rule (prd.md §6.2) — so no sensitive value
 * ever exists to serialize.
 */

export function csvField(value: string | number | boolean): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly Readonly<Record<string, unknown>>[]): string {
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((name) => csvField(row[name] as string | number | boolean)).join(","));
  }
  return lines.join("\n") + "\n";
}
