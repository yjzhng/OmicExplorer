/** QC plot panel body. buildQc scans every standardized row (O(rows)), so it's memoized on
 *  the result + metric — a plot-type toggle or an unrelated re-render won't rebuild it. */
import { useMemo } from 'react'

import { buildQc, type QcMetric, type StandardizeResult } from '../engine'
import { QcPlotView } from '../ui/QcPlotView'

export function QcTile({
  std,
  metric,
  plot
}: {
  std: StandardizeResult
  metric: QcMetric
  plot: 'violin' | 'box' | 'bar'
}) {
  const data = useMemo(() => buildQc(std, metric), [std, metric])
  return <QcPlotView data={data} plot={plot} />
}
