/**
 * Description (Layer 5) of the spline detector's calls (see splineFit.ts): the monotonic shape
 * model fitted to detected curves and surfaces. Description never affects calls or q.
 */
import { type AxisMap, type AxisShape, driftsByDefault, fromX, toX } from './axisModel'
import {
  fitLogistic,
  interpolatedPoints,
  interpolationGrid,
  logistic,
  type LogisticParams,
  Y_LIMITS_LOG2
} from './curveFit'
import { fitJointSurface, type JointFit, type JointParams, type JointSpec } from './surfaceJoint'
import { type SplineCurve, type SurfaceDescribe, surfaceMaps } from './splineCurve'
import { mean, type SplineRun } from './splineFit'
import type { SurfacePins } from './splineSurface'

// ── description (Layer 5): the monotonic shape model on detected curves ──────────────────────

export interface CurveDescription extends LogisticParams {
  /** the 4PL's midpoint — half the effect on log₂ — in axis units (dose: the data's dose unit);
   *  front / back are the plateaus as log₂ ratios to the baseline (0 = no change). A line has
   *  none (NaN). */
  mid: number
  /** 'linear': a straight line from the baseline (x0, 0) — `slope` per x, `back` its value at the
   *  last level, no midpoint (pec50, mid NaN); absent: the 4PL. Read through descValue. */
  model?: 'linear'
  x0?: number
  /** R² of the 4PL and of the spline over the same level means (log₂ scale, around their mean) */
  r2: number
  r2Spline: number
  /** r2 / r2Spline: how much of what the spline follows the monotonic shape explains */
  shapeRatio: number
  /** shapeRatio below the cut-off: responds, but not this shape */
  lowShape: boolean
}

/**
 * Describe one fitted one-axis curve by the 4-parameter log-logistic (CurveCurator's OLS fit) on
 * the log₂ ratios to the baseline — the spline's scale, so the two are compared on the residuals
 * each minimises (on ratios, large rises misfit near the baseline and were flagged wrongly; the
 * midpoint is half the effect on log₂, the same for rises and falls). Against one reference
 * (dose): the baseline is the control at −∞, as in CurveCurator. Against a matched control (time):
 * the level 0 (t₀) is a real point on the axis, so the 4PL runs from it: it starts at the baseline
 * (front fixed at 0) and its midpoint may not lie before it (a response already full at the first
 * time point puts it between t₀ and that time). Fitted to the level means — the same points the spline detector
 * sees — and judged against it: a curve the 4PL explains much less of than the spline does is
 * flagged (`lowShape`). Description never affects calls or q. Null for surfaces (no scale) and for
 * curves with too few levels for 4 parameters.
 */
export function describeCurve(
  c: SplineCurve,
  minShapeRatio = 0.8,
  interpolation = false,
  model: AxisShape | 'none' = '4pl'
): CurveDescription | null {
  const sc = c.scale
  if (model === 'none' || model === 'spline' || model === 'constant') return null
  if (!sc || c.x.length < (model === 'linear' ? 3 : 5)) return null
  // a baseline among the levels (dose 100 picked): its 0 a point like the rest, the 4PL free
  const among = c.x.slice(1).some((v) => v < c.x[0])
  const { p, pred, mid } =
    model === 'linear'
      ? fitLine(c.x, c.y)
      : among
        ? fit4plFree(c.x, c.y, sc, interpolation)
        : fit4pl(c.x, c.y, sc, interpolation)
  const ym = mean(c.y)
  const sst = c.y.reduce((s, v) => s + (v - ym) ** 2, 0)
  const rss = pred.reduce((s, f, i) => s + (c.y[i] - f) ** 2, 0)
  return { ...p, mid, ...shape(rss, c.rss, sst, minShapeRatio) }
}

/** The description's 4PL on one curve's log₂ level means (baseline first, value 0), with its
 *  predictions at every level and its midpoint in axis units. Against one reference (dose): the
 *  baseline is the control at −∞. Against a matched control (time): nothing responds before the
 *  level 0 — the curve starts at the baseline (front fixed at 0, else it invents a plateau before
 *  t₀ to fit an early jump) and its midpoint stays at or after it. */
