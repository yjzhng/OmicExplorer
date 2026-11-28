import type { QcConfig } from '../../graph/config/qc'

// Plot types valid per metric: distributions (intensity/CV) → violin/box; a per-sample count
// (proteins) → bar only.

export function qcPlotOptions(metric: QcConfig['metric']): QcConfig['plot'][] {
  return metric === 'proteins' ? ['bar'] : ['violin', 'box']
}
