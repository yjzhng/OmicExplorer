import { useMemo } from 'react'

import type { GeneBarData } from '../engine'
import { valueColor, type ValueRange } from './colormap'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/** Focus genes' standardized value across every condition — grouped bars (mean ± sd),
 *  one series per gene. Landscape draws vertical bars (conditions across x); portrait
 *  draws horizontal bars (conditions down y). When `range` is given, each bar is filled by
 *  its value on the shared viridis scale (matching the Heatmap tile and data table) and the
 *  value axis is log-scaled whenever that scale is (raw-intensity data); otherwise bars use a
 *  per-gene categorical colour on a linear axis. */
export function GeneBarView({
  bar,
  title,
  orient = 'landscape',
  range
}: {
  bar: GeneBarData
  title?: string
  orient?: 'landscape' | 'portrait'
  range?: ValueRange
}) {
  const mode = useUiTheme((s) => s.mode)

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const horizontal = orient === 'portrait'
    const barColor = range ? valueColor(range) : null
    const logVal = range?.log ?? false
    // Error bars in the strong text colour so the ± sd whiskers read against both the coloured
    // bars and the panel background (the faint border colour was not legible). Asymmetric arrays
    // (errUp/errDown) so log-space spread renders as unequal linear whiskers on the log axis.
    const err = (gb: { errUp: number; errDown: number }[]) => ({
      type: 'data',
      symmetric: false,
      array: gb.map((b) => b.errUp),
      arrayminus: gb.map((b) => b.errDown),
      visible: true,
      color: p.text,
      thickness: 1.4,
      width: 3
    })
    const traces = bar.genes.map((g, i) => {
      const gb = bar.bars.filter((b) => b.uniqID === g.uniqID)
      const conds = gb.map((b) => b.cond)
      const means = gb.map((b) => b.mean)
      const marker = barColor
        ? { color: gb.map((b) => barColor(b.mean) ?? 'rgba(0,0,0,0)') }
        : { color: CATEGORICAL[i % CATEGORICAL.length] }
      return {
        type: 'bar',
        name: g.label,
        orientation: horizontal ? 'h' : 'v',
        x: horizontal ? means : conds,
        y: horizontal ? conds : means,
        [horizontal ? 'error_x' : 'error_y']: err(gb),
        marker
      }
    })
    const condAxis = {
      ...axisBase(p),
      title: 'condition',
      automargin: true,
      ...(horizontal ? {} : { tickangle: -40 })
    }
    // Log-scale the value axis when the data is log-scaled (matches the heatmap/colour map).
    // Force MAJOR decade ticks only (10¹, 10², 10³ …) — Plotly's auto log ticks otherwise mix in
    // 2/5 mantissa ticks (…2, 5, 1000, 2, 5, 10k…), which reads as confusing. Labels use <sup> so
    // they render as proper powers of ten.
    const logTicks: Record<string, unknown> = {}
    if (logVal && range) {
      const eLo = Math.floor(Math.log10(range.min))
      const eHi = Math.ceil(Math.log10(range.max))
      const tickvals: number[] = []
      const ticktext: string[] = []
      for (let e = eLo; e <= eHi; e++) {
        tickvals.push(Math.pow(10, e))
        ticktext.push(`10<sup>${e}</sup>`)
      }
      // Pin the axis to the global decade span so the decade ticks always fall inside the visible
      // range (a single gene's bars may sit within one decade, which would otherwise clip every
      // tick), and so the value axis reads the same across genes. Log-axis range is in log10 units.
      Object.assign(logTicks, {
        type: 'log',
        tickmode: 'array',
        tickvals,
        ticktext,
        range: [eLo, eHi]
      })
    }
    const valAxis = { ...axisBase(p), title: 'value', ...logTicks }
    // Baseline where "NaN" labels sit. On a log axis Plotly wants annotation coords as log10 of
    // the value, so anchor at log10(min) (the bottom of the data); linear sits at 0.
    const valBase = logVal && range && range.min > 0 ? Math.log10(range.min) : 0
    // Missing conditions (mean null) draw no bar; label the empty slot "NaN" at the baseline.
    const annotations = bar.bars
      .filter((b) => b.mean == null)
      .map((b) => ({
        [horizontal ? 'y' : 'x']: b.cond,
        [horizontal ? 'x' : 'y']: valBase,
        text: 'NaN',
        showarrow: false,
        font: { size: 10, color: p.textMuted },
        ...(horizontal ? { xanchor: 'left', xshift: 4 } : { yanchor: 'bottom', yshift: 3 })
      }))
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      barmode: 'group',
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: horizontal ? valAxis : condAxis,
      yaxis: horizontal ? condAxis : valAxis,
      ...(annotations.length > 0 ? { annotations } : {})
    }
    return { data: traces, layout: lay }
  }, [bar, title, orient, mode, range])

  return <PlotlyChart data={data} layout={layout} />
}
