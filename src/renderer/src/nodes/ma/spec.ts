/** ma: its node contract (see nodes/contract.ts). */
import type { MAConfig } from '../../graph/types'
import { defineSpec } from '../contract'
import { anova, NO_GROUP_MEANS } from '../kit/requirements'

export const maSpec = defineSpec<'ma'>({
  kind: 'ma',
  label: 'MA',
  category: 'plotting',
  input: { accepts: ['comparison'] },
  output: null,
  hasRun: true,
  defaultConfig: (): MAConfig => ({ fcLow: -1, fcHigh: 1, capEnabled: false, labelTop: 20 }),
  requirement: (u) => (anova(u) ? NO_GROUP_MEANS : null),
  plot: {
    tileHint: 'Abundance vs log₂FC. Select to view.',
    configurable: true,
    legend: 'groups',
    axes: true,
    guides: true
  }
})
