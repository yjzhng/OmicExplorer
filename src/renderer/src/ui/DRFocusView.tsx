/**
 * One gene's dose (or time) response from a Compare — the dose-response tile's focused view.
 *
 *  - A t-test's per-dose rows: its log₂FC at each level (error bars = the fold change's SE), one
 *    line per comparison, the levels evenly spaced as in the overview — with each replicate as a
 *    point (its value over the control's mean, log₂), from the Clean data the Compare ran on.
 *  - A curve fit: the fitted curve (log₂ ratio to the control) over log dose, the measured points
 *    it was fitted to, its 95% confidence band (the error), and its EC50 — one per comparison.
 */
import { useMemo } from 'react'

import {
  curveBand,
  curvePointsFromStd,
  logistic,
  replicateLog2FCs,
  stdByGene,
  type CompareResultRow,
  type StandardRow
} from '../engine'
import { drLook, type DRLook, type EffectColors } from '../graph/types'
import { AUTO } from './ColorPicker'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, EFFECT_COLOR, PALETTES, plotBase, withAlpha } from './theme'
import { useUiTheme } from './useUiTheme'

/** Points along a fitted curve. */
const SAMPLES = 60
const DEFAULT_LOOK = drLook({})

/** A curve fit's error: its 95% confidence band (curveBand — where the true curve plausibly lies),
 *  on the plot's log₂ scale. Along the whole curve for a band; at the tested doses for whiskers.
 *  `x` is the linear dose.
 *
 *  Always drawn: a wide or infinite edge is capped at `cap` (the axis range doubled about its
 *  middle) — past the axis it's clipped anyway; the cap only keeps it finite. A band that can't
 *  be computed at all (too few points, a parameter the data don't determine) is infinite: it fills
 *  to the cap. `unbounded` says so, for the curve's hover. */
function fitError(
  c: NonNullable<CompareResultRow['curve']>,
  got: { x?: number[]; y?: number[] },
  style: DRLook['errorStyle'],
  cap: [number, number]
): { x: number[]; mid: number[]; lo: number[]; hi: number[]; unbounded: boolean } | null {
  const at =
    style === 'band'
      ? Array.from({ length: SAMPLES }, (_, i) => c.xMin + ((c.xMax - c.xMin) * i) / (SAMPLES - 1))
      : [...new Set(got.x ?? [])].sort((a, b) => a - b)
  const mid = at.map((lx) => Math.log2(logistic(lx, c)))
  if (!mid.every(Number.isFinite)) return null
  const band = curveBand(c, got.x ?? [], got.y ?? [], at)
  let unbounded = !band
  const clampTo = (v: number | undefined, edge: number): number => {
    if (v == null || !Number.isFinite(v)) {
      unbounded = true
      return edge
    }
    return Math.min(cap[1], Math.max(cap[0], v))
  }
  const lo = mid.map((_, i) => clampTo(band?.lo[i], cap[0]))
  const hi = mid.map((_, i) => clampTo(band?.hi[i], cap[1]))
  return { x: at.map((lx) => 10 ** lx), mid, lo, hi, unbounded }
}

/** The error around a series' values, from `lo` to `hi`: whiskers (an error_y on a trace of its
 *  own, so their opacity is theirs, not the line's) or a shaded band between them — drawn under
 *  the line. */
function errorTraces(
  x: Array<string | number>,
  y: number[],
  lo: number[],
  hi: number[],
  ink: string,
  style: DRLook['errorStyle']
): Record<string, unknown>[] {
  if (style === 'whisker')
    return [
      {
        type: 'scatter',
        mode: 'markers',
        x,
        y,
        marker: { size: 0, opacity: 0 },
        error_y: {
          type: 'data',
          symmetric: false,
          array: hi.map((h, i) => h - y[i]),
          arrayminus: lo.map((l, i) => y[i] - l),
          visible: true,
          color: ink,
          thickness: 1
        },
        showlegend: false,
        hoverinfo: 'skip'
      }
    ]
  const common = { type: 'scatter', mode: 'lines', x, showlegend: false, hoverinfo: 'skip' }
  return [
    { ...common, y: hi, line: { width: 0, color: ink } },
    { ...common, y: lo, line: { width: 0, color: ink }, fill: 'tonexty', fillcolor: ink }
  ]
}