function fit4pl(
  x: number[],
  y: number[],
  sc: AxisMap,
  interpolation = false
): { p: LogisticParams; pred: number[]; mid: number } {
  const time = sc.baseline === 'matched'
  const xs = time ? x : [-Infinity, ...x.slice(1)]
  // a matched curve's midpoint never before its baseline level (t₀, the lowest temperature)
  const f0 = fromX(sc, x[0])
  const floor = Math.abs(f0) < 1e-9 ? 0 : f0
  // CurveCurator's interpolation: grid points between the treated levels, in the fit only
  const extra = interpolation
    ? interpolatedPoints(x.slice(1), y.slice(1), interpolationGrid(x.slice(1)))
    : { x: [], y: [] }
  const p = fitLogistic([...xs, ...extra.x], [...y, ...extra.y], x.slice(1), {
    yLimits: Y_LIMITS_LOG2,
    pec50Max: time ? -x[0] : undefined,
    // (its start: the baseline's 0 — or a slice's own first cell, against one position)
    front: time ? y[0] : undefined
  })
  const x50 = -p.pec50
  return {
    p,
    pred: xs.map((v) => logistic(v, p)),
    mid: time ? Math.max(floor, fromX(sc, x50)) : fromX(sc, x50)
  }
}

/** The description's 4PL through points with no baseline below them to start from — the
 *  reference among the levels (dose 100 pinned: its 0 a point like any other), or none on the
 *  curve (an axis the baseline leaves free): fitted free over them all. */
function fit4plFree(
  x: number[],
  y: number[],
  sc: AxisMap,
  interpolation = false
): { p: LogisticParams; pred: number[]; mid: number } {
  const order = x.map((_, i) => i).sort((i, j) => x[i] - x[j])
  const xs = order.map((i) => x[i])
  const ys = order.map((i) => y[i])
  const extra = interpolation ? interpolatedPoints(xs, ys, interpolationGrid(xs)) : { x: [], y: [] }
  const p = fitLogistic([...xs, ...extra.x], [...ys, ...extra.y], xs, { yLimits: Y_LIMITS_LOG2 })
  return { p, pred: x.map((v) => logistic(v, p)), mid: fromX(sc, -p.pec50) }
}

/** A stored surface's baseline pins (surfaceFrame) — on a result fitted before they were kept:
 *  one position at its axes' bases, else the first axis's base at each level of the second. */
export function pinsOf(s: NonNullable<SplineCurve['surface']>): SurfacePins {
  if (s.pins) return s.pins
  const a = s.axes?.[0].base ?? 0
  return s.position ? { a, b: s.axes?.[1].base ?? 0 } : { a, b: null }
}

/** The description's line on one curve's log₂ level means (baseline first, value 0): straight from
 *  the baseline, its slope by least squares through (x₀, 0), with its predictions at every level. */
function fitLine(
  x: number[],
  y: number[]
): { p: LogisticParams & { model: 'linear'; x0: number }; pred: number[]; mid: number } {
  // through its start (x₀, y₀): the baseline (0) — or, a surface's slice against one position, its
  // own first cell's value
  const x0 = x[0]
  const y0 = y[0]
  let sxy = 0
  let sxx = 0
  for (let i = 1; i < x.length; i++) {
    sxy += (x[i] - x0) * (y[i] - y0)
    sxx += (x[i] - x0) ** 2
  }
  const slope = sxx > 0 ? sxy / sxx : 0
  const xmax = Math.max(...x.slice(1))
  return {
    p: { model: 'linear', x0, slope, front: y0, back: y0 + slope * (xmax - x0), pec50: NaN },
    pred: x.map((v) => y0 + slope * (v - x0)),
    mid: NaN
  }
}

/** A description's value at x: its 4PL, or its line (CurveDescription.model). */
export const descValue = (
  d: LogisticParams & { model?: 'linear'; x0?: number },
  x: number
): number => (d.model === 'linear' ? d.front + d.slope * (x - (d.x0 ?? 0)) : logistic(x, d))

