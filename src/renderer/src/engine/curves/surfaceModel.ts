/**
 * A two-axis response's value at any dose × time — the one reading every view and statistic takes
 * of a surface (the Response plot's lines, surface and heatmap; the descriptor's fold change), so
 * none of them decides on its own what the model is, where the baseline sits or what it reads
 * there.
 *
 * Values are against the baseline the fit was laid out on (runSurfaceFit / runSliceShift — one
 * position, or the control at each level of the second axis): a cell's value is the model's there;
 * a control's (rs.controls: the vehicle, a baseline level's samples) is 0, the baseline itself.
 * Between the lowest measured level and a control below it (dose 0 on a log axis, placed a step
 * below the lowest dose) the value runs straight to that 0 — what a 4PL's front plateau, heading
 * on below the lowest level, isn't.
 *
 * The model, by the Curve fit's model view (modelView.ts):
 *  - descriptor: the joint model (everywhere), else the slices' 4PLs — each time's dose curve
 *    (`byTime`) or each dose's time curve (`byDose`), joined across the other axis by the monotone
 *    cubic; none: NA.
 *  - detector (and measured values): the cells' fitted values, joined through the controls' 0 — by
 *    the monotone cubic, or straight for measured values (no model between them).
 */
import { descValue, type SurfaceDescription } from './splineDescribe'
import { jointAt } from './surfaceJoint'
import type { ResponseFit } from '../types'

export interface SurfacePoint {
  dose: number
  time: number
}

/** Straight lines through the finite (x, y) pairs — xs ascending — evaluated at `qs`; null outside
 *  their span. */
export function linearJoin(
  xs: readonly number[],
  ys: ReadonlyArray<number | null>,
  qs: readonly number[]
): Array<number | null> {
  const { x, y } = finitePairs(xs, ys)
  const n = x.length
  if (n === 0) return qs.map(() => null)
  if (n === 1) return qs.map((q) => (Math.abs(q - x[0]) < 1e-9 ? y[0] : null))
  return qs.map((q) => {
    if (q < x[0] - 1e-9 || q > x[n - 1] + 1e-9) return null
    let k = 0
    while (k < n - 2 && q > x[k + 1]) k++
    const t = Math.min(1, Math.max(0, (q - x[k]) / (x[k + 1] - x[k])))
    return y[k] + (y[k + 1] - y[k]) * t
  })
}

/** Monotone cubic (PCHIP, Fritsch–Butland) through the finite (x, y) pairs — xs ascending —
 *  evaluated at `qs`; null outside their span. It passes through every point and never overshoots
 *  them, so a drawing smoothed with it shows no bump the values don't have. */
export function pchipJoin(
  xs: readonly number[],
  ys: ReadonlyArray<number | null>,
  qs: readonly number[]
): Array<number | null> {
  const { x, y } = finitePairs(xs, ys)
  const n = x.length
  if (n === 0) return qs.map(() => null)
  if (n === 1) return qs.map((q) => (Math.abs(q - x[0]) < 1e-9 ? y[0] : null))
  const h = x.slice(1).map((v, k) => v - x[k])
  const d = h.map((hk, k) => (y[k + 1] - y[k]) / hk)
  const m = x.map((_, k) => {
    if (k === 0) return d[0]
    if (k === n - 1) return d[n - 2]
    const [a, b] = [d[k - 1], d[k]]
    if (a * b <= 0) return 0
    const [h0, h1] = [h[k - 1], h[k]]
    return (3 * (h0 + h1)) / ((2 * h1 + h0) / a + (h1 + 2 * h0) / b)
  })
  return qs.map((q) => {
    if (q < x[0] - 1e-9 || q > x[n - 1] + 1e-9) return null
    let k = 0
    while (k < n - 2 && q > x[k + 1]) k++
    const t = Math.min(1, Math.max(0, (q - x[k]) / h[k]))
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * y[k] +
      (t3 - 2 * t2 + t) * h[k] * m[k] +
      (-2 * t3 + 3 * t2) * y[k + 1] +
      (t3 - t2) * h[k] * m[k + 1]
    )
  })
}

