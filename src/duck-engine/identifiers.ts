/**
 * DuckDB delimited-identifier quoting: a `"` inside a name is escaped by
 * doubling. Every identifier interpolated into engine DDL must pass through
 * here — a decoded alias or CSV header can otherwise terminate the statement
 * and execute what follows.
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
