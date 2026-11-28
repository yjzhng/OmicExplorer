/** string: its node contract (see nodes/contract.ts). */
import type { StringConfig } from '../../graph/config/enrich'
import { defineSpec } from '../contract'
import { resultStringTaxon } from '../kit/requirements'

const NO_ANN: Record<string, Record<string, string>> = {}

export const stringSpec = defineSpec<'string'>({
  kind: 'string',
  label: 'STRING network',
  category: 'plotting',
  input: { accepts: ['comparison', 'curves'] },
  output: null,
  hasRun: true,
  // No confidence: auto — the highest level that still draws a network.
  defaultConfig: (): StringConfig => ({
    maxGenes: 40,
    addInteractors: false
  }),
  // STRING: a species override reads another organism; a gene cap the run didn't cover (a custom
  // one typed in the gear) needs its query read.
  staleOn: (next, prev, result) => {
    const n = next as StringConfig
    const p = prev as StringConfig
    if ((n.species ?? 0) !== (p.species ?? 0)) return true
    const cap = n.maxGenes > 0 ? n.maxGenes : 40
    return result?.kind === 'string' && !result.caps.includes(cap)
  },
  requirement: (u, cfg) => {
    if (u.result?.kind !== 'compare') return null
    const species = (cfg as StringConfig)?.species
    if (species && species > 0) return null
    return resultStringTaxon(u.result.annotationMap ?? NO_ANN) > 0
      ? null
      : 'No species detected — fetch annotations in the interactive import (Metadata step), which reads the organism, then re-run Standardize and the Compare / Curve fit.'
  },
  plot: {
    configurable: true,
    computes: true
  }
})
