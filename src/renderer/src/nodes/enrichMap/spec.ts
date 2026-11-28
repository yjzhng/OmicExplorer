/** enrichMap: its node contract (see nodes/contract.ts) — the enrichment plot's data and
 *  requirement, drawn as a flow (layout.ts). */
import type { EnrichMapConfig } from '../../graph/config/enrich'
import { defineSpec } from '../contract'
import { enrichSpec } from '../enrich/spec'

export const enrichMapSpec = defineSpec<'enrichMap'>({
  kind: 'enrichMap',
  label: 'Enrichment map',
  category: 'plotting',
  input: enrichSpec.input,
  output: null,
  hasRun: true,
  defaultConfig: (): EnrichMapConfig => ({
    method: 'ora',
    source: 'go',
    topTerms: 15,
    modules: true
  }),
  requirement: (u, cfg) => enrichSpec.requirement?.(u, cfg as never) ?? null,
  plot: {
    configurable: true,
    legend: false,
    axes: false,
    computes: true
  }
})
