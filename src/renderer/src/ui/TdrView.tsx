import { useMemo } from 'react'

import type { TdrData } from '../engine'
import { reds } from './colormap'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/** One gene's time-series dose-response: x = dose, one line per time level, y = log2FC. */
export function TdrView({ tdr, title }: { tdr: TdrData; title?: string }) {
  const mode = useUiTheme((s) => s.mode)

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    // Discrete x: dose levels are spaced evenly as categories (not by numeric value), so a
    // series like 1.25…80 reads at equal intervals. Categories = distinct doses, numerically
    // sorted; x is emitted as strings to match.
    const cats = [...new Set(tdr.series.flatMap((s) => s.points.map((q) => q.x)))]
      .sort((a, b) => a - b)
      .map(String)
    // Time is ordinal, so colour the series with a SEQUENTIAL Reds map ordered by time —
    // early → late reads light → dark red. Start above 0 so the earliest line isn't near-white.
    const ordered = [...tdr.series].sort((a, b) => Number(a.time) - Number(b.time))
    const n = ordered.length
    const traces = ordered.map((s, i) => {
      const [r, g, b] = reds(0.25 + 0.75 * (n > 1 ? i / (n - 1) : 0.5))
      const color = `rgb(${r | 0},${g | 0},${b | 0})`
      return {
        type: 'scatter',
        mode: 'lines+markers',
        name: `time ${s.time}`,
        x: s.points.map((q) => String(q.x)),
        y: s.points.map((q) => q.y),
        line: { color, width: 2 },
        marker: { size: 6, color }
      }
    })
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: {
        ...axisBase(p),
        title: 'dose',
        type: 'category',
        categoryorder: 'array',
        categoryarray: cats
      },
      yaxis: { ...axisBase(p), title: 'log₂ fold change', zeroline: true }
    }
    return { data: traces, layout: lay }
  }, [tdr, title, mode])

  return <PlotlyChart data={data} layout={layout} />
}
