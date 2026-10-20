/**
 * Curve metrics plot: one gene's curve-fit parameter as a bar chart — the metric the tile's switch
 * picks (potency, slope, plateaus, R², peak, q). A curve has one bar; a surface one per slice level
 * along its curves (see metricBarsOf), so how the parameter moves across the levels shows, coloured
 * along the levels' palette.
 */
import { useMemo } from 'react'

import { condLabel, type CompareResultRow, type ConditionKey } from '../engine'
import { metricBarsOf, type MetricCtx, type MetricId } from '../graph/metricBars'
import { tooltip } from './condTooltip'
import { paletteSeries } from './palettes'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, PALETTES, plotBase, UI } from './theme'
import { useRolePalette } from './useAppSettings'
import { useUiTheme } from './useUiTheme'

export function MetricBarsView({
  row,
  metric,
  ctx,
  condTitle
}: {
  /** the gene's curve-fit row in the facet on show */
  row?: CompareResultRow
  metric: MetricId
  /** a condition's axis title with its unit — dose (nM) — as the other plots title it */
  condTitle: (c: ConditionKey) => string
  ctx: MetricCtx
}) {
  const mode = useUiTheme((s) => s.mode)
  // a surface's levels coloured along the role their condition takes (time's for time, else dose's)
  // (on the unit's values: the tile builds `ctx` afresh each render, which mustn't redraw the plot)
  const unit = ctx.unit
  const scale = ctx.scale
  const delta = !!ctx.delta
  const charts = useMemo(
    () => (row ? metricBarsOf(row, [metric], { unit, scale, delta }) : []),
    [row, metric, unit, scale, delta]
  )
  const by = charts.find((c) => c.by)?.by
  const levelRole = useRolePalette(by === 'time' ? 'time' : 'dose')
  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const c = charts[0]
    if (!c) return { data: [], layout: {} }
    const levels = c.bars.length
    const colors = c.by
      ? c.bars.map((_, k) => paletteSeries(levelRole, k, levels))
      : [CATEGORICAL[0]]
    const xs = c.bars.map((b) => (c.by ? b.at : c.label))
    // A bar at exactly 0 — a change's own reference slice — has no height to see: drawn as a band a
    // few pixels tall across the zero line, the bar's own width and colour. Sized in pixels, so it
    // never sets the axis's range (all bars 0 would otherwise zoom onto it).
    const zero = c.bars.flatMap((b, k) => (b.value === 0 ? [k] : []))
    const gap = c.by ? 0.2 : 0.6
    return {
      data: [
        {
          type: 'bar',
          x: xs,
          y: c.bars.map((b) => b.value),
          marker: { color: c.by ? colors : colors[0] },
          hovertemplate: tooltip(
            {
              title: c.label,
              conds: c.by ? [[condLabel(c.by), '%{x}']] : [],
              values: [['value', '%{y:.3g}']]
            },
            p.textMuted,
            { template: true }
          )
        }
      ],
      layout: {
        ...plotBase(p),
        showlegend: false,
        // one bar: a narrow one; per level: the levels in order
        bargap: gap,
        // each zero bar's band: over its category (its index on the axis), the bars' width
        shapes: zero.map((k) => ({
          type: 'rect',
          xref: 'x',
          yref: 'y',
          x0: k - (1 - gap) / 2,
          x1: k + (1 - gap) / 2,
          ysizemode: 'pixel',
          yanchor: 0,
          y0: -1.5,
          y1: 1.5,
          line: { width: 0 },
          fillcolor: colors[c.by ? k : 0],
          layer: 'above'
        })),
        xaxis: {
          ...axisBase(p),
          type: 'category',
          title: c.by ? condTitle(c.by) : undefined,
          showticklabels: !!c.by
        },
        // the metric with its unit (a change: Δ, from the reference slice); 0 always in view, its
        // line drawn
        yaxis: {
          ...axisBase(p),
          title: c.label,
          zeroline: true,
          zerolinecolor: p.textMuted,
          zerolinewidth: 1,
          rangemode: 'tozero'
        }
      }
    }
  }, [charts, mode, levelRole, condTitle])

  if (!row) return null
  if (!charts.length)
    return (
      <div style={{ padding: 12, fontSize: 12, color: UI.textMuted }}>
        No value for this gene — an undescribed curve has no parameters (set the Curve fit’s
        description to every gene).
      </div>
    )
  return <PlotlyChart data={data} layout={layout} />
}
