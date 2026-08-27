import { useMemo } from 'react'

import type { CorrData } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

// ColorBrewer "Greens", light → dark, so low r reads pale and r=1 reads deepest green.
// Explicit stops (not the named 'Greens') pin the direction across Plotly versions.
const GREENS: [number, string][] = [
  [0, '#f7fcf5'],
  [0.125, '#e5f5e0'],
  [0.25, '#c7e9c0'],
  [0.375, '#a1d99b'],
  [0.5, '#74c476'],
  [0.625, '#41ab5d'],
  [0.75, '#238b45'],
  [0.875, '#006d2c'],
  [1, '#00441b']
]

/** All-samples × all-samples correlation heatmap. Sequential greens from the colour floor
 *  (lowest observed r) to 1, so the diagonal and tight replicate blocks read as the darkest
 *  green. The y-axis is reversed so the matrix reads top-left → bottom-right like a table. */
export function CorrMatrixView({ data, title }: { data: CorrData; title?: string }) {
  const mode = useUiTheme((s) => s.mode)

  const { data: traces, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const trace: Record<string, unknown> = {
      type: 'heatmap',
      z: data.z,
      x: data.labels,
      y: data.labels,
      colorscale: GREENS,
      // Floor the scale a touch below the lowest r so the range isn't dominated by the 1.0
      // diagonal; keeps between-sample differences visible.
      zmin: Math.min(data.min, 0.99),
      zmax: 1,
      colorbar: { title: { text: 'r', side: 'right' }, thickness: 12 },
      hovertemplate: '%{y}<br>%{x}<br>r=%{z:.3f}<extra></extra>'
    }
    const axis = {
      ...axisBase(p),
      type: 'category',
      tickfont: { size: 8 },
      automargin: true
    }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: { ...axis, tickangle: -45 },
      // Reverse y so the first sample sits top-left (matrix convention).
      yaxis: { ...axis, autorange: 'reversed' }
    }
    return { data: [trace], layout: lay }
  }, [data, title, mode])

  return <PlotlyChart data={traces} layout={layout} />
}
