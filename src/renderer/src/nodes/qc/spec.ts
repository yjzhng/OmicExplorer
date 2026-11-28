/** qc: its node contract (see nodes/contract.ts). */
import type { QcConfig } from '../../graph/config/qc'
import { defineSpec } from '../contract'

export const qcSpec = defineSpec<'qc'>({
  kind: 'qc',
  label: 'QC',
  category: 'plotting',
  input: { accepts: ['quantity'] },
  output: null,
  hasRun: true,
  // Colour left unset: by condition with few samples, one colour with many (qcColorBy).
  defaultConfig: (): QcConfig => ({ metric: 'intensity', plot: 'box' }),
  plot: {
    tileHint: 'Per-sample QC (intensity / CV / #proteins). Select to view.',
    configurable: true,
    legend: true,
    axes: true
  }
})