function finitePairs(
  xs: readonly number[],
  ys: ReadonlyArray<number | null>
): { x: number[]; y: number[] } {
  const order = xs.map((_, i) => i).sort((i, j) => xs[i] - xs[j])
  const x: number[] = []
  const y: number[] = []
  for (const i of order) {
    const w = ys[i]
    if (w == null || !Number.isFinite(w) || !Number.isFinite(xs[i])) continue
    // one value per place (a control and a cell can't share one; the first kept)
    if (x.length && Math.abs(xs[i] - x[x.length - 1]) < 1e-12) continue
    x.push(xs[i])
    y.push(w)
  }
  return { x, y }
}

/** A surface's two axes as drawn and fitted: each log or linear, where a log one places a level it
 *  can't hold (0), and each one's own coordinate (log₁₀(v + offset), or steps of a linear one's
 *  spacing — the fit's x) and back. */
export interface SurfaceAxes {
  xLog: boolean
  yLog: boolean
  /** where a log axis draws 0: the fit's own place for it (SurfaceAxisMap.zeroX), else a median
   *  step below its lowest level */
  xZero: number
  yZero: number
  placeX: (d: number) => number
  placeY: (t: number) => number
  tx: (d: number) => number
  itx: (v: number) => number
  uOf: (t: number) => number
  iu: (u: number) => number
}

/** A median step below the lowest positive level, on log₁₀. */
function stepBelow(levels: readonly number[]): number {
  const L = [...new Set(levels.filter((v) => v > 0))].sort((a, b) => a - b).map(Math.log10)
  const st = L.slice(1)
    .map((v, i) => v - L[i])
    .sort((a, b) => a - b)
  return 10 ** ((L[0] ?? 0) - (st.length ? st[st.length >> 1] : 1))
}

export function surfaceAxes(opts: {
  xLog: boolean
  yLog: boolean
  /** the levels each axis holds (any order; 0 allowed) */
  doses: readonly number[]
  times: readonly number[]
  maps?: ResponseFit['maps']
  /** the second axis's log offset where there are no maps (dose × time fits) */
  timeOffset?: number
}): SurfaceAxes {
  const { xLog, yLog, maps } = opts
  const offA = maps?.[0].timeOffset ?? 0
  const offB = (maps ? maps[1].timeOffset : opts.timeOffset) ?? 0
  const stepA = maps?.[0].step ?? 1
  const stepB = maps?.[1].step ?? 1
  const zx = xLog ? maps?.[0].zeroX : undefined
  const zy = yLog && maps?.[1].zeroX != null ? 10 ** maps[1].zeroX - offB : undefined
  const xZero = zx != null ? 10 ** zx : stepBelow(opts.doses)
  const yZero = zy != null && zy > 0 ? zy : stepBelow(opts.times)
  return {
    xLog,
    yLog,
    xZero,
    yZero,
    // (a log axis draws no 0 — even one whose coordinate has an offset: a level there is a
    // control's or a baseline level's, 0 by definition, wherever it's drawn)
    placeX: (d) => (xLog && !(d > 0) ? xZero : d),
    placeY: (t) => (yLog && !(t > 0) ? yZero : t),
    tx: (d) => (xLog ? Math.log10(d + offA) : d / stepA),
    itx: (v) => (xLog ? 10 ** v - offA : v * stepA),
    uOf: (t) => (yLog ? Math.log10(t + offB) : t / stepB),
    iu: (u) => (yLog ? 10 ** u - offB : u * stepB)
  }
}

/** What draws a surface (see the file comment). */
export type SurfaceKind = 'joint' | 'byTime' | 'byDose' | 'cells' | 'none'

export interface SurfaceModel {
  kind: SurfaceKind
  axes: SurfaceAxes
  /** the cells' levels, placed (a log axis's 0 at its place), ascending */
  doses: number[]
  times: number[]
  /** …with the controls' levels: what the views span */
  gridDoses: number[]
  gridTimes: number[]
  /** the value at a placed level pair: a control's 0, else the model's (null: none) */
  at: (d: number, t: number) => number | null
  /** along the first axis at a placed level `t` of the second, at its coordinates `lxs` (tx) */
  doseCurve: (t: number, lxs: readonly number[]) => Array<number | null>
  /** along the second axis at a placed level `d` of the first, at its coordinates `us` (uOf) */
  timeCurve: (d: number, us: readonly number[]) => Array<number | null>
  /** over a grid of placed levels — a row per time */
  grid: (doses: readonly number[], times: readonly number[]) => Array<Array<number | null>>
}

