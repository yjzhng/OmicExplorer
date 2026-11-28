/**
 * Dose/time-response curves (compare), and the one-gene time-series dose-response (TDR).
 * Plain data for the renderer to turn into Plotly traces (no Plotly dependency here).
 */
import { xUnits } from '../curves/axisModel'
import { curveSampleX, logistic } from '../curves/curveFit'
import { descValue } from '../curves/splineDescribe'
import { pickTop, type TopSplitSpec } from '../stats/topPick'
import type { CompareResultRow, ConditionKey } from '../types'
import { ctxNum } from './facet'
import { comparisonOf } from './volcano'

// ── dose/time-response (compare) ─────────────────────────────────────────────────

export interface DRSeries {
  uniqID: string
  label: string
  points: { x: number; y: number }[]
}
export interface DRData {
  /** every gene, most-differential first; the view draws all as faint background
   *  lines and colors the leading `highlight` of them */
  series: DRSeries[]
  axis: ConditionKey
  /** how many leading (top differential) series to color/highlight */
  highlight: number
  /** total genes available (for a "top N of M" note) */
  total: number
  /** the rows' single comparison label ("A | B"), for the fold-change axis title */
  comparison?: string
  /** fitted curves (a Compare's curve fit): x is the dose itself, sampled finely along each curve,
   *  so the view needs a continuous log axis rather than one category per tested level */
  continuous?: boolean
  /** fitted curves on a linear axis (see axisModel.ts): the continuous axis is linear, not log */
  linear?: boolean
  /** every gene, in the base's order (drBase): the same array whichever are picked, so the view's
   *  faint background of all of them is built once per data, not again on a pin */
  all?: readonly DRSeries[]
}
export interface DROptions {
  axis: ConditionKey
  /** response surface method curves: the description 4PL ('curve', default) or the spline */
  model?: 'spline' | 'curve'
  topGenes: number
  /** how the top-N splits between up and down (see topPick; default proportional) */
  split?: TopSplitSpec
  displayMap?: Record<string, string>
  /** focus genes (uniqIDs): when non-empty, colour exactly these curves instead of top-N */
  focus?: string[]
  /** a narrower pool (uniqIDs) for the top-N: when non-empty, it's picked from these genes —
   *  significant or not, as they were chosen — instead of from every significant gene */
  within?: string[]
}

/**
 * Bubble/dumbbell put one gene per axis category, so they can't show thousands of
 * genes without Plotly choking (~2000 categories/shapes freezes the renderer). When
 * "all" is requested (topGenes ≤ 0, the Cap genes switch off) cap to a safe count; an explicit
 * topGenes overrides it. DR/TR instead show every gene as a faint background line and only
 * color the top-N (see buildDR/DRView), so they never need a cap.
 */
export const BUBBLE_DUMBBELL_CAP = 100
export const geneLimit = (topGenes: number, total: number): number =>
  topGenes > 0 ? topGenes : Math.min(total, BUBBLE_DUMBBELL_CAP)

/** |log2FC| at the TOP dose/time (the highest axis value). Points are x-sorted ascending before
 *  this is used, so the last point is the top of the axis — genes most differential there rank first. */
const topDoseMag = (pts: { y: number }[]): number =>
  pts.length ? Math.abs(pts[pts.length - 1].y) : 0

/**
 * A response surface method curve (a row's `rs`, one axis) as drawn, on the axis's own scale —
 * dose, time from t₀, or a linear axis's own units: its line — the description 4PL ('curve') where the curve was described,
 * else (or for 'spline') the spline its detection fitted — the level means it was fitted to
 * (the baseline, at 0 by definition, left out), and the 4PL's midpoint when it falls within the
 * tested levels. Null for a surface.
 */
