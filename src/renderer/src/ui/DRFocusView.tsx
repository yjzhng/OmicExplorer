/**
 * One gene's dose (or time) response from a Compare — the dose-response tile's focused view — or
 * several genes' at once, each in its own colour (its detailed view).
 *
 *  - A t-test's per-dose rows: its log₂FC at each level (error bars = the fold change's SE), one
 *    line per comparison, the levels evenly spaced as in the overview — with each replicate as a
 *    point (its value over the control's mean, log₂), from the Clean data the Compare ran on.
 *  - A curve fit: the fitted curve (log₂ ratio to the control) over log dose, the measured points
 *    it was fitted to, its 95% confidence band (the error), and its EC50 — one per comparison.
 *  - A response surface method curve fit: its description 4PL or its spline (`model`), the level
 *    means it was fitted to, and the 4PL's midpoint — no band (none is estimated yet).
 */
import { useMemo } from 'react'

import {
  comparisonOf,
  condLabel,
  ctxNum,
  curveBand,
  curvePointsFromStd,
  curveSampleX,
  curveDescribed,
  logistic,
  replicateLog2FCs,
  responseCurve,
  stdByGene,
  xUnits,
  type CompareResultRow,
  type ConditionKey,
  type StandardRow
} from '../engine'
import { drLook, type DRLook, type EffectColors } from '../graph/types'
import { AUTO } from './ColorPicker'
import { tooltip } from './condTooltip'
import { errorTraces } from './errorTraces'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, EFFECT_COLOR, PALETTES, plotBase, withAlpha } from './theme'
import { useUiTheme } from './useUiTheme'

/** Evenly spaced points along a fitted curve (more are added at its turns — curveSampleX). */
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
    style === 'band' ? curveSampleX(c, SAMPLES) : [...new Set(got.x ?? [])].sort((a, b) => a - b)
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
  return { x: at.map((lx) => xUnits(c, lx)), mid, lo, hi, unbounded }
}

/** A curve fit's measured points: those kept with the fit — exactly what it was fitted to — else,
 *  for results run before they were kept, rebuilt from the Clean data (curvePointsFromStd). */
