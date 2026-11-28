/** metrics: its node contract (see nodes/contract.ts). */
import type { MetricsConfig } from '../../graph/config/dr'
import { contextOf } from '../../engine'
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
  // One-axis curves are drawn one bar per context (each comparison at each level of the other
  // conditions): in one context that's a single bar — the number the dose-response plot and the
  // table already give. A surface has its slices; before a run the contexts aren't known.
  requirement: (u) =>
    u.curve &&
    !u.surface &&
    u.result?.kind === 'compare' &&
    contextOf(u.result.cmp).rows.filter((c) => c.along).length < 2
      ? 'One curve per gene here — the metrics need several comparisons or condition levels to set side by side'
      : null,
  plot: {
    tileHint: 'Curve parameters per gene, as bar charts. Select to view.',
    configurable: true,
    legend: true,
    axes: true
  }
})
