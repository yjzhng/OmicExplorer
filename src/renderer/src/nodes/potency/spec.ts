/** potency: its node contract (see nodes/contract.ts). */
import type { PotencyConfig } from '../../graph/types'
import { defineSpec } from '../contract'

export const potencySpec = defineSpec<'potency'>({
  kind: 'potency',
  label: 'Potency',
  category: 'plotting',
  // A curve fit's pEC50 against its curve fold change (CurveCurator's potency plot).
  input: { accepts: ['curves'] },
  output: null,
  hasRun: true,
  defaultConfig: (): PotencyConfig => ({ show: 'all', capEnabled: false, labelTop: 20 }),
  plot: {
    tileHint: 'Curve potency (pEC50) vs fold change. Select to view.',
    configurable: true,
    legend: 'groups',
    axes: true
  }
})
