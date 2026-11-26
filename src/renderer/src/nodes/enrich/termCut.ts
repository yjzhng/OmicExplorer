import type { EnrichData, EnrichTerm } from '../../engine'

/** The terms an enrichment plot draws: each direction's most significant `top` (its lists run most
 *  significant first) of those `keep` takes — the cap keeps the plot legible, it doesn't hide
 *  results: choosing categories or modules in the legend draws THEIR top `top` from every term
 *  computed, not just the ones the plot showed. With `onePer` (term → its module; "one per
 *  module"), a module's first term only. */
export function cutTerms(
  full: EnrichData,
  top: number,
  keep?: (t: EnrichTerm) => boolean,
  onePer?: ReadonlyMap<string, string>
): EnrichData {
  const pick = (ts: readonly EnrichTerm[]): EnrichTerm[] => {
    const seen = new Set<string>()
    const out: EnrichTerm[] = []
    for (const t of ts) {
      if (out.length >= top) break
      if (keep && !keep(t)) continue
      const m = onePer?.get(t.term)
      if (m !== undefined) {
        if (seen.has(m)) continue
        seen.add(m)
      }
      out.push(t)
    }
    return out
  }
  return { ...full, up: pick(full.up), down: pick(full.down) }
}