function curvePoints(
  r: CompareResultRow,
  geneStd: StandardRow[],
  axis: ConditionKey
): { x?: number[]; y?: number[] } {
  const c = r.curve!
  return c.x && c.rep ? c : (curvePointsFromStd(r, geneStd, axis) ?? c)
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
  axis: ConditionKey,
  look: DRLook,
  model: 'spline' | 'curve'
): void {
  const add = (v: number | null | undefined): void => {
    if (v == null || !Number.isFinite(v)) return
    if (v < acc[0]) acc[0] = v
    if (v > acc[1]) acc[1] = v
  }
  const responses = rows.filter((r) => r.rs?.axis === axis)
  if (responses.length) {
    for (const r of responses) {
      const c = responseCurve(r, model)
      if (!c) continue
      for (const y of c.y) add(y)
      if (look.points) for (const q of c.points) add(q.y)
    }
    return
  }
  const curves = rows.filter((r) => r.curve && r.curve.axis === axis)
  if (curves.length) {
    for (const r of curves) {
      const c = r.curve!
      // A logistic is monotonic: its ends bound it. An undescribed curve is drawn flat at 0.
      if (curveDescribed(c)) {
        add(Math.log2(logistic(c.xMin, c)))
        add(Math.log2(logistic(c.xMax, c)))
      } else add(0)
      // The band is an overlay on the data, not data: it never sets the scale (a fit the data
      // don't pin down would stretch the axis without bound) — it's clipped at the axis instead.
      if (!look.points) continue
      const got = curvePoints(r, geneStd, axis)
      for (const y of got.y ?? []) if (y > 0) add(Math.log2(y))
    }
    return
  }
  for (const r of rows) {
    if (ctxNum(r, axis) == null || r.log2FC == null) continue
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
  genes,
  displayMap,
  std,
  title,
  look = DEFAULT_LOOK,
  scaleRows,
  effectColors,
  model = 'curve'
}: {
  /** the gene's rows in the facet on show (one comparison or several) — or, with `genes`, those
   *  genes' rows */
  rows: CompareResultRow[]
  axis: ConditionKey
  /** the dose/time axis's title, with its unit (absent = the bare axis name) */
  axisLabel?: string
  /** the gene (for its replicates in `std`) */
  gene?: string
  /** several genes at once (the detailed view), in colour order: each drawn as one gene is, in its
   *  own colour (the global view's for it), named in the legend */
  genes?: string[]
  /** uniqID → display name, for the legend / hover with several genes */
  displayMap?: Record<string, string>
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
  /** a response surface method curve fit: draw the description 4PL ('curve') or the spline */
  model?: 'spline' | 'curve'
}) {
  const mode = useUiTheme((s) => s.mode)
  // Memo inputs kept primitive: the parent hands a fresh colours object per render.
  const upColor = effectColors?.up ?? EFFECT_COLOR.up
  const downColor = effectColors?.down ?? EFFECT_COLOR.down
  const noneColor = effectColors?.none ?? EFFECT_COLOR.none
  // The genes drawn, in colour order, and each one's Clean data rows (for its replicates).
  const ids = useMemo(
    () => genes ?? (gene ? [gene] : [...new Set(rows.map((r) => r.uniqID))]),
    [genes, gene, rows]
  )
  const stdOf = useMemo(() => stdByGene(std ?? []), [std])
  const rowsOf = useMemo(() => {
    const m = new Map<string, CompareResultRow[]>(ids.map((id) => [id, []]))
    for (const r of rows) m.get(r.uniqID)?.push(r)
    return m
  }, [rows, ids])
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
    const acc: [number, number] = [Infinity, -Infinity]
    for (const [id, rs] of byGene) widenExtent(acc, rs, stdOf.get(id) ?? [], axis, look, model)
    if (!(acc[0] <= acc[1])) return null
    const pad = (acc[1] - acc[0] || 1) * 0.05
    return [acc[0] - pad, acc[1] + pad]
  }, [scaleRows, stdOf, axis, look, model])
  // Per gene, Plotly's autorange would take in a curve's band too; while one can be drawn, the range
  // is set the same way the global one is, from what the genes draw less the band.
  const geneRange = useMemo((): [number, number] | null => {
    if (
      !look.errors ||
      !rows.some((r) => (r.curve && r.curve.axis === axis) || r.rs?.axis === axis)
    )
      return null
    const acc: [number, number] = [Infinity, -Infinity]
    for (const [id, rs] of rowsOf) widenExtent(acc, rs, stdOf.get(id) ?? [], axis, look, model)
    if (!(acc[0] <= acc[1])) return null
    const pad = (acc[1] - acc[0] || 1) * 0.05
    return [acc[0] - pad, acc[1] + pad]
  }, [rows, rowsOf, stdOf, axis, look, model])
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
    const multi = ids.length > 1
    const label = (id: string): string => displayMap?.[id] ?? id
    // A series' line colour, unless one colour is set for every line: with several genes, the
    // gene's (the global view's palette, by its place); else, with one line, the gene's effect
    // group (up / down / none, as the volcano colours it); with several, one palette colour per
    // comparison. Points and error follow it unless they have a colour of their own.
    const color = (id: string, gRows: CompareResultRow[], c: string): string =>
      look.lineColor !== AUTO
        ? look.lineColor
        : multi
          ? CATEGORICAL[ids.indexOf(id) % CATEGORICAL.length]
          : comparisons.length === 1
            ? { up: upColor, down: downColor, none: noneColor }[
                geneEffect(gRows.filter((r) => r.comparison === c))
              ]
            : CATEGORICAL[comparisons.indexOf(c) % CATEGORICAL.length]
    // Several genes over several comparisons: the gene sets the colour, the comparison the dash.
    const dash = (c: string): string | undefined =>
      multi && comparisons.length > 1 ? DASHES[comparisons.indexOf(c) % DASHES.length] : undefined
    // A series' legend name: its comparison, or with several genes the gene (and comparison).
    const nameOf = (id: string, c: string): string =>
      multi ? (comparisons.length > 1 ? `${label(id)} · ${c}` : label(id)) : c
    const pointColor = (line: string): string => (look.pointColor !== AUTO ? look.pointColor : line)
    const errorColor = (line: string): string => (look.errorColor !== AUTO ? look.errorColor : line)
    const traces: Record<string, unknown>[] = []
    const shapes: Record<string, unknown>[] = []
    const curves = rows.filter((r) => r.curve && r.curve.axis === axis)
    const responses = rows.filter((r) => r.rs?.axis === axis)

    for (const id of ids) {
      const gRows = rowsOf.get(id) ?? []
      const geneStd = stdOf.get(id) ?? []
      // The gene's name in the hover. (No gene identity on the traces: these are lines and their
      // points, not gene points — linked selection mustn't emphasise them as a volcano's.)
      const who = multi ? { title: label(id) } : {}
      if (responses.length) {
        // The response surface method: the chosen line, the level means it was fitted to, and (when
        // shown) the 4PL's midpoint (no band — none is estimated for it yet).
        for (const r of gRows.filter((r) => r.rs?.axis === axis)) {
          const c = responseCurve(r, model)
          if (!c) continue
          const col = color(id, gRows, r.comparison)
          const what = c.drawn === 'curve' ? '4PL' : 'spline'
          traces.push({
            type: 'scatter',
            mode: 'lines',
            name: nameOf(id, r.comparison),
            x: c.x,
            y: c.y,
            line: { color: col, width: look.lineWidth, dash: dash(r.comparison) },
            opacity: look.lineOpacity,
            hovertemplate:
              tooltip(
                {
                  ...who,
                  conds: [
                    ['comparison', r.comparison],
                    [condLabel(axis), '%{x:.3g}']
                  ],
                  values: [[`${what} log₂ vs control`, '%{y:.3f}']]
                },
                p.textMuted
              ) + `<extra></extra>`
          })
          if (look.points && c.points.length)
            traces.push({
              type: 'scatter',
              mode: 'markers',
              name: `${nameOf(id, r.comparison)} (level means)`,
              showlegend: false,
              x: c.points.map((q) => q.x),
              y: c.points.map((q) => q.y),
              marker: {
                color: pointColor(col),
                size: look.pointSize,
                opacity: look.pointOpacity,
                line: { color: p.panel, width: 1 }
              },
              hovertemplate:
                tooltip(
                  {
                    ...who,
                    conds: [
                      ['comparison', r.comparison],
                      [condLabel(axis), '%{x:.3g}']
                    ],
                    values: [['mean log₂ vs control', '%{y:.3f}']]
                  },
                  p.textMuted
                ) + `<extra></extra>`
            })
          if (look.ec50Line && c.mid != null)
            shapes.push({
              type: 'line',
              x0: c.mid,
              x1: c.mid,
              yref: 'paper',
              y0: 0,
              y1: 1,
              line: { color: col, width: 1, dash: 'dot' }
            })
        }
      } else if (curves.length) {
        for (const r of gRows.filter((r) => r.curve && r.curve.axis === axis)) {
          const c = r.curve!
          const col = color(id, gRows, r.comparison)
          // Undescribed (its run described responders only, and it isn't one): drawn flat at 0,
          // with no band and no EC50 — as a response surface method curve without a description.
          const described = curveDescribed(c)
          const at = curveSampleX(c, SAMPLES)
          const xs = at.map((lx) => xUnits(c, lx))
          const ys = at.map((lx) => (described ? Math.log2(logistic(lx, c)) : 0))
          // The measured points — every replicate — the fit was made on (see curvePoints).
          const got = curvePoints(r, geneStd, axis)
          const pts = (got.x ?? []).map((x, i) => ({ x: xUnits(c, x), ratio: got.y?.[i] ?? NaN }))
          // The 4PL's 95% confidence band, under the curve: a shaded band along it, or whiskers on
          // it at the tested doses, capped (fitError); an unbounded stretch is said in the hover.
          const e =
            described && look.errors && range ? fitError(c, got, look.errorStyle, cap(range)) : null
          const noBand = e?.unbounded
            ? "<br><i>band unbounded — the data don't constrain this fit</i>"
            : ''
          // Every curve is drawn as its 4PL (the volcano's estimate); one whose F-test doesn't
          // reject flat says so — its final model (CompareResultRow.model) is M0.
          const modelNote = !described
            ? '<br><i>not described (responders only)</i>'
            : r.model === 'M0'
              ? "<br><i>F-test doesn't reject flat (model M0)</i>"
              : ''
          traces.push({
            type: 'scatter',
            mode: 'lines',
            name: nameOf(id, r.comparison),
            x: xs,
            y: ys,
            line: { color: col, width: look.lineWidth, dash: dash(r.comparison) },
            opacity: look.lineOpacity,
            hovertemplate:
              tooltip(
                {
                  ...who,
                  conds: [
                    ['comparison', r.comparison],
                    [condLabel(axis), '%{x:.3g}']
                  ],
                  values: [['fit log₂ ratio', '%{y:.3f}']]
                },
                p.textMuted
              ) + `${modelNote}${noBand}<extra></extra>`
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
              name: `${nameOf(id, r.comparison)} (measured)`,
              showlegend: false,
              x: pts.map((q) => q.x),
              y: pts.map((q) => (q.ratio > 0 ? Math.log2(q.ratio) : null)),
              marker: {
                color: pointColor(col),
                size: look.pointSize,
                opacity: look.pointOpacity,
                line: { color: p.panel, width: 1 }
              },
              hovertemplate:
                tooltip(
                  {
                    ...who,
                    conds: [
                      ['comparison', r.comparison],
                      [condLabel(axis), '%{x:.3g}']
                    ],
                    values: [['log₂ ratio', '%{y:.3f}']]
                  },
                  p.textMuted
                ) + `<extra></extra>`
            })
          // EC50 (when shown), where it falls within the tested doses — a 4PL's only (M0 has none).
          const ec50 = -c.pec50
          if (described && look.ec50Line && ec50 >= c.xMin && ec50 <= c.xMax)
            shapes.push({
              type: 'line',
              x0: xUnits(c, ec50),
              x1: xUnits(c, ec50),
              yref: 'paper',
              y0: 0,
              y1: 1,
              line: { color: col, width: 1, dash: 'dot' }
            })
        }
      } else {
        // A t-test: its fold change at each level, joined, with the fold change's SE as its error.
        for (const c of comparisons) {
          const pts = gRows
            .filter((r) => r.comparison === c && ctxNum(r, axis) != null && r.log2FC != null)
            .sort((a, b) => ctxNum(a, axis)! - ctxNum(b, axis)!)
          if (!pts.length) continue
          const col = color(id, gRows, c)
          const xs = pts.map((r) => String(ctxNum(r, axis)))
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
            name: nameOf(id, c),
            x: xs,
            y: pts.map((r) => r.log2FC),
            line: { color: col, width: look.lineWidth, dash: dash(c) },
            opacity: look.lineOpacity,
            hovertemplate:
              tooltip(
                {
                  ...who,
                  conds: [
                    ['comparison', c],
                    [condLabel(axis), '%{x}']
                  ],
                  values: [['log₂FC', '%{y:.3f}']]
                },
                p.textMuted
              ) + `<extra></extra>`
          })
          // The replicates behind each mean, on the same log₂ scale as the line.
          const rx: string[] = []
          const ry: number[] = []
          for (const r of pts)
            for (const y of replicateLog2FCs(r, geneStd)) {
              rx.push(String(ctxNum(r, axis)))
              ry.push(y)
            }
          if (look.points && rx.length)
            traces.push({
              type: 'scatter',
              mode: 'markers',
              name: `${nameOf(id, c)} (replicates)`,
              showlegend: false,
              x: rx,
              y: ry,
              marker: {
                color: pointColor(col),
                size: look.pointSize,
                opacity: look.pointOpacity,
                line: { color: p.panel, width: 1 }
              },
              hovertemplate:
                tooltip(
                  {
                    ...who,
                    conds: [
                      ['comparison', c],
                      [condLabel(axis), '%{x}']
                    ],
                    values: [['replicate log₂FC', '%{y:.3f}']]
                  },
                  p.textMuted
                ) + `<extra></extra>`
            })
        }
      }
    }
    // A t-test's levels as categories, numerically ordered across every gene drawn.
    const cats = [
      ...new Set(rows.map((r) => ctxNum(r, axis)).filter((v): v is number => v != null))
    ]
      .sort((a, b) => a - b)
      .map(String)
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: traces.filter((t) => t.showlegend !== false).length > 1,
      legend: { yanchor: 'middle', y: 0.5 },
      title: title ? { text: title, font: { size: 13 } } : undefined,
      // Log dose: one tick per decade (Plotly would otherwise label 2s and 5s in between).
      xaxis:
        curves.length || responses.length
          ? responses.some((r) => r.rs?.scale === 'linear') ||
            curves.some((r) => r.curve?.scale === 'linear')
            ? { ...axisBase(p), title: axisLabel ?? condLabel(axis) }
            : { ...axisBase(p), title: axisLabel ?? condLabel(axis), type: 'log', dtick: 1 }
          : {
              ...axisBase(p),
              title: axisLabel ?? condLabel(axis),
              type: 'category',
              categoryorder: 'array',
              categoryarray: cats
            },
      // Titled as the global view's: the fold change, naming its comparison when the rows share one.
      yaxis: {
        ...axisBase(p),
        title: comparisonOf(rows) ? `log₂FC · ${comparisonOf(rows)}` : 'log₂FC',
        zeroline: true,
        // Fixed to the Compare-wide range when one is given (see yRange); otherwise autorange.
        ...(range ? { range, autorange: false } : null)
      },
      shapes
    }
    return { data: traces, layout: lay }
  }, [
    rows,
    ids,
    rowsOf,
    stdOf,
    displayMap,
    axis,
    axisLabel,
    title,
    mode,
    look,
    yRange,
    geneRange,
    upColor,
    downColor,
    noneColor,
    model
  ])

  if (!data.length)
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted, #888)' }}>
        {ids.length > 1 ? 'No response for these genes here.' : 'No response for this gene here.'}
      </div>
    )
  return <PlotlyChart data={data} layout={layout} />
}

/** Line dashes telling comparisons apart when several genes share the colours. */
const DASHES = ['solid', 'dash', 'dot', 'dashdot', 'longdash']