/** R² of the 4PL and of the spline from their residual sums of squares, and the low-shape flag. */
function shape(
  rss: number,
  rssSpline: number,
  sst: number,
  minShapeRatio: number
): Pick<CurveDescription, 'r2' | 'r2Spline' | 'shapeRatio' | 'lowShape'> {
  const r2 = sst > 0 ? Math.max(0, 1 - rss / sst) : 0
  const r2Spline = sst > 0 ? Math.max(0, 1 - rssSpline / sst) : 0
  const shapeRatio = r2Spline > 0 ? r2 / r2Spline : 0
  return { r2, r2Spline, shapeRatio, lowShape: shapeRatio < minShapeRatio }
}

/** One slice of a surface described by the 4PL: a dose curve at one time (`at` = the time) or a
 *  time curve at one dose (`at` = the dose). Plateaus and midpoint as in CurveDescription. */
export interface SliceDescription extends LogisticParams {
  at: number
  mid: number
  /** a line (see CurveDescription.model) — read through descValue */
  model?: 'linear'
  x0?: number
}

/** How a surface is described: slice by slice (each time's dose curve and each dose's time curve
 *  fitted on its own — 'slices' drawn by time, 'doseSlices' by dose; the fits are the same), or
 *  one joint model over every cell (surfaceJoint.ts). */
export type SurfaceMethod = 'slices' | 'doseSlices' | 'joint'

export interface SurfaceDescription {
  method: SurfaceMethod
  /** the dose curve at each time: pEC50, slope and top as they change with time (slices: times
   *  with 4+ doses; joint: every time, read off the joint model) */
  byTime: SliceDescription[]
  /** the time curve at each dose (4+ times): when the response arrives, dose by dose — slices
   *  only (the joint model's time course is `joint.tau` / `joint.k`, shared by every dose) */
  byDose: SliceDescription[]
  /** the joint model's parameters, and the ū its midpoint is centred on (joint only) — together,
   *  jointPredict draws the model at any dose and time */
  joint?: JointParams
  jointUbar?: number
  /** R² of the description (slices: the worse direction) and of the spline surface, over the
   *  treated cells' effects; shapeRatio and lowShape as for one curve. The three shape fields are
   *  absent on a 4PL-detected surface: its fit is the 4PL, so there is no shape-free fit to check
   *  the description against. */
  r2: number
  r2Spline?: number
  shapeRatio?: number
  lowShape?: boolean
}

/**
 * Describe a fitted dose × time surface by the 4PL, slice by slice: the dose curve at each time
 * (relative to that time's vehicle) and the time curve at each dose (from t₀, no response before
 * it), each fitted to the data as describeCurve fits one curve. pEC50 and top at each time come
 * straight from the data, with no assumed law for how they change. The flag compares each
 * direction's 4PLs with the spline surface on the treated cells and takes the worse, so a surface
 * that is not monotonic in dose or in time is flagged. A direction whose slices have fewer than 4
 * levels is not described; null when neither direction is. `method: 'joint'` fits one model over
 * every cell instead (surfaceJoint.ts): steadier pEC50 on dense grids, at an assumed smooth change
 * with time and ~10× the compute.
 *
 * `detected` is the 4PL surface detector's joint fit of this surface: then `c.fitted` is that 4PL
 * (not a spline), so no shape check is made (only R²), and 'joint' takes the fit as it is.
 */
