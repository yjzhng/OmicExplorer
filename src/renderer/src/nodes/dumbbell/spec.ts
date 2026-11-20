/** dumbbell: its node contract (see nodes/contract.ts). */
import type { DumbbellConfig } from '../../graph/types'
import { defineSpec } from '../contract'

export const dumbbellSpec = defineSpec<'dumbbell'>({
  kind: 'dumbbell',
  label: 'Dumbbell',
  category: 'plotting',
  input: { accepts: ['contrast'] },
  output: null,
  hasRun: true,
  defaultConfig: (): DumbbellConfig => ({ capEnabled: true, topGenes: 20 }),
  plot: {
    tileHint: 'Group A ↔ group B per gene. Select to view.',
    configurable: true,
    legend: true,
    axes: true
  }
})
