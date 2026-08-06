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
    const extra = new Set(pinnedIds)
    if (hoverId) extra.add(hoverId)
    const dumbbell = buildDumbbell(rows, { topGenes, displayMap, focus, extra: [...extra] })
    const genes = dumbbell.rows.map((r) => r.label)
    const [c1, c2] = [CATEGORICAL[0], CATEGORICAL[1]]
    const landscape = orient === 'landscape'

    // connector line per gene: horizontal (FC on x) in portrait, vertical in landscape.
    const shapes = dumbbell.rows.map((r) => {
      const line = { color: r.signf ? p.text : p.textMuted, width: r.signf ? 2 : 1 }
      return landscape
        ? { type: 'line', x0: r.label, x1: r.label, y0: r.fc1, y1: r.fc2, line }
        : { type: 'line', x0: r.fc1, x1: r.fc2, y0: r.label, y1: r.label, line }
    })

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

    const note =
      dumbbell.total > dumbbell.rows.length
        ? `top ${dumbbell.rows.length} of ${dumbbell.total} genes`
        : ''
    const heading = [title, note].filter(Boolean).join(' · ')
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
      shapes
    }
    return {
      data: [dots('fc1', dumbbell.xLabel1, c1), dots('fc2', dumbbell.xLabel2, c2)],
      layout: lay
    }
  }, [rows, topGenes, displayMap, focus, orient, hoverId, pinnedIds, title, mode])

  return <PlotlyChart data={data} layout={layout} />
}