export function describeSurface(
  c: SplineCurve,
  minShapeRatio = 0.8,
  method: SurfaceMethod = 'slices',
  interpolation = false,
  detected?: JointFit,
  how?: SurfaceDescribe
): SurfaceDescription | null {
  const s = c.surface
  if (!s) return null
  const nG = s.vehicle.length
  const [mapA, mapB] = surfaceMaps(s)
  const shapes = how?.shapes ?? ['4pl', '4pl']
  const eff = s.treated.map((r, i) => c.y[nG + i] - s.vehicle[r.group].mean)
  const rssSpline = s.treated.reduce((a, _, i) => a + (c.y[nG + i] - c.fitted[nG + i]) ** 2, 0)
  const em = mean(eff)
  const sst = eff.reduce((a, v) => a + (v - em) ** 2, 0)
  // the description's fit, and against a spline its shape check
  const fitOf = (
    rss: number
  ): Pick<SurfaceDescription, 'r2' | 'r2Spline' | 'shapeRatio' | 'lowShape'> =>
    detected
      ? { r2: shape(rss, rssSpline, sst, minShapeRatio).r2 }
      : shape(rss, rssSpline, sst, minShapeRatio)
  if (method === 'joint') {
    const spec = jointSpecOf(s, how)
    if (!spec) return null
    const j = fitJointSurface(c, interpolation, detected, spec)
    if (!j) return null
    return {
      method,
      byTime: j.byTime.map((t) => ({
        at: t.time,
        pec50: -t.x50,
        slope: j.params.h,
        front: 0,
        back: t.top,
        mid: fromX(mapA, t.x50)
      })),
      byDose: [],
      joint: j.params,
      jointUbar: j.ubar,
      ...fitOf(j.rss)
    }
  }
  // the curves along one axis, at each level of the other: `key` names the slot they're taken at
  // ('time': along the first axis at each level of the second)
  const direction = (
    key: 'time' | 'dose',
    sc: AxisMap
  ): { slices: SliceDescription[]; rss: number } | null => {
    const along = key === 'time' ? 0 : 1
    const shape = shapes[along]
    if (shape !== '4pl' && shape !== 'linear') return null
    const base = s.axes?.[along].base ?? 0
    // the baseline along this axis (pinsOf): its pin, and the other axis's
    const pins = pinsOf(s)
    const pinX = along === 0 ? pins.a : pins.b
    const pinO = along === 0 ? pins.b : pins.a
    const by = new Map<number, number[]>()
    s.treated.forEach((r, i) => {
      const a = by.get(r[key])
      if (a) a.push(i)
      else by.set(r[key], [i])
    })
    const slices: SliceDescription[] = []
    let rss = 0
    const levelOf = (i: number): number => (key === 'time' ? s.treated[i].dose : s.treated[i].time)
    const lv = (i: number): number => toX(sc, levelOf(i))
    for (const at of [...by.keys()].sort((a, b) => a - b)) {
      const idx = [...by.get(at)!].sort((a, b) => lv(a) - lv(b))
      if (idx.length < 4) return null
      const lowest = levelOf(idx[0])
      // Where the slice starts, as the baseline says (the 4PL then runs on from there):
      //  - the reference on this slice below its cells: dose 0, the control at −∞ (CurveCurator);
      //    a first point (t₀), the curve from its 0 there
      //  - one position's own cell on a slice off it (dose 0 at a higher temperature: the
      //    vehicle's melt), lowest: from its value
      //  - the reference on this slice among its cells (dose 100 pinned): a point at 0 like any
      //    other — the 4PL free through it
      //  - no reference on the slice (an axis left free): from the first point under a matched
      //    model (nothing responds before t₀), else free over the cells
      const onSlice = pinX != null && (pinO == null || at === pinO)
      const baseCell =
        pinX != null && !onSlice && levelOf(idx[0]) === pinX && idx.length > 4 ? idx[0] : null
      let xs: number[]
      let ys: number[]
      let lead: boolean
      let free = false
      if (baseCell != null) {
        xs = idx.map(lv)
        ys = idx.map((i) => eff[i])
        lead = true
      } else if (onSlice && pinX! < lowest) {
        xs = [sc.baseline === 'matched' ? toX(sc, pinX!) : lv(idx[0]) - 1, ...idx.map(lv)]
        ys = [0, ...idx.map((i) => eff[i])]
        lead = true
      } else if (onSlice) {
        xs = [toX(sc, pinX!), ...idx.map(lv)]
        ys = [0, ...idx.map((i) => eff[i])]
        lead = true
        free = true
      } else if (pinX == null && sc.baseline === 'matched' && base < lowest) {
        xs = [toX(sc, base), ...idx.map(lv)]
        ys = [0, ...idx.map((i) => eff[i])]
        lead = true
      } else {
        xs = idx.map(lv)
        ys = idx.map((i) => eff[i])
        lead = false
        free = true
      }
      const { p, pred, mid } =
        shape === 'linear'
          ? fitLine(xs, ys)
          : free
            ? fit4plFree(xs, ys, sc, interpolation)
            : fit4pl(xs, ys, sc, interpolation)
      const off = lead && baseCell == null ? 1 : 0
      idx.forEach((i, k) => {
        if (i !== baseCell) rss += (eff[i] - pred[k + off]) ** 2
      })
      slices.push({ ...p, at, mid })
    }
    return { slices, rss }
  }
  const byTime = direction('time', mapA)
  const byDose = direction('dose', mapB)
  if (!byTime && !byDose) return null
  // the worse direction: the lower shape ratio against a spline, else the lower R²
  const worst = [byTime, byDose]
    .filter((d): d is NonNullable<typeof d> => d != null)
    .map((d) => fitOf(d.rss))
    .reduce((a, b) => ((b.shapeRatio ?? b.r2) < (a.shapeRatio ?? a.r2) ? b : a))
  return { method, byTime: byTime?.slices ?? [], byDose: byDose?.slices ?? [], ...worst }
}