/** A gene's effect group in one comparison: a curve fit's own call; for a t-test, the direction
 *  of its strongest significant level (none when no level is significant). */
function geneEffect(rows: CompareResultRow[]): 'up' | 'down' | 'none' {
  let best: CompareResultRow | undefined
  for (const r of rows)
    if (r.signf && r.effect !== 'none' && r.log2FC != null)
      if (!best || Math.abs(r.log2FC) > Math.abs(best.log2FC as number)) best = r
  return (best?.effect as 'up' | 'down' | undefined) ?? 'none'
}

/** One gene's y extent as the focused view draws it — the fitted curves and their measured points
 *  (not their confidence band), or the t-test's fold changes with their SE and replicates (the
 *  points and error only while shown) — widened into `acc`. The global scale is every gene's extent (see DRFocusView). */
function widenExtent(
  acc: [number, number],
  rows: CompareResultRow[],
  geneStd: StandardRow[],
  axis: 'dose' | 'time',
  look: DRLook
): void {
  const add = (v: number | null | undefined): void => {
    if (v == null || !Number.isFinite(v)) return
    if (v < acc[0]) acc[0] = v
    if (v > acc[1]) acc[1] = v
  }
  const curves = rows.filter((r) => r.curve && r.curve.axis === axis)
  if (curves.length) {
    for (const r of curves) {
      const c = r.curve!
      // A logistic is monotonic: its ends bound it.
      add(Math.log2(logistic(c.xMin, c)))
      add(Math.log2(logistic(c.xMax, c)))
      // The band is an overlay on the data, not data: it never sets the scale (a fit the data
      // don't pin down would stretch the axis without bound) — it's clipped at the axis instead.
      if (!look.points) continue
      const got = curvePointsFromStd(r, geneStd, axis) ?? c
      for (const y of got.y ?? []) if (y > 0) add(Math.log2(y))
    }
    return
  }
  for (const r of rows) {
    if (r[axis] == null || r.log2FC == null) continue
    const se = look.errors ? (r.fcSE ?? 0) : 0
    add(r.log2FC - se)
    add(r.log2FC + se)
    if (look.points) for (const y of replicateLog2FCs(r, geneStd)) add(y)
  }
}

