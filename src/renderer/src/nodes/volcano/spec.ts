/** volcano: its node contract (see nodes/contract.ts). */
import type { VolcanoConfig } from '../../graph/config/pointPlots'
import { defineSpec } from '../contract'

export const volcanoSpec = defineSpec<'volcano'>({
  kind: 'volcano',
  label: 'Volcano',
  category: 'plotting',
  input: { accepts: ['comparison', 'curves'] },
  output: null,
  hasRun: true,
  defaultConfig: (): VolcanoConfig => ({ capEnabled: false, labelTop: 20 }),
  plot: {
    tileHint: 'log₂FC vs significance. Select to view.',
    configurable: true,
    legend: 'groups',
    axes: true,
    guides: true
  }
})
