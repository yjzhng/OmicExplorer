import { useMemo } from 'react'

import { buildDumbbell, type ContrastResultRow } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, PALETTES, plotBase } from './theme'
import { useSelection } from './useSelection'
import { useUiTheme } from './useUiTheme'

/** Dumbbell: per gene, FC1 and FC2 dots joined by a line; sorted by |FCdiff|. The base
 *  set is top-N (or the GOI subset); hovered/pinned genes are appended so a linked
 *  selection shows up alongside rather than replacing the list. */
export function DumbbellView({
  rows,
  topGenes,
  displayMap,
  focus,
  title,
  orient = 'portrait'
}: {
  rows: ContrastResultRow[]
  topGenes: number
  displayMap?: Record<string, string>
  focus?: string[]
  title?: string
  /** portrait = genes down the y axis (tall list); landscape = genes across x. */
  orient?: 'landscape' | 'portrait'
}) {
  const mode = useUiTheme((s) => s.mode)
  const hoverId = useSelection((s) => s.hoverId)
  const pinnedIds = useSelection((s) => s.pinnedIds)

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    // `#rrggbb` → `rgba` so the connector can be a softened (lighter) grey.
    const rgba = (hex: string, a: number): string => {
      const h = hex.replace('#', '')
      return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`
    }
    const extra = new Set(pinnedIds)
    if (hoverId) extra.add(hoverId)
    const dumbbell = buildDumbbell(rows, { topGenes, displayMap, focus, extra: [...extra] })
    const genes = dumbbell.rows.map((r) => r.label)
    // Numerator (FC1) dot is orange; the denominator (FC2) dot is grey — the reference side.
    const [c1, c2] = [CATEGORICAL[1], p.textMuted]
    const landscape = orient === 'landscape'

    // Grey connector per gene, drawn as an ARROW pointing from the denominator (FC2) dot to the
    // numerator (FC1) dot — horizontal (FC on x) in portrait, vertical in landscape. The
    // stand-offs keep the arrow clear of the two markers.
    const arrows = dumbbell.rows.map((r) => ({
      // head = numerator (FC1), tail (ax/ay) = denominator (FC2)
      x: landscape ? r.label : r.fc1,
      y: landscape ? r.fc1 : r.label,
      ax: landscape ? r.label : r.fc2,
      ay: landscape ? r.fc2 : r.label,
      xref: 'x',
      yref: 'y',
      axref: 'x',
      ayref: 'y',
      showarrow: true,
      arrowhead: 2, // solid triangle
      arrowsize: 1,
      arrowwidth: 1.5,
      arrowcolor: rgba(p.textMuted, 0.7), // softened mid grey
      standoff: 5, // clearance from the numerator dot
      startstandoff: 5 // clearance from the denominator dot
    }))

    const dots = (key: 'fc1' | 'fc2', name: string, color: string) => ({
      type: 'scatter',
      mode: 'markers',
      name,
      x: landscape ? genes : dumbbell.rows.map((r) => r[key]),
      y: landscape ? dumbbell.rows.map((r) => r[key]) : genes,
      customdata: dumbbell.rows.map((r) => r.uniqID),
      hovertemplate: landscape
        ? `%{x}<br>${name}=%{y:.3f}<extra></extra>`
        : `%{y}<br>${name}=%{x:.3f}<extra></extra>`,
      marker: { color, size: 9 }
    })

    const heading = title ?? ''
    const fcAxis = { ...axisBase(p), title: 'log₂ fold change', zeroline: false }
    const geneAxis = {
      ...axisBase(p),
      type: 'category',
      categoryorder: 'array',
      // y runs bottom-up, so reverse in portrait to keep the top gene at the top.
      categoryarray: landscape ? genes : [...genes].reverse(),
      showgrid: true, // grid helps track each gene
      tickangle: landscape ? -45 : 0,
      automargin: true
    }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: heading ? { text: heading, font: { size: 13 } } : undefined,
      xaxis: landscape ? geneAxis : fcAxis,
      yaxis: landscape ? fcAxis : geneAxis,
      // Landscape (genes across x) keeps the legend on the right; portrait (tall gene list down
      // y) puts it horizontally on top, where it doesn't fight the long list for width.
      showlegend: true,
      legend: landscape
        ? { orientation: 'v', yanchor: 'top', y: 1, xanchor: 'left', x: 1.02 }
        : { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5 },
      annotations: arrows
    }
    return {
      data: [dots('fc1', dumbbell.xLabel1, c1), dots('fc2', dumbbell.xLabel2, c2)],
      layout: lay
    }
  }, [rows, topGenes, displayMap, focus, orient, hoverId, pinnedIds, title, mode])

  return <PlotlyChart data={data} layout={layout} />
}
