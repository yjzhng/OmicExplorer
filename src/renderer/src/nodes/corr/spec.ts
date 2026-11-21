/** corr: its node contract (see nodes/contract.ts). */
import type { CorrConfig } from '../../graph/types'
import { defineSpec } from '../contract'

export const corrSpec = defineSpec<'corr'>({
  kind: 'corr',
  label: 'Correlation',
  category: 'plotting',
  input: { accepts: ['quantity'] },
  output: null,
  hasRun: true,
  defaultConfig: (): CorrConfig => ({ cluster: true }),
  plot: {
    tileHint: 'Sample × sample correlation matrix. Select to view.',
    configurable: true,
    legend: true,
    axes: true,
    quick: { sampleOrder: false }
  }
})
