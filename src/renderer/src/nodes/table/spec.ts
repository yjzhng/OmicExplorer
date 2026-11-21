/** table: its node contract (see nodes/contract.ts). */
import type { TableConfig } from '../../graph/types'
import { defineSpec } from '../contract'

export const tableSpec = defineSpec<'table'>({
  kind: 'table',
  label: 'Data table',
  category: 'plotting',
  // Shows the upstream step's results table; any processing step can feed it.
  input: { accepts: ['quantity', 'comparison', 'curves', 'contrast'] },
  output: null,
  hasRun: true,
  defaultConfig: (): TableConfig => ({}),
  plot: {
    configurable: true
  }
})
