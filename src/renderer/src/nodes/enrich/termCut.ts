import type { EnrichData, EnrichTerm } from '../../engine'

/** A term is significant below this FDR, unless the plot sets its own (`termFdr`). */
export const SIGNIFICANT_FDR = 0.05
/** The FDR cuts offered as a switch on the tile (any other is typed in the settings). */
export const FDR_PRESETS = [0.01, 0.05, 0.1]

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
