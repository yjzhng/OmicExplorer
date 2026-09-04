import { useMemo, type ReactNode } from 'react'

import type { ContrastResultRow } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/**
 * Response-compare: for ONE gene (chosen by the tile's gene pager — see GeneSwitch), overlay its
 * dose- (or time-) response profile on BOTH contrasted sides — side A (FC1) and side B (FC2) as two
 * curves against the axis. Answers "does this gene respond the same way in the two
 * datasets/contrasts?" A Contrast whose matched context includes the axis feeds it.
 */
export function ResponseCompareView({
  rows,
  displayMap,
  axis,
  gene,
  title
}: {
  rows: ContrastResultRow[]
  displayMap: Record<string, string>
  axis: 'dose' | 'time'
  /** the uniqID to plot (the pager picks it) */
  gene: string
  title?: string
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)

  const series = useMemo(() => {
    if (!gene) return null
    const mine = rows.filter((r) => r.uniqID === gene && r[axis] != null)
    if (mine.length === 0) return null
    // Mean per axis value (collapses any residual within-facet duplicates into one point per x).
    const byX = new Map<number, { a: number[]; b: number[] }>()
    for (const r of mine) {
      const x = Number(r[axis])
      if (!Number.isFinite(x)) continue
      let g = byX.get(x)
      if (!g) byX.set(x, (g = { a: [], b: [] }))
      if (r.FC1 != null && Number.isFinite(r.FC1)) g.a.push(r.FC1)
      if (r.FC2 != null && Number.isFinite(r.FC2)) g.b.push(r.FC2)
    }
    const xs = [...byX.keys()].sort((p, q) => p - q)
    const mean = (v: number[]): number | null => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null)
    return {
      xs,
      yA: xs.map((x) => mean(byX.get(x)!.a)),
      yB: xs.map((x) => mean(byX.get(x)!.b)),
      labelA: mine[0].cmp1 || 'A',
      labelB: mine[0].cmp2 || 'B',
      gene: displayMap[gene] ?? gene
    }
  }, [rows, gene, axis, displayMap])

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const heading = [title, series ? series.gene : null].filter(Boolean).join(' · ')
    // Categorical axis (evenly-spaced dose/time levels, in numeric order) — matching the compare
    // DR/TR, so unevenly-spaced levels (0, 2.5, 5, 10) read as steps, not a bunched linear scale.
    const cats = series ? series.xs.map(String) : []
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: heading ? { text: heading, font: { size: 13 } } : undefined,
      margin: { l: 52, r: 16, t: heading ? 34 : 14, b: 44 },
      xaxis: {
        ...axisBase(p),
        title: { text: axis },
        type: 'category',
        categoryorder: 'array',
        categoryarray: cats
      },
      yaxis: { ...axisBase(p), title: { text: 'value (log₂)' }, zeroline: true },
      legend: { orientation: 'h', y: -0.2, font: { size: 11 } },
      showlegend: true
    }
    if (!series) return { data: [] as unknown[], layout: lay }
    const line = (y: (number | null)[], color: string, name: string): Record<string, unknown> => ({
      type: 'scatter',
      mode: 'lines+markers',
      __oeNoLabel: true,
      x: cats,
      y,
      name,
      connectgaps: true,
      line: { color, width: 2 },
      marker: { color, size: 7 },
      hovertemplate: `${name}<br>${axis}=%{x}<br>log₂=%{y:.3f}<extra></extra>`
    })
    return {
      data: [line(series.yA, CATEGORICAL[0], series.labelA), line(series.yB, CATEGORICAL[3], series.labelB)],
      layout: lay
    }
  }, [series, mode, axis, title])

  if (!series)
    return <Center>This gene has no {axis} values in the contrast — match the contrast on {axis}.</Center>

  return <PlotlyChart data={data} layout={layout} />
}

/** Centered empty-state message. */
function Center({ children }: { children: ReactNode }): ReactNode {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        textAlign: 'center',
        fontSize: 12,
        color: 'var(--text-muted)'
      }}
    >
      {children}
    </div>
  )
}