const key = (d: number, t: number): string => `${d}|${t}`
const sorted = (vs: Iterable<number>): number[] => [...new Set(vs)].sort((a, b) => a - b)

/**
 * A surface's model over placed levels (see the file comment). `desc` is the description to draw
 * (undefined: the cells' fitted values — the detector, or measured values); `slice` which slices a
 * slices description is read by when it has both (and the joins across them).
 */
export function surfaceModel(input: {
  cells: ReadonlyArray<SurfacePoint & { fitted: number }>
  controls: readonly SurfacePoint[]
  axes: SurfaceAxes
  desc?: SurfaceDescription
  /** draw the cells' fitted values (the detector, measured values) — else the description */
  fromCells: boolean
  join: 'pchip' | 'linear'
  slice?: 'time' | 'dose'
  /** the joint model's ū for results stored before it was kept */
  ubar?: number
}): SurfaceModel {
  const { axes, desc } = input
  const { tx, uOf } = axes
  const join = input.join === 'linear' ? linearJoin : pchipJoin
  const cells = input.cells
  const doses = sorted(cells.map((c) => c.dose))
  const times = sorted(cells.map((c) => c.time))
  const zeros = new Set(input.controls.map((c) => key(c.dose, c.time)))
  const gridDoses = sorted([...doses, ...input.controls.map((c) => c.dose)])
  const gridTimes = sorted([...times, ...input.controls.map((c) => c.time)])
  const fitted = new Map(cells.map((c) => [key(c.dose, c.time), c.fitted]))

  const jp = !input.fromCells && desc?.method === 'joint' ? desc.joint : undefined
  const byTime = new Map(
    (input.fromCells || jp ? [] : (desc?.byTime ?? [])).map((s) => [axes.placeY(s.at), s])
  )
  const byDose = new Map(
    (input.fromCells || jp ? [] : (desc?.byDose ?? [])).map((s) => [axes.placeX(s.at), s])
  )
  const kind: SurfaceKind = input.fromCells
    ? 'cells'
    : jp
      ? 'joint'
      : byDose.size && (input.slice === 'dose' || !byTime.size)
        ? 'byDose'
        : byTime.size
          ? 'byTime'
          : 'none'

  // ── lines: along each axis, at a level of the other ──
  // A line's cells start at its first measured level; a control on it below that (dose 0 placed
  // below the lowest dose, or one position's own cell) is where the line runs straight down to 0;
  // one among its cells (dose 100 pinned) is where the model is read from — its value less the
  // model's there, so the line passes through the control's 0.
  const lineOf = (
    along: 'dose' | 'time',
    level: number
  ): { first: number | null; ctl: number | null; mid: number | null } => {
    let first: number | null = null
    for (const c of cells) {
      if ((along === 'dose' ? c.time : c.dose) !== level) continue
      const v = along === 'dose' ? c.dose : c.time
      if (first == null || v < first) first = v
    }
    let ctl: number | null = null
    let mid: number | null = null
    for (const c of input.controls) {
      if ((along === 'dose' ? c.time : c.dose) !== level) continue
      const v = along === 'dose' ? c.dose : c.time
      if (first == null) continue
      if (v < first) {
        if (ctl == null || v > ctl) ctl = v
      } else mid = v
    }
    return { first, ctl, mid }
  }
  /** A model along a line from its first measured level `first`, run straight to the control's 0
   *  below it (at `ctl`); the model itself above (all on the axis's coordinate). */
  const toControl = (
    model: (v: number) => number,
    at: readonly number[],
    ctl: number | null,
    first: number
  ): number[] => {
    if (ctl == null) return at.map(model)
    const m1 = model(first)
    return at.map((v) => (v < first ? (m1 * (v - ctl)) / (first - ctl) : model(v)))
  }
  /** Known values along a line: the controls' 0 and (cells) the fitted values. */
  const knots = (along: 'dose' | 'time', level: number): { x: number[]; y: number[] } => {
    const x: number[] = []
    const y: number[] = []
    for (const v of along === 'dose' ? gridDoses : gridTimes) {
      const k = along === 'dose' ? key(v, level) : key(level, v)
      const w = zeros.has(k) ? 0 : kind === 'cells' ? fitted.get(k) : undefined
      if (w == null) continue
      x.push(along === 'dose' ? tx(v) : uOf(v))
      y.push(w)
    }
    return { x, y }
  }

  /** A line's model read from a control among its cells: its value less the model's there. */
  const fromMid = (
    model: ((v: number) => number) | null,
    at: number | null
  ): ((v: number) => number) | null => {
    if (!model || at == null) return model
    const m0 = model(at)
    return (v) => model(v) - m0
  }

  const ubar = desc?.jointUbar ?? input.ubar ?? 0
  const M = (lx: number, u: number): number => jointAt(jp!, ubar, lx, u)

  const doseCurve = (t: number, lxs: readonly number[]): Array<number | null> => {
    if (kind === 'none') return lxs.map(() => null)
    const { first, ctl, mid } = lineOf('dose', t)
    const sl = kind === 'byTime' ? byTime.get(t) : undefined
    const model = fromMid(
      first == null
        ? null
        : kind === 'joint'
          ? (lx: number) => M(lx, uOf(t))
          : sl
            ? (lx: number) => descValue(sl, lx)
            : null,
      mid == null ? null : tx(mid)
    )
    if (model) return toControl(model, lxs, ctl == null ? null : tx(ctl), tx(first!))
    // a line of cells without its slice's description: NA (a line of controls only: their 0)
    if (first != null && kind === 'byTime') return lxs.map(() => null)
    if (kind === 'byDose') {
      // across the doses' time curves at this time (and the controls' 0)
      const at = gridDoses.map((d) => timeCurve(d, [uOf(t)])[0])
      return join(gridDoses.map(tx), at, lxs)
    }
    const k = knots('dose', t)
    return join(k.x, k.y, lxs)
  }
  const timeCurve = (d: number, us: readonly number[]): Array<number | null> => {
    if (kind === 'none') return us.map(() => null)
    const { first, ctl, mid } = lineOf('time', d)
    const sl = kind === 'byDose' ? byDose.get(d) : undefined
    const model = fromMid(
      first == null
        ? null
        : kind === 'joint'
          ? (u: number) => M(tx(d), u)
          : sl
            ? (u: number) => descValue(sl, u)
            : null,
      mid == null ? null : uOf(mid)
    )
    if (model) return toControl(model, us, ctl == null ? null : uOf(ctl), uOf(first!))
    if (first != null && kind === 'byDose') return us.map(() => null)
    if (kind === 'byTime' || kind === 'cells') {
      // across the times' dose curves at this dose (and the controls' 0)
      const at = gridTimes.map((t) => doseCurve(t, [tx(d)])[0])
      return join(gridTimes.map(uOf), at, us)
    }
    const k = knots('time', d)
    return join(k.x, k.y, us)
  }

  const at = (d: number, t: number): number | null => {
    if (zeros.has(key(d, t))) return kind === 'none' ? null : 0
    return kind === 'byDose' ? timeCurve(d, [uOf(t)])[0] : doseCurve(t, [tx(d)])[0]
  }

  // The joint model between the measured levels: run down to the control column (dose 0 at every
  // time) and row (t₀) as its lines are.
  const lowestBelow = (vs: readonly number[], first: number): number | null => {
    let b: number | null = null
    for (const v of vs) if (v < first && (b == null || v > b)) b = v
    return b
  }
  const ctlColumn = lowestBelow(
    input.controls.map((c) => c.dose),
    doses[0]
  )
  const ctlRow = lowestBelow(
    input.controls.map((c) => c.time),
    times[0]
  )
  const jointBetween = (lx: number, u: number): number => {
    const lx0 = tx(doses[0])
    const u0 = uOf(times[0])
    const inTime = (x: number): number =>
      ctlRow == null || u >= u0 ? M(x, u) : toControl((w) => M(x, w), [u], uOf(ctlRow), u0)[0]
    return ctlColumn == null || lx >= lx0
      ? inTime(lx)
      : toControl(inTime, [lx], tx(ctlColumn), lx0)[0]
  }

  const grid = (gd: readonly number[], gt: readonly number[]): Array<Array<number | null>> => {
    if (kind === 'joint') {
      // the lines at the measured levels as drawn; the model itself between them
      const lxs = gd.map(tx)
      const us = gt.map(uOf)
      const isTime = new Set(gridTimes)
      const cols = new Map(
        gd.flatMap((d, j) => (gridDoses.includes(d) ? [[j, timeCurve(d, us)] as const] : []))
      )
      return gt.map((t, i) =>
        isTime.has(t)
          ? doseCurve(t, lxs)
          : lxs.map((lx, j) => cols.get(j)?.[i] ?? jointBetween(lx, us[i]))
      )
    }
    if (kind === 'byDose') {
      // each measured dose's time curve, joined across the doses
      const us = gt.map(uOf)
      const cols = gridDoses.map((d) => timeCurve(d, us))
      const lxs = gd.map(tx)
      const gxs = gridDoses.map(tx)
      return gt.map((_, i) =>
        join(
          gxs,
          cols.map((c) => c[i]),
          lxs
        )
      )
    }
    // each measured time's dose curve, joined across the times
    const lxs = gd.map(tx)
    const rows = gridTimes.map((t) => doseCurve(t, lxs))
    const gus = gridTimes.map(uOf)
    const us = gt.map(uOf)
    const cols = gd.map((_, j) =>
      join(
        gus,
        rows.map((r) => r[j]),
        us
      )
    )
    return gt.map((_, i) => cols.map((c) => c[i]))
  }

  return { kind, axes, doses, times, gridDoses, gridTimes, at, doseCurve, timeCurve, grid }
}

