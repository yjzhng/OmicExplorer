/** metrics: its node contract (see nodes/contract.ts). */
import type { MetricsConfig } from '../../graph/types'
import { defineSpec } from '../contract'

export const metricsSpec = defineSpec<'metrics'>({
  kind: 'metrics',
  label: 'Curve metrics',
  category: 'plotting',
  // A curve fit's parameters per gene as bar charts (a surface's per slice level).
  input: { accepts: ['curves'] },
  output: null,
  hasRun: true,
  defaultConfig: (): MetricsConfig => ({}),
  plot: {
    tileHint: 'Curve parameters per gene, as bar charts. Select to view.',
    configurable: true,
    legend: true,
    axes: true
  }
})
