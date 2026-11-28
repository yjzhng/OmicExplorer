/** QC plot panel body. buildQc scans every standardized row (O(rows)), so it's kept app-wide by
 *  the result + metric (ui/plotCache) — a plot-type toggle, an unrelated re-render or a remount
 *  won't rebuild it. */
import { usePlotCached } from '../../ui/plotCache'

import type { ConditionColoring } from '../../graph/types'
import { colorerArgs } from '../../ui/condColor'
import {
  buildQc,
  numericOf,
  type ConditionKey,
  type QcMetric,
  type SampleOrder,
  type StandardizeResult,
  type ValueScale
} from '../../engine'
import { QcPlotView } from './QcPlotView'

export function QcTile({
  std,
  metric,
  plot,
  scale,
  color,
  coloring = null,
  fit,
  categorical,
  condTitle,
  sampleOrder = 'natural',
  plainScale
}: {
  /** intensity shown plain on a log axis (ui/quantityAxis): `scale`, when it is */
  plainScale?: ValueScale
  /** a condition's legend heading, with its unit (see QcPlotView) */
  condTitle?: (c: ConditionKey) => string
  std: StandardizeResult
  metric: QcMetric
  plot: 'violin' | 'box' | 'bar'
  /** the scale abundance is shown on (presentScaleOf) */
  scale?: ValueScale
  /** the single fill colour (unset = the QC default) */
  color?: string
  /** colour by condition: the colour conditions and the fade (null: the single colour) */
  coloring?: ConditionColoring | null
  /** fit the value axis to the bars rather than starting it at zero */
  fit?: boolean
  /** the categorical palette its condition levels cycle (the plot's own, else the global one) */
  categorical?: readonly string[]
  /** the samples' / groups' order along the axis (default natural) */
  sampleOrder?: SampleOrder
}) {
  const data = usePlotCached('qc', [std, metric, scale, sampleOrder, !!plainScale], () =>
    buildQc(std, metric, scale, { by: sampleOrder, samples: std.samples }, !!plainScale)
  )
  return (
    <QcPlotView
      data={data}
      plot={plot}
      color={color}
      {...colorerArgs(coloring, numericOf(std))}
      fit={fit}
      categorical={categorical}
      condTitle={condTitle}
      plainScale={plainScale}
    />
  )
}
