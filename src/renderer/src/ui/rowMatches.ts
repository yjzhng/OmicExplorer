/** The match rule behind TableSearch (ui/TableSearch.tsx), for the tables that use it. */

/** Whether a row matches a search: every whitespace-separated term appears (case-insensitive) in
 *  at least one of its cells — so "SDC1 membrane" finds the row with both. */
export function rowMatches(cells: readonly string[], query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const lower = cells.map((c) => c.toLowerCase())
  return terms.every((t) => lower.some((c) => c.includes(t)))
}
