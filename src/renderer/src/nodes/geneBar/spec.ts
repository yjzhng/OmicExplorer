/** geneBar: its node contract (see nodes/contract.ts). */
import type { BarConfig } from '../../graph/types'
import { defineSpec } from '../contract'

export const geneBarSpec = defineSpec<'geneBar'>({
  kind: 'geneBar',
  label: 'Bar',
  category: 'plotting',
  input: { accepts: ['quantity'] },
  output: null,
  hasRun: true,
  // Colour left unset: by condition with few samples, by value with many (barColorConds).
  defaultConfig: (): BarConfig => ({}),
  plot: {
    tileHint: 'Selected gene value across conditions. Select to view.',
    configurable: true,
    legend: true,
    axes: true
  }
})
