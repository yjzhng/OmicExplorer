import { useMemo } from 'react'

import type { TdrData } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/** One gene's time-series dose-response: x = dose, one line per time level, y = log2FC. */
export function TdrView({ tdr, title }: { tdr: TdrData; title?: string }) {
  const mode = useUiTheme((s) => s.mode)

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const traces = tdr.series.map((s, i) => ({
      type: 'scatter',
      mode: 'lines+markers',
      name: `time ${s.time}`,
      x: s.points.map((q) => q.x),
      y: s.points.map((q) => q.y),
      line: { color: CATEGORICAL[i % CATEGORICAL.length], width: 2 },
      marker: { size: 6 }
    }))
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: { ...axisBase(p), title: 'dose' },
      yaxis: { ...axisBase(p), title: 'log₂ fold change', zeroline: true }
    }
    return { data: traces, layout: lay }
  }, [tdr, title, mode])

  return <PlotlyChart data={data} layout={layout} />
}
