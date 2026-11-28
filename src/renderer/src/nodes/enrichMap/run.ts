/** The enrichment map's run: the enrichment plot's (every method × term source, per facet), and —
 *  where GO is tested — GO's nesting among the tested terms, from the ontology (main/goHierarchy:
 *  fetched once, then cached). Without the ontology (offline, first time) the map still draws, its
 *  GO terms under their aspects alone. */
import type { NodeResult } from '../../graph/types'
import { run as enrichRun } from '../enrich/run'
import type { PlotRunContext } from '../runContext'

export async function run(ctx: PlotRunContext): Promise<NodeResult> {
  const res = await enrichRun(ctx)
  if (res.kind !== 'enrich') return res
  const names = new Set<string>()
  for (const facet of Object.values(res.facets))
    for (const [combo, e] of Object.entries(facet))
      if (combo.endsWith('|go')) for (const t of [...e.up, ...e.down]) names.add(t.term)
  if (!names.size) return res
  const go = await window.api.goAncestors([...names])
  return { ...res, goAncestors: go.ancestors, ...(go.error ? { goError: go.error } : null) }
}