/** The joint model's shapes for a surface described as `how` says (absent: the preset), on its own
 *  axes — null when an axis has no parametric descriptor (spline / none) to build it from. */
export function jointSpecOf(
  s: NonNullable<SplineCurve['surface']>,
  how?: SurfaceDescribe
): JointSpec | null {
  const maps = surfaceMaps(s)
  const shapes = how?.shapes ?? ['4pl', '4pl']
  const coupled = how?.coupled ?? [
    driftsByDefault(maps[0].baseline, maps[1].baseline),
    driftsByDefault(maps[1].baseline, maps[0].baseline)
  ]
  const pins = pinsOf(s)
  const axis = (k: 0 | 1): JointSpec['a'] | null => {
    const sh = shapes[k]
    if (sh !== '4pl' && sh !== 'linear' && sh !== 'constant') return null
    const m = maps[k]
    const levels = s.treated.map((t) => (k === 0 ? t.dose : t.time))
    // The joint model's response is 0 at its baseline along each axis — a control off it or its
    // first point: a baseline pinned among the levels (dose 100), or an axis the pin leaves free
    // with no first point to start from, it can't model (the slices describe it instead).
    const pin = k === 0 ? pins.a : pins.b
    if (pin != null && pin > Math.min(...levels)) return null
    if (pin == null && m.baseline !== 'matched') return null
    const lv = [...new Set(levels.map((v) => toX(m, v)))].sort((x, y) => x - y)
    const steps = lv
      .slice(1)
      .map((v, i) => v - lv[i])
      .sort((x, y) => x - y)
    // where its baseline sits: its own first point, else (a control off it) at −∞ for a 4PL and a
    // median step below the lowest level for a line
    const baseX =
      m.baseline === 'matched'
        ? toX(m, s.axes?.[k].base ?? 0)
        : sh === '4pl'
          ? -Infinity
          : lv[0] - (steps.length ? steps[steps.length >> 1] : 1)
    return {
      shape: sh,
      baseline: m.baseline,
      baseX,
      ...(sh === '4pl' && coupled[k] ? { coupled: true } : null)
    }
  }
  const a = axis(0)
  const b = axis(1)
  // against one position, the vehicle's own response along the second axis (its melt) — a term
  // of its own, the product being 0 at the first axis's base
  return a && b ? { a, b, ...(s.position ? { vehicle: true } : null) } : null
}

/** Describe the curves of a run called at q ≤ `qMax` (keyed by row index); the rest stay
 *  undescribed — description is for responders only. */
export function describeRun(
  run: SplineRun,
  qMax = 0.05,
  minShapeRatio = 0.8
): Map<number, CurveDescription> {
  const out = new Map<number, CurveDescription>()
  run.rows.forEach((r, i) => {
    if (!(r.q <= qMax)) return
    const d = describeCurve(r.curve, minShapeRatio)
    if (d) out.set(i, d)
  })
  return out
}

/** describeRun for a dose × time run (runSurfaceFit): the surfaces called at q ≤ `qMax`. */
export function describeSurfaceRun(
  run: SplineRun,
  qMax = 0.05,
  minShapeRatio = 0.8,
  method: SurfaceMethod = 'slices'
): Map<number, SurfaceDescription> {
  const out = new Map<number, SurfaceDescription>()
  run.rows.forEach((r, i) => {
    if (!(r.q <= qMax)) return
    const d = describeSurface(r.curve, minShapeRatio, method)
    if (d) out.set(i, d)
  })
  return out
}
