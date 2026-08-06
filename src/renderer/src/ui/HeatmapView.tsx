import { useMemo } from 'react'

import type { HeatmapData } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/** z[gene][sample] → z[sample][gene], preserving nulls. */
function transpose(z: Array<Array<number | null>>): Array<Array<number | null>> {
  const rows = z.length
  const cols = z[0]?.length ?? 0
  const out: Array<Array<number | null>> = Array.from({ length: cols }, () => new Array(rows))
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out[j][i] = z[i][j]
  return out
}

/** Interactive heatmap of genes × samples (log₁₀ intensity). Portrait keeps genes down
 *  the y axis (samples across the top); landscape transposes so genes run across x. */
export function HeatmapView({
  heatmap,
  title,
  orient = 'portrait'
}: {
  heatmap: HeatmapData
  title?: string
  orient?: 'landscape' | 'portrait'
}) {
  const mode = useUiTheme((s) => s.mode)

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const landscape = orient === 'landscape'
    const traces = [
      {
        type: 'heatmap',
        // Portrait: z[gene][sample] with genes on y. Landscape: transpose so genes are on x.
        z: landscape ? transpose(heatmap.z) : heatmap.z,
        x: landscape ? heatmap.y : heatmap.x,
        y: landscape ? heatmap.x : heatmap.y,
        colorscale: 'Viridis',
        colorbar: { title: { text: 'log₁₀', side: 'right' }, thickness: 12 },
        hovertemplate: landscape
          ? 'gene=%{x}<br>sample=%{y}<br>log₁₀=%{z:.2f}<extra></extra>'
          : 'gene=%{y}<br>sample=%{x}<br>log₁₀=%{z:.2f}<extra></extra>'
      }
    ]
    const geneAxis = {
      ...axisBase(p),
      title: 'gene',
      automargin: true,
      tickfont: { size: 9 },
      // Angle the gene ticks only when they sit on the x axis (landscape).
      ...(landscape ? { tickangle: -45 } : {})
    }
    const sampleAxis = {
      ...axisBase(p),
      title: 'sample',
      automargin: true,
      tickfont: { size: 9 },
      ...(landscape ? {} : { tickangle: -45 })
    }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: landscape ? geneAxis : sampleAxis,
      yaxis: landscape ? sampleAxis : geneAxis
    }
    return { data: traces, layout: lay }
  }, [heatmap, title, orient, mode])

  return <PlotlyChart data={data} layout={layout} />
}
