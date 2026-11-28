/** Which terms an enrichment map draws: its FDR cut and term cap (mapCut), and the terms that
 *  makes of a facet's enrichment (mapTerms). Kept apart from the view, so the settings panel can
 *  read the cut without loading the chart (and Plotly with it). */
import type { EnrichData, EnrichTerm } from '../../engine'
import type { EnrichMapConfig } from '../../graph/config/enrich'
import { cutTerms } from '../enrich/termCut'
import type { MapTermIn } from './layout'

/** An older map's "every significant term": FDR below this, at most this many per direction. */
const SIGNIFICANT = 0.05
const SIGNIFICANT_MAX = 200
export const DIRECTIONS = ['both', 'up', 'down'] as const

/** A map's FDR cut and term cap: its own, else an older map's "every significant term" (FDR 0.05,
 *  up to 200 each way), else none and Max terms. */
export function mapCut(cfg: Pick<EnrichMapConfig, 'terms' | 'termFdr' | 'topTerms'>): {
  fdr: number | undefined
  top: number
} {
  const top = cfg.topTerms > 0 ? cfg.topTerms : 15
  if (cfg.termFdr != null) return { fdr: cfg.termFdr, top }
  if (cfg.terms === 'significant') return { fdr: SIGNIFICANT, top: SIGNIFICANT_MAX }
  return { fdr: undefined, top }
}

/** The terms a facet's map draws: each direction's top N — of those below the FDR cut, where
 *  there is one; one node per term (a term found both ways: its genes pooled, its better p), for
 *  the direction(s) asked. */
export function mapTerms(
  all: EnrichData,
  cfg: Pick<EnrichMapConfig, 'terms' | 'termFdr' | 'topTerms' | 'direction'>
): MapTermIn[] {
  const { fdr, top } = mapCut(cfg)
  const cut = fdr != null ? cutTerms(all, top, (t) => t.pAdjust < fdr) : cutTerms(all, top)
  const dir = cfg.direction ?? 'both'
  const lists: [EnrichTerm[], 'up' | 'down'][] = [
    ...(dir !== 'down' ? [[cut.up, 'up'] as [EnrichTerm[], 'up']] : []),
    ...(dir !== 'up' ? [[cut.down, 'down'] as [EnrichTerm[], 'down']] : [])
  ]
  const by = new Map<string, MapTermIn & { genes: string[] }>()
  for (const [ts, d] of lists)
    for (const t of ts) {
      const genes = t.geneIds ?? t.genes
      const had = by.get(t.term)
      if (had) {
        had.genes = [...new Set([...had.genes, ...genes])]
        had.pAdjust = Math.min(had.pAdjust, t.pAdjust)
        had.direction = 'both'
      } else
        by.set(t.term, {
          term: t.term,
          genes: [...genes],
          pAdjust: t.pAdjust,
          direction: d,
          category: t.category
        })
    }
  return [...by.values()].sort((a, b) => a.pAdjust - b.pAdjust)
}
