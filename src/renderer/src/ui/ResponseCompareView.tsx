import { useMemo, type ReactNode } from 'react'

import type { ContrastResultRow } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/** `#rrggbb` → `rgba(r,g,b,a)` for translucent error-band fills. */
function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

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
  title,
  yLabel = 'log₂FC'
}: {
  rows: ContrastResultRow[]
  displayMap: Record<string, string>
  axis: 'dose' | 'time'
  /** the uniqID to plot (the pager picks it) */
  gene: string
  title?: string
  /** y-axis title reflecting what FC1/FC2 represent (log10 abundance vs log2 fold-change); the
   *  tooltip uses it too */
  yLabel?: string
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)

  const series = useMemo(() => {
    if (!gene) return null
    const mine = rows.filter((r) => r.uniqID === gene && r[axis] != null)
    if (mine.length === 0) return null
    // Mean per axis value (collapses any residual within-facet duplicates into one point per x).
    // ae/be collect each side's uncertainty (fold-change SE or abundance SD) for the error band.
    const byX = new Map<number, { a: number[]; b: number[]; ae: number[]; be: number[] }>()
    for (const r of mine) {
      const x = Number(r[axis])
      if (!Number.isFinite(x)) continue
      let g = byX.get(x)
      if (!g) byX.set(x, (g = { a: [], b: [], ae: [], be: [] }))
      if (r.FC1 != null && Number.isFinite(r.FC1)) g.a.push(r.FC1)
      if (r.FC2 != null && Number.isFinite(r.FC2)) g.b.push(r.FC2)
      if (r.FC1err != null && Number.isFinite(r.FC1err)) g.ae.push(r.FC1err)
      if (r.FC2err != null && Number.isFinite(r.FC2err)) g.be.push(r.FC2err)
    }
    const xs = [...byX.keys()].sort((p, q) => p - q)
    const mean = (v: number[]): number | null =>
      v.length ? v.reduce((s, x) => s + x, 0) / v.length : null
    return {
      xs,
      yA: xs.map((x) => mean(byX.get(x)!.a)),
      yB: xs.map((x) => mean(byX.get(x)!.b)),
      eA: xs.map((x) => mean(byX.get(x)!.ae)),
      eB: xs.map((x) => mean(byX.get(x)!.be)),
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
      yaxis: { ...axisBase(p), title: { text: yLabel }, zeroline: true },
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
      hovertemplate: `${name}<br>${axis}=%{x}<br>${yLabel}=%{y:.3f}<extra></extra>`
    })
    // Shaded ±error band as lower/upper trace pairs: the upper trace fills down to the immediately
    // preceding (lower) trace via `tonexty` — the canonical Plotly band, which renders reliably on
    // a categorical axis (a single self-closing polygon does not). Drawn behind the line.
    // One pair PER CONTIGUOUS RUN of points that have both a value and an error: Plotly closes a
    // `tonexty` fill with the previous trace's path joined ACROSS its gaps, so a band with a null
    // in it (a single-replicate dose with no SE, or a dose present on one side only) came out as
    // a polygon cutting diagonally across the gap, no longer following the line.
    const band = (
      y: (number | null)[],
      e: (number | null)[],
      color: string
    ): Record<string, unknown>[] => {
      const common = {
        type: 'scatter',
        mode: 'lines',
        __oeNoLabel: true,
        hoverinfo: 'skip',
        showlegend: false,
        line: { width: 0 }
      }
      // Split into runs first (a null starts a new run), then shade each run of ≥2 points — a
      // lone point has no area.
      const runs: { x: string[]; lo: number[]; hi: number[] }[] = []
      let open = false
      for (let i = 0; i < cats.length; i++) {
        const v = y[i]
        const err = e[i]
        if (v == null || err == null || !Number.isFinite(v) || !Number.isFinite(err)) {
          open = false
          continue
        }
        if (!open) {
          runs.push({ x: [], lo: [], hi: [] })
          open = true
        }
        const run = runs[runs.length - 1]
        run.x.push(cats[i])
        run.lo.push(v - err)
        run.hi.push(v + err)
      }
      return runs
        .filter((run) => run.x.length >= 2)
        .flatMap((run) => [
          { ...common, x: run.x, y: run.lo },
          { ...common, x: run.x, y: run.hi, fill: 'tonexty', fillcolor: rgba(color, 0.2) }
        ])
    }
    return {
      data: [
        ...band(series.yA, series.eA, CATEGORICAL[0]),
        ...band(series.yB, series.eB, CATEGORICAL[3]),
        line(series.yA, CATEGORICAL[0], series.labelA),
        line(series.yB, CATEGORICAL[3], series.labelB)
      ],
      layout: lay
    }
  }, [series, mode, axis, title, yLabel])

  if (!series)
    return (
      <Center>
        This gene has no {axis} values in the contrast — match the contrast on {axis}.
      </Center>
    )

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
