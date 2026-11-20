/** variance: its node contract (see nodes/contract.ts). */
import type { VarianceConfig } from '../../graph/types'
import { defineSpec } from '../contract'
import { needsAnova } from '../kit/requirements'

export const varianceSpec = defineSpec<'variance'>({
  kind: 'variance',
  label: 'Variance',
  category: 'plotting',
  // An ANOVA's per-gene shares of variation, per factor (its model, kept with the result).
  input: { accepts: ['comparison'] },
  output: null,
  hasRun: true,
  defaultConfig: (): VarianceConfig => ({ topGenes: 20 }),
  requirement: needsAnova,
  plot: {
    tileHint: 'Each gene’s variation split among the factors. Select to view.',
    configurable: true,
    legend: true,
    axes: true
  }
})
