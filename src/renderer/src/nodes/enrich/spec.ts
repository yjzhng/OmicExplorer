/** enrich: its node contract (see nodes/contract.ts). */
import type { EnrichConfig } from '../../graph/types'
import {
  enrichSourcesPresent,
  resolveEnrichSource,
  ENRICH_FALLBACK,
  ENRICH_SOURCE_LABEL
} from '../../engine'
import { defineSpec } from '../contract'

export const enrichSpec = defineSpec<'enrich'>({
  kind: 'enrich',
  label: 'Enrichment',
  category: 'plotting',
  input: { accepts: ['comparison', 'curves'] },
  output: null,
  hasRun: true,
  defaultConfig: (): EnrichConfig => ({
    method: 'ora',
    source: 'go',
    style: 'dot',
    topTerms: 15
  }),
  // Met by ANY term set the genes carry, not just the saved one: the plot falls back through
  // ENRICH_FALLBACK to one they have (resolveEnrichSource), so only no annotations at all blocks it.
  requirement: (u, cfg) => {
    if (u.result?.kind !== 'compare') return null // unknown until run
    const present = enrichSourcesPresent(u.result.annotationMap ?? {}, u.result.keggCategories)
    if (resolveEnrichSource((cfg as EnrichConfig)?.source, present)) return null
    const names = ENRICH_FALLBACK.map((s) => ENRICH_SOURCE_LABEL[s]).join(', ')
    return `No enrichment annotations on these genes (${names}) — fetch them in the interactive import (Metadata step), then re-run Clean data and the Compare / Curve fit.`
  },
  plot: {
    configurable: true,
    legend: true,
    axes: true,
    computes: true
  }
})
