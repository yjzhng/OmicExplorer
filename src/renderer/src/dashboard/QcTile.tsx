/** QC plot panel body. buildQc scans every standardized row (O(rows)), so it's memoized on
 *  the result + metric — a plot-type toggle or an unrelated re-render won't rebuild it. */
import { useMemo } from 'react'

import {
  buildQc,
  isNumericCond,
  type ConditionKey,
  type QcMetric,
  type StandardizeResult,
  type ValueScale
} from '../engine'
import { QcPlotView } from '../ui/QcPlotView'

export function QcTile({
  std,
  metric,
  plot,
  scale,
  color,
  colorConds = [],
  fit
}: {
  std: StandardizeResult
  metric: QcMetric
  plot: 'violin' | 'box' | 'bar'
  /** the scale abundance is shown on (plotScaleOf) */
  scale?: ValueScale
  /** the single fill colour (unset = the QC default) */
  color?: string
  /** colour by condition: a categorical one (the colour) and/or a numeric one (the shade) */
  colorConds?: ConditionKey[]
  /** fit the value axis to the bars rather than starting it at zero */
  fit?: boolean
}) {
  const data = useMemo(() => buildQc(std, metric, scale), [std, metric, scale])
  return (
    <QcPlotView
      data={data}
      plot={plot}
      color={color}
      colorCat={colorConds.find((c) => !isNumericCond(c))}
      colorNum={colorConds.find((c) => isNumericCond(c))}
      fit={fit}
    />
  )
}