export function responseCurve(
  r: CompareResultRow,
  model: 'spline' | 'curve'
): {
  x: number[]
  y: number[]
  points: { x: number; y: number }[]
  mid?: number
  drawn: 'spline' | 'curve'
} | null {
  const rs = r.rs
  if (!rs || rs.axis === 'surface' || !rs.x || !rs.y || rs.x.length < 2) return null
  const toAxis = (lx: number): number => xUnits(rs, lx)
  const lo = rs.x[1]
  const hi = rs.x[rs.x.length - 1]
  const points = rs.x.slice(1).map((lx, i) => ({ x: toAxis(lx), y: rs.y![i + 1] }))
  const d = rs.desc
  // The descriptor without a description (not a responder, or none could be fitted): no line — NA,
  // its level means only (the spline is the detector's, drawn under that model).
  if (model === 'curve' && !d) return { x: [], y: [], points, drawn: 'curve' }
  if (model === 'curve' && d) {
    const lx = Array.from({ length: 61 }, (_, i) => lo + ((hi - lo) * i) / 60)
    const mid = d.mid >= toAxis(lo) && d.mid <= toAxis(hi) ? d.mid : undefined
    return {
      x: lx.map(toAxis),
      y: lx.map((v) => descValue(d, v)),
      points,
      ...(mid != null ? { mid } : null),
      drawn: 'curve'
    }
  }
  const line = rs.line ?? { x: rs.x.slice(1), y: (rs.fitted ?? rs.y).slice(1) }
  return { x: line.x.map(toAxis), y: line.y, points, drawn: 'spline' }
}

/** buildDR's part that reads every row — each gene's line (a fitted curve evaluated along the
 *  axis), in |log₂FC|-at-the-top-dose order — kept apart, so a pin or a top-N change (which only
 *  picks which lines are coloured) doesn't evaluate every curve again (drPick). */
export interface DRBase {
  series: DRSeries[]
  anySig: Set<string>
  axis: ConditionKey
  comparison: string | undefined
  continuous: boolean
  linear: boolean
}

export function drBase(
  rows: CompareResultRow[],
  opts: Pick<DROptions, 'axis' | 'model' | 'displayMap'>
): DRBase {
  const byGene = new Map<string, { x: number; y: number }[]>()
  // Genes significant at one level or more: the only ones the top-N colours (as in the bubble).
  const anySig = new Set<string>()
  let continuous = false
  let linear = false
  for (const r of rows) {
    // A curve fit's row is one whole curve: draw the fitted ratio to the control (log₂) across the
    // tested doses rather than one point per level.
    if (r.curve) {
      if (r.curve.axis !== opts.axis) continue
      continuous = true
      if (r.curve.scale === 'linear') linear = true
      if (r.signf) anySig.add(r.uniqID)
      const { xMin, xMax } = r.curve
      // Evenly spaced, plus extra points only where the curve turns (curveSampleX).
      const pts = curveSampleX({ ...r.curve, xMin, xMax }, CURVE_SAMPLES).map((lx) => ({
        x: xUnits(r.curve!, lx),
        y: Math.log2(logistic(lx, r.curve!))
      }))
      byGene.set(r.uniqID, pts)
      continue
    }
    // A response surface method curve: its description 4PL or its spline (responseCurve).
    if (r.rs) {
      if (r.rs.axis !== opts.axis) continue
      const c = responseCurve(r, opts.model ?? 'curve')
      if (!c) continue
      continuous = true
      if (r.signf) anySig.add(r.uniqID)
      // (a log axis draws nothing at or below 0; a linear one has no such limit)
      const lin = r.rs.scale === 'linear'
      if (lin) linear = true
      byGene.set(
        r.uniqID,
        c.x.map((x, i) => ({ x, y: c.y[i] })).filter((pt) => lin || pt.x > 0)
      )
      continue
    }
    const x = ctxNum(r, opts.axis)
    if (x == null || r.log2FC == null || !Number.isFinite(r.log2FC)) continue
    if (r.signf) anySig.add(r.uniqID)
    let arr = byGene.get(r.uniqID)
    if (!arr) {
      arr = []
      byGene.set(r.uniqID, arr)
    }
    arr.push({ x, y: r.log2FC })
  }
  const series: DRSeries[] = []
  for (const [uniqID, pts] of byGene) {
    if (new Set(pts.map((p) => p.x)).size < 2) continue // needs ≥2 axis points to be a curve
    pts.sort((a, b) => a.x - b.x)
    series.push({ uniqID, label: opts.displayMap?.[uniqID] ?? uniqID, points: pts })
  }
  series.sort((a, b) => topDoseMag(b.points) - topDoseMag(a.points))
  return {
    series,
    anySig,
    axis: opts.axis,
    comparison: comparisonOf(rows),
    continuous,
    linear
  }
}

