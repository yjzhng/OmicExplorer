/** contrast: its node contract (see nodes/contract.ts). */
import type { ContrastConfig } from '../../graph/types'
import { defineSpec } from '../contract'

export const contrastSpec = defineSpec<'contrast'>({
  kind: 'contrast',
  label: 'Contrast',
  subtitle: 'side-by-side A vs B',
  category: 'processing',
  // One Compare (split by a condition), or two same-kind inputs (Compare or Standardize) joined
  // as FC1/FC2 in 'pair' mode.
  input: { accepts: ['comparison', 'curves', 'abundance'], max: Infinity },
  output: 'contrast',
  hasRun: true,
  defaultConfig: (): ContrastConfig => ({
    relationship: 'correlated',
    source: 'select',
    num: {},
    den: {},
    match: []
  })
})
