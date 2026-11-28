/** setCompare: its node contract (see nodes/contract.ts) — sets read from whatever it hangs off
 *  (Clean data's measured genes, a Compare's or Curve fit's significant genes or enriched terms),
 *  compared as an UpSet or a proportional Venn. */
import type { NodeResult, SetCompareConfig } from '../../graph/types'
import { defineSpec } from '../contract'
import { enrichSpec } from '../enrich/spec'

/** Whether a run result holds what a config draws: the sets' base for its upstream (any run does),
 *  and the enrichment where it compares terms. */
export const runCovers = (cfg: SetCompareConfig, r: NodeResult | undefined): boolean =>
  r?.kind === 'sets' && (cfg.elements !== 'terms' || !!r.enrich || !r.calls)

export const setCompareSpec = defineSpec<'setCompare'>({
  kind: 'setCompare',
  label: 'Set comparison',
  subtitle: 'Overlaps: UpSet or Venn',
  category: 'plotting',
  input: { accepts: ['quantity', 'comparison', 'curves'] },
  output: null,
  hasRun: true,
  defaultConfig: (): SetCompareConfig => ({}),
  // its run reads every set the upstream has; the tile's picks, rules and look draw from it — only
  // switching to terms needs the enrichment run as well
  staleOn: (next, _prev, result) => !runCovers(next as SetCompareConfig, result),
  // terms need a Compare's annotations, as the enrichment plot does; genes need nothing more
  requirement: (u, cfg) => {
    const c = cfg as SetCompareConfig | undefined
    if (c?.elements !== 'terms') return null
    if (u.result && u.result.kind !== 'compare')
      return 'Terms are a Compare’s or Curve fit’s — compare genes here.'
    return enrichSpec.requirement?.(u, { source: c.source ?? 'go' } as never) ?? null
  },
  plot: {
    computes: true,
    configurable: true,
    legend: false,
    axes: false,
    tileHint: 'Overlaps between sets. Select to view.',
    quick: { order: false }
  }
})
