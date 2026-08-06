import { useMemo } from 'react'

import type { ClusterData, ClusterPoint } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

type Mode = 'replicate' | 'centroid'

/** `#rrggbb` → `rgba(r,g,b,a)` for translucent territory fills. */
function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

/** Covariance "territory" ellipse (≈2σ) for a condition's replicate coords, as a
 *  polygon. Returns null for <2 points (nothing to enclose → centroid shows alone). */
function territory(pts: ClusterPoint[], scale = 2, segments = 48): Array<[number, number]> | null {
  const n = pts.length
  if (n < 2) return null
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const p of pts) {
    const dx = p.x - mx
    const dy = p.y - my
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  const d = n - 1
  sxx /= d
  syy /= d
  sxy /= d
  // Principal-axis angle + eigenvalues of the symmetric 2×2 covariance.
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const tr = sxx + syy
  const det = sxx * syy - sxy * sxy
  const disc = Math.sqrt(Math.max((tr * tr) / 4 - det, 0))
  const l1 = Math.max(tr / 2 + disc, 1e-9)
  const l2 = Math.max(tr / 2 - disc, 1e-9)
  const a = scale * Math.sqrt(l1)
  const b = scale * Math.sqrt(l2)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const poly: Array<[number, number]> = []
  for (let i = 0; i <= segments; i++) {
    const t = (2 * Math.PI * i) / segments
    const ex = a * Math.cos(t)
    const ey = b * Math.sin(t)
    poly.push([mx + ex * cos - ey * sin, my + ex * sin + ey * cos])
  }
  return poly
}

/** Sample/condition embedding (PCA / UMAP / t-SNE). In 'replicate' mode every point is
 *  drawn; in 'centroid' mode each condition collapses to a centroid + spread territory
 *  (single-replicate conditions just show the point). */
export function ClusterView({
  cluster,
  title,
  display = 'centroid'
}: {
  cluster: ClusterData
  title?: string
  display?: Mode
}) {
  const mode = useUiTheme((s) => s.mode)

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const groups = new Map<string, ClusterPoint[]>()
    for (const pt of cluster.points) {
      let arr = groups.get(pt.group)
      if (!arr) {
        arr = []
        groups.set(pt.group, arr)
      }
      arr.push(pt)
    }
    // Axis labels per method: PCA reports variance explained; UMAP/t-SNE are unitless.
    const pct = (v: number): string => `${(v * 100).toFixed(1)}%`
    const [xLabel, yLabel] =
      cluster.method === 'pca'
        ? [`PC1 (${pct(cluster.varExplained[0])})`, `PC2 (${pct(cluster.varExplained[1])})`]
        : cluster.method === 'umap'
          ? ['UMAP 1', 'UMAP 2']
          : ['t-SNE 1', 't-SNE 2']

    const traces: Array<Record<string, unknown>> = []
    let i = 0
    for (const [g, pts] of groups.entries()) {
      const color = CATEGORICAL[i % CATEGORICAL.length]
      const name = g || '(none)'
      if (display === 'replicate') {
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name,
          legendgroup: name,
          x: pts.map((pt) => pt.x),
          y: pts.map((pt) => pt.y),
          text: pts.map((pt) => pt.sample),
          hovertemplate: `%{text}<br>${xLabel}=%{x:.2f}<br>${yLabel}=%{y:.2f}<extra></extra>`,
          marker: { color, size: 10, opacity: 0.9 }
        })
      } else {
        // Collapse each condition's replicates to a centroid; draw a territory ellipse
        // for conditions with ≥2 replicates (others show the centroid alone).
        const byCond = new Map<string, ClusterPoint[]>()
        for (const pt of pts) {
          let arr = byCond.get(pt.cond)
          if (!arr) {
            arr = []
            byCond.set(pt.cond, arr)
          }
          arr.push(pt)
        }
        for (const reps of byCond.values()) {
          const poly = territory(reps)
          if (poly) {
            traces.push({
              type: 'scatter',
              mode: 'lines',
              name,
              legendgroup: name,
              showlegend: false,
              hoverinfo: 'skip',
              x: poly.map((q) => q[0]),
              y: poly.map((q) => q[1]),
              fill: 'toself',
              fillcolor: rgba(color, 0.13),
              line: { color: rgba(color, 0.5), width: 1 }
            })
          }
        }
        const cx = [...byCond.values()].map(
          (reps) => reps.reduce((s, r) => s + r.x, 0) / reps.length
        )
        const cy = [...byCond.values()].map(
          (reps) => reps.reduce((s, r) => s + r.y, 0) / reps.length
        )
        const labels = [...byCond.entries()].map(([cond, reps]) => `${cond} (n=${reps.length})`)
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name,
          legendgroup: name,
          x: cx,
          y: cy,
          text: labels,
          hovertemplate: `%{text}<br>${xLabel}=%{x:.2f}<br>${yLabel}=%{y:.2f}<extra></extra>`,
          marker: { color, size: 13, opacity: 0.95, line: { color: p.panel, width: 1.5 } }
        })
      }
      i++
    }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: { ...axisBase(p), title: xLabel, zeroline: false },
      yaxis: { ...axisBase(p), title: yLabel, zeroline: false }
    }
    return { data: traces, layout: lay }
  }, [cluster, title, display, mode])

  return <PlotlyChart data={data} layout={layout} />
}
