import { useMemo } from 'react'

import type { ClusterData } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/**
 * PCA loadings: the most influential features in the PC1/PC2 plane, each drawn as a vector from the
 * origin and labelled.
 *
 * Where the PC plot shows how the SAMPLES relate, this shows which measurements drive that
 * separation. A feature's direction says which samples it pushes apart; its length says how
 * strongly. Two features pointing the same way move together; opposed features trade off.
 *
 * Its own axes, on the loading scale — nothing is rescaled to sit over the sample scores, so the
 * numbers on the axes are the loadings themselves.
 */
export function LoadingView({ cluster, title }: { cluster: ClusterData; title?: string }) {
  const mode = useUiTheme((s) => s.mode)

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const lo = cluster.loadings ?? []
    const pct = (v: number): string => `${(v * 100).toFixed(1)}%`
    // Axis titles match the PC plot's, so the two read as views of one decomposition.
    const [xLabel, yLabel] = [
      `PC1 loading (${pct(cluster.varExplained[0])})`,
      `PC2 loading (${pct(cluster.varExplained[1])})`
    ]
    // Square, symmetric limits centred on the origin: direction is the thing being read, and an
    // auto-fitted asymmetric box would shear the angles.
    const extent = Math.max(...lo.flatMap((l) => [Math.abs(l.x), Math.abs(l.y)]), 1e-9) * 1.25

    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: { ...axisBase(p), title: xLabel, range: [-extent, extent], zeroline: true },
      yaxis: {
        ...axisBase(p),
        title: yLabel,
        range: [-extent, extent],
        zeroline: true,
        // Equal aspect, so an angle on screen is the angle in the data.
        scaleanchor: 'x',
        scaleratio: 1
      },
      showlegend: false,
      // A label at each vector's tip, nudged outward along the vector so it clears the head.
      annotations: lo.map((l) => {
        const n = Math.hypot(l.x, l.y) || 1
        return {
          x: l.x,
          y: l.y,
          xref: 'x',
          yref: 'y',
          text: l.label,
          showarrow: false,
          font: { size: 9, color: p.text },
          xshift: (l.x / n) * 12,
          yshift: (l.y / n) * 12
        }
      })
    }

    // One trace for every vector — `null` breaks the line between them, so they read as separate
    // rays from the origin rather than one zig-zag through it.
    const vx: Array<number | null> = []
    const vy: Array<number | null> = []
    for (const l of lo) {
      vx.push(0, l.x, null)
      vy.push(0, l.y, null)
    }
    const data: Array<Record<string, unknown>> = [
      {
        type: 'scatter',
        mode: 'lines',
        showlegend: false,
        hoverinfo: 'skip',
        x: vx,
        y: vy,
        line: { color: p.textMuted, width: 1 }
      },
      // The tips carry the hover, so a feature can be identified without reading the label.
      {
        type: 'scatter',
        mode: 'markers',
        showlegend: false,
        x: lo.map((l) => l.x),
        y: lo.map((l) => l.y),
        text: lo.map((l) => l.label),
        hovertemplate: `%{text}<br>PC1=%{x:.3f}<br>PC2=%{y:.3f}<extra></extra>`,
        marker: { color: p.text, size: 6 }
      }
    ]
    return { data, layout: lay }
  }, [cluster, title, mode])

  if (!cluster.loadings?.length)
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
        Loadings are a PCA measure — switch the method to PCA to see them.
      </div>
    )

  return <PlotlyChart data={data} layout={layout} />
}
