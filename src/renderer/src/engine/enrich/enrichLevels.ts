/** The levels a source files its terms under, top first — what the enrichment map draws its terms
 *  flowing out of: KEGG pathway category › group, Reactome top-level pathway › level-2 pathway, a
 *  COG / KOG category's area, GO's aspect. Read off the annotation's aligned columns (one value per
 *  term, in the term column's order — main/annotate), so a term filed under two parents (a Reactome
 *  pathway, rarely) has two paths. */
import { type EnrichSource, goAspectsOf } from './terms'

export interface TermLevels {
  /** the levels' names, top first ("category", "group") — empty for a source with none */
  levels: string[]
  /** term → its paths down the levels, top first, each as long as `levels` (a level the data
   *  lacks for it cut short); a term filed under none is absent */
  paths: Map<string, string[][]>
}

const split = (v: string | undefined): string[] => (v ?? '').split(';').map((t) => t.trim())
/** A level cell's alternatives: a term under two parents carries both, ' / '-joined. */
const alts = (v: string): string[] =>
  v
    .split(' / ')
    .map((t) => t.trim())
    .filter(Boolean)

/** Each term's paths from columns aligned with its term column: `levelCols` top first. A term's
 *  first record wins (the annotation is the same wherever the term sits); with alternatives at a
 *  level, they pair up by position across the levels (the last repeated where one runs short). */
export function levelPathsOf(
  ann: Record<string, Record<string, string>>,
  termCol: string,
  levelCols: readonly string[]
): Map<string, string[][]> {
  const out = new Map<string, string[][]>()
  for (const uid in ann) {
    const rec = ann[uid]
    const terms = rec[termCol]
    if (!terms) continue
    const cols = levelCols.map((c) => split(rec[c]))
    split(terms).forEach((term, i) => {
      if (!term || out.has(term)) return
      const per = cols.map((vals) => alts(vals[i] ?? ''))
      // cut at the first level the data lacks for it
      const depth = per.findIndex((a) => a.length === 0)
      const levels = depth < 0 ? per : per.slice(0, depth)
      if (levels.length === 0) return
      const n = Math.max(...levels.map((a) => a.length))
      const paths: string[][] = []
      const seen = new Set<string>()
      for (let k = 0; k < n; k++) {
        const path = levels.map((a) => a[Math.min(k, a.length - 1)])
        const key = path.join('\u0000')
        if (!seen.has(key)) {
          seen.add(key)
          paths.push(path)
        }
      }
      out.set(term, paths)
    })
  }
  return out
}

/** A source's levels and its terms' paths through them, from the annotation (and, for KEGG, the
 *  pathway → category map older data carries the category in alone). */
export function termLevelsOf(
  source: EnrichSource,
  ann: Record<string, Record<string, string>>,
  keggCategories?: Record<string, string>
): TermLevels {
  switch (source) {
    case 'kegg': {
      const paths = levelPathsOf(ann, 'KEGG', ['KEGG_cat', 'KEGG_grp'])
      // data fetched before the aligned columns: the category alone, from the map
      for (const [term, cat] of Object.entries(keggCategories ?? {}))
        if (!paths.has(term) && cat) paths.set(term, [[cat]])
      return { levels: ['category', 'group'], paths }
    }
    case 'reactome':
      return {
        levels: ['category', 'group'],
        paths: levelPathsOf(ann, 'Reactome', ['Reactome_cat', 'Reactome_grp'])
      }
    case 'cog':
      return { levels: ['area'], paths: levelPathsOf(ann, 'COG_cat', ['COG_area']) }
    case 'kog':
      return { levels: ['area'], paths: levelPathsOf(ann, 'KOG_cat', ['KOG_area']) }
    case 'go':
      return {
        levels: ['aspect'],
        paths: new Map(Object.entries(goAspectsOf(ann)).map(([t, a]) => [t, [[a]]]))
      }
    default:
      return { levels: [], paths: new Map() }
  }
}
