/** The set comparison's run: every set its upstream can give, for the tile to pick from and draw.
 *
 *  - Clean data: which genes each sample measured (engine/sets measuredSets, in the worker — a pass
 *    over every row); the tile groups the samples and applies its share rule.
 *  - a Compare / Curve fit: each facet's significant genes up and down (callSets — off the result's
 *    columns, per facet); comparing terms, the enrichment plot's run as well (every method × term
 *    set, per facet). */
import { callSets, holderWhere } from '../../engine'
import { engine } from '../../engine/client'
import { holderTable } from '../../engine/lazyRows'
import { numericOfResult, type NodeResult, type SetCompareConfig } from '../../graph/types'
import { NotReady } from '../../shared/diagnostics'
import { run as enrichRun } from '../enrich/run'
import type { PlotRunContext } from '../runContext'

export async function run(ctx: PlotRunContext): Promise<NodeResult> {
  const { upstream } = ctx
  const cfg = ctx.config as SetCompareConfig
  if (upstream.kind === 'standardize') {
    const std = upstream.std
    const quantity = await engine.measuredSets(holderTable(std) ?? std.rows)
    return { kind: 'sets', quantity }
  }
  if (upstream.kind !== 'compare')
    throw new NotReady('Needs a Clean data, Compare or Curve fit upstream.')
  // (a two-way ANOVA's term rows have no direction — kept out, as from every directional reader)
  const signed = holderWhere(upstream.cmp, 'signed', (c) => !c.term)
  const calls = callSets(signed, numericOfResult(upstream))
  if (cfg.elements !== 'terms') return { kind: 'sets', calls }
  const e = await enrichRun({
    ...ctx,
    kind: 'enrich',
    config: { method: cfg.method ?? 'ora', source: cfg.source ?? 'go', topTerms: 15 } as never
  })
  return { kind: 'sets', calls, ...(e.kind === 'enrich' ? { enrich: e.facets } : null) }
}