/** A response-curve plot from its base: which lines are coloured, and in front. */
export function drPick(
  b: DRBase,
  opts: Pick<DROptions, 'topGenes' | 'split' | 'focus' | 'within'>
): DRData {
  const { series, anySig, continuous, linear } = b
  // Focus genes (when set) override top-N: pull them to the front (in focus order) and
  // colour exactly them; the rest stay as faint background lines.
  const focus = opts.focus ?? []
  if (focus.length > 0) {
    const order = new Map(focus.map((id, i) => [id, i]))
    const inFocus = series.filter((s) => order.has(s.uniqID))
    inFocus.sort((a, b) => (order.get(a.uniqID) ?? 0) - (order.get(b.uniqID) ?? 0))
    const rest = series.filter((s) => !order.has(s.uniqID))
    return {
      series: [...inFocus, ...rest],
      axis: b.axis,
      highlight: inFocus.length,
      total: series.length,
      comparison: b.comparison,
      continuous,
      ...(linear ? { linear } : null),
      all: series
    }
  }
  // Show every gene (as faint background lines); the coloured top-N on top is drawn from the
  // significant genes, split between up and down as set (pickTop), and moved to the
  // front. topGenes ≤ 0 (Cap genes off) colours every significant gene — DRView safety-caps the
  // coloured foreground. All genes stay in one merged view trace.
  const pool = opts.within?.length ? new Set(opts.within) : null
  const sigSeries = series
    .filter((sr) => (pool ? pool.has(sr.uniqID) : anySig.has(sr.uniqID)))
    .map((sr) => ({ id: sr.uniqID, signed: sr.points[sr.points.length - 1].y }))
  const chosen =
    opts.topGenes > 0
      ? pickTop(sigSeries, opts.topGenes, opts.split)
      : pickTop(sigSeries, sigSeries.length)
  const rank = new Map(chosen.map((id, i) => [id, i]))
  const front = series
    .filter((sr) => rank.has(sr.uniqID))
    .sort((a, b) => (rank.get(a.uniqID) ?? 0) - (rank.get(b.uniqID) ?? 0))
  const back = series.filter((sr) => !rank.has(sr.uniqID))
  return {
    series: [...front, ...back],
    axis: b.axis,
    highlight: front.length,
    total: series.length,
    comparison: b.comparison,
    continuous,
    ...(linear ? { linear } : null),
    all: series
  }
}

/** Response curves: log2FC vs dose (or time), one line per gene, top-N by |log2FC| at the top dose. */
export function buildDR(rows: CompareResultRow[], opts: DROptions): DRData {
  return drPick(drBase(rows, opts), opts)
}

/** Evenly spaced points along each fitted curve in the DR view (more are added at its turns). */
const CURVE_SAMPLES = 25

// ── TDR: time-series dose-response for one gene (compare) ────────────────────────

export interface TdrSeries {
  /** time value as a label (one line per time level) */
  time: string
  points: { x: number; y: number }[]
}
export interface TdrData {
  gene: string
  uniqID: string
  /** one line per time level, x = dose, y = log2FC */
  series: TdrSeries[]
  /** the rows' single comparison label ("A | B"), for the fold-change axis title */
  comparison?: string
}

/** One gene's dose×time response: x = dose, a line per time level, y = log2FC. */
export function buildTdr(
  rows: CompareResultRow[],
  uniqID: string,
  displayMap?: Record<string, string>
): TdrData {
  const byTime = new Map<number, { x: number; y: number }[]>()
  for (const r of rows) {
    if (r.uniqID !== uniqID) continue
    if (r.dose == null || r.time == null || r.log2FC == null || !Number.isFinite(r.log2FC)) continue
    let arr = byTime.get(r.time)
    if (!arr) {
      arr = []
      byTime.set(r.time, arr)
    }
    arr.push({ x: r.dose, y: r.log2FC })
  }
  const series: TdrSeries[] = [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, pts]) => ({ time: String(t), points: pts.sort((a, b) => a.x - b.x) }))
  return { gene: displayMap?.[uniqID] ?? uniqID, uniqID, series, comparison: comparisonOf(rows) }
}
