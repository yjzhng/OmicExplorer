import { useMemo, type ReactNode } from 'react'

import { condLabel, ctxNum, type ConditionKey, type ContrastResultRow } from '../engine'
import { drLook, type DRLook } from '../graph/types'
import { AUTO } from './ColorPicker'
import { tooltip } from './condTooltip'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, PALETTES, plotBase, withAlpha } from './theme'
import { useUiTheme } from './useUiTheme'

const DEFAULT_LOOK = drLook({})

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
  axisLabel,
  gene,
  title,
  yLabel = 'log₂FC',
  scaleRows,
  look = DEFAULT_LOOK
}: {
  rows: ContrastResultRow[]
  displayMap: Record<string, string>
  axis: ConditionKey
  /** the dose/time axis's title, with its unit (absent = the bare axis name) */
  axisLabel?: string
  /** the uniqID to plot (the pager picks it) */
  gene: string
  title?: string
  /** y-axis title reflecting what FC1/FC2 represent (log10 abundance vs log2 fold-change); the
   *  tooltip uses it too */
  yLabel?: string
  /** rows the y RANGE is computed over — the whole contrast, so paging genes (and switching
   *  facets) keeps one scale and the curves stay comparable. Unset = autorange per gene. */
  scaleRows?: ContrastResultRow[]
  /** line / point / error look (the tile's settings); an automatic colour is one per side */
  look?: DRLook
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)

  const series = useMemo(() => {
    if (!gene) return null
    const mine = rows.filter((r) => r.uniqID === gene && ctxNum(r, axis) != null)
    if (mine.length === 0) return null
    // Mean per axis value (collapses any residual within-facet duplicates into one point per x).
    // ae/be collect each side's uncertainty (fold-change SE or abundance SD) for the error band,
    // ar/br its replicates (the points).
    const byX = new Map<
      number,
      { a: number[]; b: number[]; ae: number[]; be: number[]; ar: number[]; br: number[] }
    >()
    for (const r of mine) {
      const x = ctxNum(r, axis)
      if (x == null) continue
      let g = byX.get(x)
      if (!g) byX.set(x, (g = { a: [], b: [], ae: [], be: [], ar: [], br: [] }))
      if (r.FC1 != null && Number.isFinite(r.FC1)) g.a.push(r.FC1)
      if (r.FC2 != null && Number.isFinite(r.FC2)) g.b.push(r.FC2)
      if (r.FC1err != null && Number.isFinite(r.FC1err)) g.ae.push(r.FC1err)
      if (r.FC2err != null && Number.isFinite(r.FC2err)) g.be.push(r.FC2err)
      for (const v of r.FC1reps ?? []) if (Number.isFinite(v)) g.ar.push(v)
      for (const v of r.FC2reps ?? []) if (Number.isFinite(v)) g.br.push(v)
    }
    const xs = [...byX.keys()].sort((p, q) => p - q)
    // A side's replicates as (level, value) points, the level as its category.
    const reps = (k: 'ar' | 'br'): { x: string[]; y: number[] } => {
      const out = { x: [] as string[], y: [] as number[] }
      for (const x of xs)
        for (const v of byX.get(x)![k]) {
          out.x.push(String(x))
          out.y.push(v)
        }
      return out
    }
    const mean = (v: number[]): number | null =>
      v.length ? v.reduce((s, x) => s + x, 0) / v.length : null
    return {
      xs,
      yA: xs.map((x) => mean(byX.get(x)!.a)),
      yB: xs.map((x) => mean(byX.get(x)!.b)),
      eA: xs.map((x) => mean(byX.get(x)!.ae)),
      eB: xs.map((x) => mean(byX.get(x)!.be)),
      rA: reps('ar'),
      rB: reps('br'),
      labelA: mine[0].cmp1 || 'A',
      labelB: mine[0].cmp2 || 'B',
      gene: displayMap[gene] ?? gene
    }
  }, [rows, gene, axis, displayMap])

  // One shared y range across the whole contrast (error bands included), so the scale doesn't
  // jump as the pager moves between genes. Memoized on the row array — the contrast's rows are a
  // stable reference until it re-runs, so this is computed once per result, not per gene.
  const showErr = look.errors
  const showPts = look.points
  const yRange = useMemo((): [number, number] | null => {
    if (!scaleRows?.length) return null
    let lo = Infinity
    let hi = -Infinity
    for (const r of scaleRows) {
      for (const [v, e] of [
        [r.FC1, r.FC1err],
        [r.FC2, r.FC2err]
      ] as const) {
        if (v == null || !Number.isFinite(v)) continue
        const err = showErr && e != null && Number.isFinite(e) ? Math.abs(e) : 0
        if (v - err < lo) lo = v - err
        if (v + err > hi) hi = v + err
      }
      if (showPts)
        for (const v of [...(r.FC1reps ?? []), ...(r.FC2reps ?? [])]) {
          if (!Number.isFinite(v)) continue
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
    }
    if (!(lo <= hi)) return null
    const pad = (hi - lo || 1) * 0.05
    return [lo - pad, hi + pad]
  }, [scaleRows, showErr, showPts])

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
        title: { text: axisLabel ?? condLabel(axis) },
        type: 'category',
        categoryorder: 'array',
        categoryarray: cats
      },
      // Fixed to the contrast-wide range when one is available (see yRange); otherwise autorange.
      yaxis: {
        ...axisBase(p),
        title: { text: yLabel },
        zeroline: true,
        ...(yRange ? { range: yRange, autorange: false } : null)
      },
      // Right of the plot, vertically centred.
      legend: {
        orientation: 'v',
        x: 1.02,
        xanchor: 'left',
        y: 0.5,
        yanchor: 'middle',
        font: { size: 11 }
      },
      showlegend: true,
      // A Contrast run before replicates were carried has none to draw (its rows lack the fields
      // altogether; a newer run sets them, null where a side had none) — say so, not nothing.
      annotations:
        look.points &&
        rows.length &&
        rows.every((r) => r.FC1reps === undefined && r.FC2reps === undefined)
          ? [
              {
                text: 'Re-run the Contrast to show replicate points',
                xref: 'paper',
                yref: 'paper',
                x: 1,
                y: 1,
                xanchor: 'right',
                yanchor: 'bottom',
                showarrow: false,
                font: { size: 10, color: p.textMuted }
              }
            ]
          : []
    }
    if (!series) return { data: [] as unknown[], layout: lay }
    // A side's colour: one per side (automatic), unless one colour is set for every line; points
    // and error follow it unless they have a colour of their own.
    const sideColor = (i: number): string =>
      look.lineColor !== AUTO ? look.lineColor : CATEGORICAL[i === 0 ? 0 : 3]
    const pointColor = (c: string): string => (look.pointColor !== AUTO ? look.pointColor : c)
    const errorColor = (c: string): string => (look.errorColor !== AUTO ? look.errorColor : c)
    const line = (y: (number | null)[], color: string, name: string): Record<string, unknown> => ({
      type: 'scatter',
      mode: 'lines',
      __oeNoLabel: true,
      x: cats,
      y,
      name,
      connectgaps: true,
      line: { color, width: look.lineWidth },
      opacity: look.lineOpacity,
      hovertemplate: tooltip(
        { title: name, conds: [[condLabel(axis), '%{x}']], values: [[yLabel, '%{y:.3f}']] },
        p.textMuted,
        { template: true }
      )
    })
    // The replicates behind each side's means, as points of their own (so their look is theirs).
    const points = (
      pts: { x: string[]; y: number[] },
      color: string,
      name: string
    ): Record<string, unknown> => ({
      type: 'scatter',
      mode: 'markers',
      __oeNoLabel: true,
      x: pts.x,
      y: pts.y,
      name: `${name} (replicates)`,
      showlegend: false,
      marker: {
        color: pointColor(color),
        size: look.pointSize,
        opacity: look.pointOpacity,
        line: { color: p.panel, width: 1 }
      },
      hovertemplate: tooltip(
        {
          title: name,
          conds: [[condLabel(axis), '%{x}']],
          values: [[`replicate ${yLabel}`, '%{y:.3f}']]
        },
        p.textMuted,
        { template: true }
      )
    })
    // Whiskers: an error_y on a trace of its own, so their opacity is theirs, not the line's.
    const whiskers = (
      y: (number | null)[],
      e: (number | null)[],
      color: string
    ): Record<string, unknown> => ({
      type: 'scatter',
      mode: 'markers',
      __oeNoLabel: true,
      x: cats,
      y,
      marker: { size: 0, opacity: 0 },
      error_y: {
        type: 'data',
        array: e.map((v) => v ?? 0),
        visible: true,
        color: withAlpha(errorColor(color), look.errorOpacity),
        thickness: 1
      },
      showlegend: false,
      hoverinfo: 'skip'
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
          {
            ...common,
            x: run.x,
            y: run.hi,
            fill: 'tonexty',
            fillcolor: withAlpha(errorColor(color), look.errorOpacity)
          }
        ])
    }
    const sides = [
      { y: series.yA, e: series.eA, r: series.rA, label: series.labelA, color: sideColor(0) },
      { y: series.yB, e: series.eB, r: series.rB, label: series.labelB, color: sideColor(1) }
    ]
    return {
      data: [
        // Error under the lines, the points over them.
        ...(look.errors
          ? sides.flatMap((d) =>
              look.errorStyle === 'band'
                ? band(d.y, d.e, d.color)
                : d.e.some((v) => v != null)
                  ? [whiskers(d.y, d.e, d.color)]
                  : []
            )
          : []),
        ...sides.map((d) => line(d.y, d.color, d.label)),
        ...(look.points
          ? sides.filter((d) => d.r.y.length).map((d) => points(d.r, d.color, d.label))
          : [])
      ],
      layout: lay
    }
  }, [series, mode, axis, axisLabel, title, yLabel, yRange, look, rows])

  if (!series)
    return (
      <Center>
        This gene has no {condLabel(axis)} values in the contrast — match the contrast on{' '}
        {condLabel(axis)}.
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
