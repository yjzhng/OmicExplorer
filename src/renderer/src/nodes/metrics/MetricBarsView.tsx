/**
 * Curve metrics plot: one gene's curve-fit parameter as a bar chart — the metric the tile's switch
 * picks (potency, slope, plateaus, R², peak, q). A surface has one bar per slice level along its
 * curves (see metricBarsOf), so how the parameter moves across the levels shows, coloured along the
 * levels' palette; one-axis curves one bar per comparison, side by side (compound A vs B).
 */
import { useMemo } from 'react'

import { condLabel, type CompareResultRow, type ConditionKey } from '../../engine'
import {
  metricBarsOf,
  type MetricBars,
  type MetricCtx,
  type MetricId
} from '../../graph/results/metricBars'
import { tooltip } from '../../ui/plot/condTooltip'
import { paletteSeries } from '../../ui/color/palettes'
import { PlotlyChart } from '../../ui/plot/PlotlyChart'
import { axisBase, CATEGORICAL, PALETTES, plotBase, UI } from '../../ui/app/theme'
import { useRolePalette } from '../../ui/app/useAppSettings'
import { useUiTheme } from '../../ui/app/useUiTheme'

/** One-axis curves' bars for a gene: one per context (a comparison at a level of the other
 *  conditions), named as the fold-change heatmap names its columns — what varies ("Bortezomib ·
 *  time 960") — and its row there (none: no curve of it in that context). `title`: what every
 *  context shares (the comparison, "dose curve | baseline"), as the heatmap's axis title; `by`:
 *  the one condition they differ in, if one (its levels coloured along its palette). */
export interface AcrossBars {
  by?: ConditionKey
  title: string
  items: Array<{ at: string; row?: CompareResultRow }>
}

export function MetricBarsView({
  row,
  across,
  metric,
  ctx,
  condTitle
}: {
  /** a surface: the gene's row in the facet on show (its slices are the bars) */
  row?: CompareResultRow
  /** one-axis curves: the gene's curve in every context, one bar each */
  across?: AcrossBars
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
  const flat = ctx.flat
  const charts = useMemo(
    () => metricCharts(row, across, metric, { unit, scale, delta, flat }),
    [row, across, metric, unit, scale, delta, flat]
  )
  const by = charts.find((c) => c.by)?.by
  const levelRole = useRolePalette(by === 'time' ? 'time' : 'dose')
  const { data, layout } = useMemo(() => {
    const acrossTitle = across?.title
    const p = PALETTES[mode]
    const c = charts[0]
    if (!c) return { data: [], layout: {} }
    const levels = c.bars.length
    // one bar per context, named on the axis: along the condition's palette when they differ in
    // one condition (as a surface's slices), else one colour
    const many = c.bars.length > 1 && !c.by
    const colors = c.by
      ? c.bars.map((_, k) => paletteSeries(levelRole, k, levels))
      : [CATEGORICAL[0]]
    const xs = c.bars.map((b) => (c.by || many ? b.at : c.label))
    // A bar at exactly 0 — a change's own reference slice — has no height to see: drawn as a band a
    // few pixels tall across the zero line, the bar's own width and colour. Sized in pixels, so it
    // never sets the axis's range (all bars 0 would otherwise zoom onto it).
    const zero = c.bars.flatMap((b, k) => (b.value === 0 ? [k] : []))
    const gap = c.by || many ? 0.2 : 0.6
    return {
      data: [
        {
          type: 'bar',
          x: xs,
          y: c.bars.map((b) => b.value),
          marker: { color: c.by ? colors : colors[0] },
          // one-axis curves' contexts: the bar's own name heads it (as the heatmap's column)
          hovertemplate: tooltip(
            across
              ? { title: '%{x}', values: [[c.label, '%{y:.3g}']] }
              : {
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
          // one-axis curves: what every context shares, as the heatmap titles its columns
          title: across ? acrossTitle : c.by ? condTitle(c.by) : undefined,
          showticklabels: !!c.by || many,
          // long context names slant up to their bar, as the heatmap's columns (Plotly's own
          // auto-rotation turns them the other way, +30°)
          ...(many ? { tickangle: -45 } : null),
          automargin: true
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
  }, [charts, mode, levelRole, condTitle, across])

  if (!row && !across) return null
  if (!charts.length)
    return (
      <div style={{ padding: 12, fontSize: 12, color: UI.textMuted }}>
        No value for this gene — an undescribed curve has no parameters (set the Curve fit’s
        description to every gene).
      </div>
    )
  return <PlotlyChart controls="none" data={data} layout={layout} />
}

/** The bars on show: a surface's per slice (metricBarsOf); one-axis curves' one per context, each
 *  its curve's value (none where it has none — no curve there, or undescribed). Empty when no
 *  curve has the metric. */
function metricCharts(
  row: CompareResultRow | undefined,
  across: AcrossBars | undefined,
  metric: MetricId,
  ctx: MetricCtx
): MetricBars[] {
  if (!across) return row ? metricBarsOf(row, [metric], ctx) : []
  const per = across.items.map((it) =>
    it.row ? metricBarsOf(it.row, [metric], ctx)[0] : undefined
  )
  const first = per.find(Boolean)
  if (!first) return []
  return [
    {
      id: first.id,
      label: first.label,
      ...(across.by ? { by: across.by } : null),
      bars: across.items.map((it, k) => ({ at: it.at, value: per[k]?.bars[0]?.value ?? null }))
    }
  ]
}
