import { useMemo } from 'react'

import { condLabel, type ConditionKey, type QcData, type QcGroup } from '../engine'
import { conditionColorer } from './condColor'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, PALETTES, plotBase, QC_FILL, withAlpha } from './theme'
import { useUiTheme } from './useUiTheme'

/** How opaque the imputed share of a protein-count bar is: its bar's colour, lighter, so it reads
 *  as the measured bar's extension rather than another category. */
const IMPUTED_OPACITY = 0.35

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Per-sample QC plot for a standardized result: a violin, box, or bar chart of the chosen
 * metric (intensity distribution / %CV / protein count) with one category per sample (or,
 * for CV, per condition group). Violin/box show the distribution; bar shows each group's
 * summary (median for intensity/CV, the count for proteins). With imputation on, a protein-count
 * bar stacks the imputed proteins (lighter) on top of the measured ones. Marks take one colour, or
 * are coloured by condition — a categorical one picks the colour, dose/time the shade.
 */
export function QcPlotView({
  data,
  plot,
  title,
  color = QC_FILL,
  colorCat,
  colorNum,
  fit = false
}: {
  data: QcData
  plot: 'violin' | 'box' | 'bar'
  title?: string
  /** the single fill colour (hex), and the base a dose/time shades when it colours alone */
  color?: string
  /** colour by condition: the categorical one (colour) and/or the numeric one (shade) */
  colorCat?: ConditionKey
  colorNum?: ConditionKey
  /** bar plot: fit the value axis to the bar tops (with headroom) instead of starting at zero —
   *  near-equal counts read as level from zero */
  fit?: boolean
}) {
  const mode = useUiTheme((s) => s.mode)

  const { data: traces, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const labels = data.groups.map((g) => g.label)
    const byCond = conditionColorer(data.groups, (g: QcGroup) => g.meta, colorCat, colorNum, {
      base: color,
      missing: p.textMuted
    })
    const fillOf = (g: QcGroup): string => (byCond.on ? byCond.fill(g) : color)
    const fills = data.groups.map(fillOf)

    let trace: Record<string, unknown>
    let traces: Record<string, unknown>[] = []
    // Protein counts with imputation: the imputed proteins stacked on top of the measured ones.
    const stacked = plot === 'bar' && data.groups.some((g) => (g.imputed ?? 0) > 0)
    let extra: Record<string, unknown>[] = []
    if (plot === 'bar') {
      const measured = data.groups.map((g) =>
        data.summary === 'count' ? (g.values[0] ?? 0) : median(g.values)
      )
      trace = {
        type: 'bar',
        name: 'measured',
        x: labels,
        y: measured,
        marker: { color: fills, opacity: 0.85 },
        hovertemplate: stacked
          ? `%{x}<br>measured=%{y:,}<extra></extra>`
          : `%{x}<br>${data.yLabel}=%{y:.3g}<extra></extra>`
      }
      if (stacked)
        extra = [
          {
            type: 'bar',
            name: 'imputed',
            x: labels,
            y: data.groups.map((g) => g.imputed ?? 0),
            customdata: data.groups.map((g, i) => measured[i] + (g.imputed ?? 0)),
            marker: { color: fills, opacity: IMPUTED_OPACITY, line: { color: fills, width: 1 } },
            hovertemplate: `%{x}<br>imputed=%{y:,}<br>total=%{customdata:,}<extra></extra>`
          }
        ]
    } else {
      // (category, value) pairs, so one trace draws a violin/box per sample. One trace for every
      // sample in a single colour; one per sample when coloured by condition (a violin/box trace
      // takes one colour), overlaid so each keeps its own category's slot.
      const shapeOf = (gs: QcGroup[], ink: string): Record<string, unknown> => {
        const x: string[] = []
        const y: number[] = []
        for (const g of gs)
          for (const v of g.values) {
            x.push(g.label)
            y.push(v)
          }
        const common = {
          x,
          y,
          showlegend: false,
          line: { color: ink, width: 1 },
          fillcolor: withAlpha(ink, 0.35),
          hovertemplate: `%{x}<br>${data.yLabel}=%{y:.3g}<extra></extra>`
        }
        return plot === 'violin'
          ? {
              type: 'violin',
              ...common,
              // Density only (no per-point markers) so it stays fast with many proteins.
              points: false,
              spanmode: 'hard',
              box: { visible: true, width: 0.2 },
              meanline: { visible: false }
            }
          : { type: 'box', ...common, boxpoints: false }
      }
      if (byCond.on) {
        traces = data.groups.map((g, i) => shapeOf([g], fills[i]))
        trace = traces.shift()!
      } else trace = shapeOf(data.groups, color)
    }
    // The condition key: a swatch per categorical value, then per dose/time shade. Empty marker
    // traces — they draw nothing, the marks being their own traces.
    const key = (name: string, ink: string): Record<string, unknown> => ({
      type: 'scatter',
      mode: 'markers',
      name,
      x: [null],
      y: [null],
      marker: { symbol: 'square', size: 11, color: ink },
      hoverinfo: 'skip',
      showlegend: true
    })
    const numName = colorNum ? condLabel(colorNum) : ''
    const keys = byCond.on
      ? [
          ...byCond.cats.map((k) => key(k.value, k.color)),
          ...byCond.nums.map((k) =>
            key(byCond.cats.length ? `${numName} ${k.value}` : k.value, k.color)
          )
        ]
      : []

    // Fitted: from just under the lowest bar top to just over the highest (the full stack when the
    // imputed share is on top), so differences between samples show.
    let fitRange: [number, number] | undefined
    if (fit && plot === 'bar') {
      const tops = data.groups.map(
        (g) =>
          (data.summary === 'count' ? (g.values[0] ?? 0) : median(g.values)) +
          (stacked ? (g.imputed ?? 0) : 0)
      )
      const lo = Math.min(...tops)
      const hi = Math.max(...tops)
      const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1
      if (Number.isFinite(lo) && Number.isFinite(hi)) fitRange = [Math.max(0, lo - pad), hi + pad]
    }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: stacked || keys.length > 0,
      barmode: stacked ? 'stack' : undefined,
      violinmode: 'overlay',
      boxmode: 'overlay',
      legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom' },
      // Widen the marks and tighten the gaps between adjacent samples (defaults leave big gaps).
      bargap: 0.12,
      boxgap: 0.12,
      boxgroupgap: 0.05,
      violingap: 0.12,
      violingroupgap: 0.05,
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: {
        ...axisBase(p),
        type: 'category',
        tickangle: -45,
        tickfont: { size: 9 },
        automargin: true
      },
      yaxis: {
        ...axisBase(p),
        title: data.yLabel,
        automargin: true,
        // Counts/CV/log-intensity are all ≥0; let intensity (non-log) autoscale normally.
        ...(fitRange
          ? { range: fitRange }
          : {
              rangemode: data.metric === 'proteins' || data.metric === 'cv' ? 'tozero' : 'normal'
            })
      }
    }
    return { data: [trace, ...traces, ...extra, ...keys], layout: lay }
  }, [data, plot, title, mode, color, colorCat, colorNum, fit])

  return <PlotlyChart data={traces} layout={layout} />
}