export function DRFocusView({
  rows,
  axis,
  axisLabel,
  gene,
  std,
  title,
  look = DEFAULT_LOOK,
  scaleRows,
  effectColors
}: {
  /** the gene's rows in the facet on show (one comparison or several) */
  rows: CompareResultRow[]
  axis: 'dose' | 'time'
  /** the dose/time axis's title, with its unit (absent = the bare axis name) */
  axisLabel?: string
  /** the gene (for its replicates in `std`) */
  gene?: string
  /** the Clean data rows the Compare ran on — a t-test's replicates are drawn from them */
  std?: StandardRow[]
  title?: string
  /** line / point / error look (the tile's settings) */
  look?: DRLook
  /** rows the y RANGE is computed over — the whole Compare, so paging genes (and switching facets)
   *  keeps one scale and the responses stay comparable. Unset = autorange per gene. */
  scaleRows?: CompareResultRow[]
  /** the upstream Compare's effect colours — a lone line's automatic colour */
  effectColors?: EffectColors
}) {
  const mode = useUiTheme((s) => s.mode)
  // Memo inputs kept primitive: the parent hands a fresh colours object per render.
  const upColor = effectColors?.up ?? EFFECT_COLOR.up
  const downColor = effectColors?.down ?? EFFECT_COLOR.down
  const noneColor = effectColors?.none ?? EFFECT_COLOR.none
  const geneStd = useMemo(
    () => (std && gene ? std.filter((s) => s.uniqID === gene) : []),
    [std, gene]
  )
  // One shared y range across the whole Compare: every gene's extent as drawn (see widenExtent).
  // Memoized on the row array — stable until the Compare re-runs — not recomputed per gene.
  const yRange = useMemo((): [number, number] | null => {
    if (!scaleRows?.length) return null
    const byGene = new Map<string, CompareResultRow[]>()
    for (const r of scaleRows) {
      const g = byGene.get(r.uniqID)
      if (g) g.push(r)
      else byGene.set(r.uniqID, [r])
    }
    const stdOf = stdByGene(std ?? [])
    const acc: [number, number] = [Infinity, -Infinity]
    for (const [id, rs] of byGene) widenExtent(acc, rs, stdOf.get(id) ?? [], axis, look)
    if (!(acc[0] <= acc[1])) return null
    const pad = (acc[1] - acc[0] || 1) * 0.05
    return [acc[0] - pad, acc[1] + pad]
  }, [scaleRows, std, axis, look])
  // Per gene, Plotly's autorange would take in a curve's band too; while one can be drawn, the range
  // is set the same way the global one is, from what the gene draws less the band.
  const geneRange = useMemo((): [number, number] | null => {
    if (!look.errors || !rows.some((r) => r.curve && r.curve.axis === axis)) return null
    const acc: [number, number] = [Infinity, -Infinity]
    widenExtent(acc, rows, geneStd, axis, look)
    if (!(acc[0] <= acc[1])) return null
    const pad = (acc[1] - acc[0] || 1) * 0.05
    return [acc[0] - pad, acc[1] + pad]
  }, [rows, geneStd, axis, look])
  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    // The y range, when set (global, or per gene while a curve's band can be drawn), and the cap a
    // curve's band is held to: that range doubled about its middle.
    const range = yRange ?? geneRange
    const cap = (r: [number, number]): [number, number] => {
      const w = r[1] - r[0]
      return [r[0] - w / 2, r[1] + w / 2]
    }
    const comparisons = [...new Set(rows.map((r) => r.comparison))]
    // A comparison's line colour, unless one colour is set for every line: with one line, the
    // gene's effect group (up / down / none, as the volcano colours it); with several, one palette
    // colour per comparison. Points and error follow it unless they have a colour of their own.
    const color = (c: string): string =>
      look.lineColor !== AUTO
        ? look.lineColor
        : comparisons.length === 1
          ? { up: upColor, down: downColor, none: noneColor }[
              geneEffect(rows.filter((r) => r.comparison === c))
            ]
          : CATEGORICAL[comparisons.indexOf(c) % CATEGORICAL.length]
    const pointColor = (line: string): string => (look.pointColor !== AUTO ? look.pointColor : line)
    const errorColor = (line: string): string => (look.errorColor !== AUTO ? look.errorColor : line)
    const traces: Record<string, unknown>[] = []
    const shapes: Record<string, unknown>[] = []
    const curves = rows.filter((r) => r.curve && r.curve.axis === axis)

    if (curves.length) {
      for (const r of curves) {
        const c = r.curve!
        const col = color(r.comparison)
        const xs: number[] = []
        const ys: number[] = []
        for (let i = 0; i < SAMPLES; i++) {
          const lx = c.xMin + ((c.xMax - c.xMin) * i) / (SAMPLES - 1)
          xs.push(10 ** lx)
          ys.push(Math.log2(logistic(lx, c)))
        }
        // The measured points — every replicate — from the Clean data the fit ran on (any result),
        // else from those kept with the fit (newer runs).
        const got = curvePointsFromStd(r, geneStd, axis) ?? c
        const pts = (got.x ?? []).map((x, i) => ({ x: 10 ** x, ratio: got.y?.[i] ?? NaN }))
        // The 4PL's 95% confidence band, under the curve: a shaded band along it, or whiskers on it
        // at the tested doses, capped (fitError); an unbounded stretch is said in the hover.
        const e = look.errors && range ? fitError(c, got, look.errorStyle, cap(range)) : null
        const noBand = e?.unbounded
          ? "<br><i>band unbounded — the data don't constrain this fit</i>"
          : ''
        // Every curve is drawn as its 4PL (the volcano's estimate); one whose F-test doesn't reject
        // flat says so — its final model (CompareResultRow.model) is M0.
        const modelNote = r.model === 'M0' ? "<br><i>F-test doesn't reject flat (model M0)</i>" : ''
        traces.push({
          type: 'scatter',
          mode: 'lines',
          name: r.comparison,
          x: xs,
          y: ys,
          line: { color: col, width: look.lineWidth },
          opacity: look.lineOpacity,
          hovertemplate: `${axis}=%{x:.3g}<br>fit log₂ ratio=%{y:.3f}${modelNote}${noBand}<extra>${r.comparison}</extra>`
        })
        if (e)
          traces.unshift(
            ...errorTraces(
              e.x,
              e.mid,
              e.lo,
              e.hi,
              withAlpha(errorColor(col), look.errorOpacity),
              look.errorStyle
            )
          )
        if (look.points && pts.length)
          traces.push({
            type: 'scatter',
            mode: 'markers',
            name: `${r.comparison} (measured)`,
            showlegend: false,
            x: pts.map((q) => q.x),
            y: pts.map((q) => (q.ratio > 0 ? Math.log2(q.ratio) : null)),
            marker: {
              color: pointColor(col),
              size: look.pointSize,
              opacity: look.pointOpacity,
              line: { color: p.panel, width: 1 }
            },
            hovertemplate: `${axis}=%{x:.3g}<br>log₂ ratio=%{y:.3f}<extra>${r.comparison}</extra>`
          })
        // EC50, where it falls within the tested doses — a 4PL's only (M0 has none).
        const ec50 = -c.pec50
        if (ec50 >= c.xMin && ec50 <= c.xMax)
          shapes.push({
            type: 'line',
            x0: 10 ** ec50,
            x1: 10 ** ec50,
            yref: 'paper',
            y0: 0,
            y1: 1,
            line: { color: col, width: 1, dash: 'dot' }
          })
      }
    } else {
      // A t-test: its fold change at each level, joined, with the fold change's SE as its error.
      for (const c of comparisons) {
        const pts = rows
          .filter((r) => r.comparison === c && r[axis] != null && r.log2FC != null)
          .sort((a, b) => (a[axis] as number) - (b[axis] as number))
        if (!pts.length) continue
        const col = color(c)
        const xs = pts.map((r) => String(r[axis]))
        // The fold change's SE, under the line.
        if (look.errors && pts.some((r) => r.fcSE != null))
          traces.push(
            ...errorTraces(
              xs,
              pts.map((r) => r.log2FC as number),
              pts.map((r) => (r.log2FC as number) - (r.fcSE ?? 0)),
              pts.map((r) => (r.log2FC as number) + (r.fcSE ?? 0)),
              withAlpha(errorColor(col), look.errorOpacity),
              look.errorStyle
            )
          )
        traces.push({
          type: 'scatter',
          mode: 'lines',
          name: c,
          x: xs,
          y: pts.map((r) => r.log2FC),
          line: { color: col, width: look.lineWidth },
          opacity: look.lineOpacity,
          hovertemplate: `${axis}=%{x}<br>log₂FC=%{y:.3f}<extra>${c}</extra>`
        })
        // The replicates behind each mean, on the same log₂ scale as the line.
        const rx: string[] = []
        const ry: number[] = []
        for (const r of pts)
          for (const y of replicateLog2FCs(r, geneStd)) {
            rx.push(String(r[axis]))
            ry.push(y)
          }
        if (look.points && rx.length)
          traces.push({
            type: 'scatter',
            mode: 'markers',
            name: `${c} (replicates)`,
            showlegend: false,
            x: rx,
            y: ry,
            marker: {
              color: pointColor(col),
              size: look.pointSize,
              opacity: look.pointOpacity,
              line: { color: p.panel, width: 1 }
            },
            hovertemplate: `${axis}=%{x}<br>replicate log₂FC=%{y:.3f}<extra>${c}</extra>`
          })
      }
    }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: traces.filter((t) => t.showlegend !== false).length > 1,
      legend: { yanchor: 'middle', y: 0.5 },
      title: title ? { text: title, font: { size: 13 } } : undefined,
      // Log dose: one tick per decade (Plotly would otherwise label 2s and 5s in between).
      xaxis: curves.length
        ? { ...axisBase(p), title: axisLabel ?? axis, type: 'log', dtick: 1 }
        : { ...axisBase(p), title: axisLabel ?? axis, type: 'category' },
      yaxis: {
        ...axisBase(p),
        title: curves.length ? 'log₂ ratio to control' : 'log₂FC',
        zeroline: true,
        // Fixed to the Compare-wide range when one is given (see yRange); otherwise autorange.
        ...(range ? { range, autorange: false } : null)
      },
      shapes
    }
    return { data: traces, layout: lay }
  }, [
    rows,
    axis,
    axisLabel,
    title,
    mode,
    geneStd,
    look,
    yRange,
    geneRange,
    upColor,
    downColor,
    noneColor
  ])

  if (!data.length)
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted, #888)' }}>
        No response for this gene here.
      </div>
    )
  return <PlotlyChart data={data} layout={layout} />
}