/** A fitted surface's cells and controls with a log axis's 0 at its place (SurfaceAxes.placeX):
 *  a level the axis can't hold — dose 0 against one position, the control's own dose 0 — drawn and
 *  read where the fit put it. */
export function placed<T extends SurfacePoint>(cells: readonly T[], axes: SurfaceAxes): T[] {
  return cells.map((c) => {
    const d = axes.placeX(c.dose)
    const t = axes.placeY(c.time)
    return d === c.dose && t === c.time ? c : { ...c, dose: d, time: t }
  })
}

/** A fitted surface (rs.axis 'surface') as one model view reads it: the description, or (the
 *  detector) the spline surface's fit at the cells. Null with no cells. */
export function fittedSurfaceModel(
  rs: ResponseFit,
  view: 'detector' | 'descriptor',
  slice?: 'time' | 'dose'
): SurfaceModel | null {
  const raw = rs.cells ?? []
  if (!raw.length) return null
  const fm = rs.maps
  const xLog = fm?.[0].scale !== 'linear'
  const yLog = fm?.[1].scale !== 'linear'
  const axes = surfaceAxes({
    xLog,
    yLog,
    doses: raw.map((c) => c.dose),
    times: raw.map((c) => c.time),
    maps: fm,
    timeOffset: rs.timeOffset
  })
  const cells = placed(raw, axes)
  const controls = placed(rs.controls ?? [], axes)
  return surfaceModel({
    cells,
    controls,
    axes,
    desc: rs.surface,
    fromCells: view === 'detector',
    join: 'pchip',
    slice,
    ubar: cells.reduce((a, c) => a + axes.uOf(c.time), 0) / cells.length
  })
}

