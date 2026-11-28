/** STRING's run: every confidence level × gene cap × interactor mode, per facet (two scans of
 *  the organism's links file per facet — see readStringAll). */
import { facetGroupsOf } from '../../engine'
import {
  numericOfResult,
  type NodeResult,
  type StringAll,
  type StringConfig
} from '../../graph/types'
import {
  readStringAll,
  stringCapOptions,
  stringQueryGenesAt,
  stringSendLimit
} from '../../ui/stringModel'
import { resultStringTaxon } from '../kit/requirements'
import { NO_LOCAL_DATA } from '../kit/runConstants'
import type { PlotRunContext } from '../runContext'
import { NotReady } from '../../shared/diagnostics'

export async function run(ctx: PlotRunContext): Promise<NodeResult> {
  const { config, upstream, cancelled } = ctx
  if (upstream.kind !== 'compare') throw new NotReady('Needs a Compare upstream.')
  const cfg = config as StringConfig
  const ann = upstream.annotationMap ?? {}
  const species = cfg.species && cfg.species > 0 ? cfg.species : resultStringTaxon(ann)
  if (!species) throw new NotReady('No species detected — set one in the settings.')
  const caps = stringCapOptions(cfg.maxGenes > 0 ? cfg.maxGenes : 40)
  const facets: Record<string, StringAll> = {}
  // (a two-way ANOVA's term rows kept out) — the facets resolved over the context tuples, each
  // facet's genes read off its rows' columns (no row built)
  for (const g of facetGroupsOf(upstream.cmp, numericOfResult(upstream), (c) => !c.term)) {
    if (cancelled()) throw new Error('cancelled')
    // The widest query; a facet without 2 significant genes has no network to read.
    const widest = stringQueryGenesAt(
      upstream.cmp,
      g.idx,
      upstream.displayMap,
      ann,
      stringSendLimit(caps[caps.length - 1])
    )
    if (widest.length < 2) continue
    const all = await readStringAll(widest, species, caps)
    if (all.error === NO_LOCAL_DATA)
      throw new NotReady(
        'No local STRING data for this organism — tick STRING in the import’s Metadata fetch, ' +
          'then re-run Clean data and Compare.'
      )
    if (all.error) throw new Error(all.error)
    facets[g.key] = all
  }
  return { kind: 'string', species, caps, facets }
}
