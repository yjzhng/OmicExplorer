import { useMemo } from 'react'

import type { ClusterData } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/** How many components the plot shows at most — past this the bars are unreadable and the tail
 *  carries no decision. */
const MAX_PCS = 20

/**
 * Variance explained per principal component (the scree plot): a bar per PC, with the running
 * cumulative total as a line.
 *
 * Both series are percentages of total variance, so they share ONE y-axis — a second scale would
 * make the two visually comparable when they aren't. They're told apart by mark type (bars vs
 * line) as well as colour, and the legend names both, so identity never rests on colour alone.
 *
 * It answers "how many components actually carry this dataset?" — a steep drop after PC1–2 means
 * the 2-D embedding is a fair summary; a flat scree means it isn't, and the scatter should be read
 * with that in mind.
 */
export function ScreeView({ cluster, title }: { cluster: ClusterData; title?: string }) {
  const mode = useUiTheme((s) => s.mode)

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const scree = cluster.diag?.scree ?? []
    const shown = scree.slice(0, MAX_PCS)
    const labels = shown.map((_, i) => `PC${i + 1}`)
    const pct = shown.map((v) => v * 100)
    // Cumulative over the components SHOWN, so the line's last point matches the bars above it.
    const cum: number[] = []
    for (const v of pct) cum.push((cum[cum.length - 1] ?? 0) + v)

    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: { ...axisBase(p), title: 'component', type: 'category' },
      yaxis: {
        ...axisBase(p),
        title: 'variance explained (%)',
        // Pinned to 0–100: the same dataset at a different PC count must not appear to change
        // shape because the axis rescaled.
        range: [0, 100],
        zeroline: false
      },
      showlegend: true,
      legend: { orientation: 'h', y: 1.08, x: 0, font: { size: 10 } },
      bargap: 0.35
    }

    const data: Array<Record<string, unknown>> = [
      {
        type: 'bar',
        name: 'per component',
        x: labels,
        y: pct,
        marker: { color: CATEGORICAL[0] },
        hovertemplate: '%{x}: %{y:.1f}%<extra></extra>'
      },
      {
        type: 'scatter',
        mode: 'lines+markers',
        name: 'cumulative',
        x: labels,
        y: cum,
        line: { color: p.textMuted, width: 2 },
        marker: { color: p.textMuted, size: 6 },
        hovertemplate: '%{x}: %{y:.1f}% cumulative<extra></extra>'
      }
    ]
    return { data, layout: lay }
  }, [cluster, title, mode])

  // PCA is the only method with a scree; UMAP/t-SNE carry no component variances to show.
  if (!cluster.diag?.scree?.length)
    return (
      <div
        style={{
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          padding: 16,
          fontSize: 12,
          color: 'var(--text-muted)',
          textAlign: 'center'
        }}
      >
        Variance explained is a PCA measure — switch the method to PCA to see it.
      </div>
    )

  return <PlotlyChart data={data} layout={layout} />
}