/** A surface tested for response changes: the reference curve each point's shift is read from —
 *  the compared axis at its control level (`ctl`: dose 0, the vehicle's own curve, as the Curve
 *  fit's baseline set it; else its lowest level) — and its value at a point's response level: the
 *  cell there, or a control there (0, the baseline itself); null with neither. `alongB`: the curves
 *  run along the second axis (compared across the first). Cells and controls placed alike. */
export function shiftReference(
  cells: ReadonlyArray<SurfacePoint & { y: number }>,
  controls: readonly SurfacePoint[],
  alongB: boolean,
  ctl: number
): { level: number; at: (c: SurfacePoint) => number | null } {
  const across = (c: SurfacePoint): number => (alongB ? c.dose : c.time)
  const has = cells.some((c) => across(c) === ctl) || controls.some((c) => across(c) === ctl)
  const level = has ? ctl : Math.min(...cells.map(across))
  const ys = new Map(cells.map((c) => [key(c.dose, c.time), c.y]))
  const zeros = new Set(controls.map((c) => key(c.dose, c.time)))
  return {
    level,
    at: (c) => {
      const k = alongB ? key(level, c.time) : key(c.dose, level)
      const y = ys.get(k)
      return y != null ? y : zeros.has(k) ? 0 : null
    }
  }
}
