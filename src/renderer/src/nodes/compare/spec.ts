/** compare: its node contract (see nodes/contract.ts). */
import type { CompareConfig } from '../../graph/types'
import { DEFAULT_THRESHOLD } from '../../engine'
import { defineSpec } from '../contract'

export const compareSpec = defineSpec<'compare'>({
  kind: 'compare',
  label: 'Compare',
  subtitle: 'fold change of A | B',
  category: 'processing',
  input: { accepts: ['abundance'], max: 2 },
  output: 'comparison',
  hasRun: true,
  defaultConfig: (): CompareConfig => ({
    analysis: 'compare',
    method: 'ttest',
    // Fresh tile: nothing declared — the user opens "Configure comparison" to define it.
    num: {},
    den: {},
    match: [],
    condition: 'cmpd',
    pairNum: '',
    pairDen: '',
    condition2: 'dose',
    pair2Num: '',
    pair2Den: '',
    // The P-value route, on the hyperbolic boundary (as switching back to P-value picks).
    threshold: { ...DEFAULT_THRESHOLD, type: 'non-linear', statType: 'pP' }
  })
})
