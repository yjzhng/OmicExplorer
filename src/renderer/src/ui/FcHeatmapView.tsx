import { useMemo } from 'react'

import type { FcHeatmapData } from '../engine'
import { DIVERGE_SCALE } from './colormap'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/** m[i][j] → m[j][i] (generic; preserves cell values incl. null). */
function transpose<T>(m: T[][]): T[][] {
  const rows = m.length
  const cols = m[0]?.length ?? 0
  const out: T[][] = Array.from({ length: cols }, () => new Array<T>(rows))
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out[j][i] = m[i][j]
  return out
}

/** log₂FC heatmap of genes × comparison columns on a diverging red/blue scale centred at 0
 *  (red = up, blue = down). Portrait keeps genes down y (comparisons across the top); landscape
 *  transposes so genes run across x. */
export function FcHeatmapView({
  data,
  title,
  orient = 'portrait'
}: {
  data: FcHeatmapData
  title?: string
  orient?: 'landscape' | 'portrait'
}) {
  const mode = useUiTheme((s) => s.mode)

  const { data: traces, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const landscape = orient === 'landscape'
    const m = data.absMax
    const trace: Record<string, unknown> = {
      type: 'heatmap',
      z: landscape ? transpose(data.z) : data.z,
      x: landscape ? data.genes : data.columns,
      y: landscape ? data.columns : data.genes,
      // Diverging scale symmetric about 0, sharing the bubble plot's fold-change palette:
      // negative log₂FC reads blue (down), positive red (up).
      colorscale: DIVERGE_SCALE,
      zmid: 0,
      zmin: -m,
      zmax: m,
      colorbar: { title: { text: 'log₂FC', side: 'right' }, thickness: 12 },
      hovertemplate: landscape
        ? 'gene=%{x}<br>%{y}<br>log₂FC=%{z:.2f}<extra></extra>'
        : 'gene=%{y}<br>%{x}<br>log₂FC=%{z:.2f}<extra></extra>'
    }
    const geneAxis = {
      ...axisBase(p),
      title: 'gene',
      automargin: true,
      tickfont: { size: 9 },
      ...(landscape ? { tickangle: -45 } : {})
    }
    const compAxis = {
      ...axisBase(p),
      title: 'comparison',
      automargin: true,
      tickfont: { size: 9 },
      ...(landscape ? {} : { tickangle: -45 })
    }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: landscape ? geneAxis : compAxis,
      yaxis: landscape ? compAxis : geneAxis
    }
    return { data: [trace], layout: lay }
  }, [data, title, orient, mode])

  return <PlotlyChart data={traces} layout={layout} />
}
