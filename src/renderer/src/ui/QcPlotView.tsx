import { useMemo } from 'react'

import type { QcData } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/** QC colour — a calm steel blue (matches the app's `data` category), distinct from the
 *  greyscale accent so the violins/boxes/bars read clearly in both themes. */
const QC_FILL = '#6ea8fe'

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
 * summary (median for intensity/CV, the count for proteins).
 */
export function QcPlotView({
  data,
  plot,
  title
}: {
  data: QcData
  plot: 'violin' | 'box' | 'bar'
  title?: string
}) {
  const mode = useUiTheme((s) => s.mode)

  const { data: traces, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const labels = data.groups.map((g) => g.label)

    let trace: Record<string, unknown>
    if (plot === 'bar') {
      trace = {
        type: 'bar',
        x: labels,
        y: data.groups.map((g) => (data.summary === 'count' ? g.values[0] ?? 0 : median(g.values))),
        marker: { color: QC_FILL, opacity: 0.85 },
        hovertemplate: `%{x}<br>${data.yLabel}=%{y:.3g}<extra></extra>`
      }
    } else {
      // Flatten to (category, value) pairs so a single trace draws one violin/box per sample.
      const x: string[] = []
      const y: number[] = []
      for (const g of data.groups)
        for (const v of g.values) {
          x.push(g.label)
          y.push(v)
        }
      trace =
        plot === 'violin'
          ? {
              type: 'violin',
              x,
              y,
              // Density only (no per-point markers) so it stays fast with many proteins.
              points: false,
              spanmode: 'hard',
              box: { visible: true, width: 0.2 },
              meanline: { visible: false },
              line: { color: QC_FILL, width: 1 },
              fillcolor: 'rgba(110,168,254,0.35)',
              hovertemplate: `%{x}<br>${data.yLabel}=%{y:.3g}<extra></extra>`
            }
          : {
              type: 'box',
              x,
              y,
              boxpoints: false,
              line: { color: QC_FILL, width: 1 },
              fillcolor: 'rgba(110,168,254,0.35)',
              hovertemplate: `%{x}<br>${data.yLabel}=%{y:.3g}<extra></extra>`
            }
    }

    const lay: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: false,
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
        rangemode: data.metric === 'proteins' || data.metric === 'cv' ? 'tozero' : 'normal'
      }
    }
    return { data: [trace], layout: lay }
  }, [data, plot, title, mode])

  return <PlotlyChart data={traces} layout={layout} />
}
