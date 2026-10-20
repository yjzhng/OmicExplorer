/**
 * The joint model of a two-axis response surface — one model over every treated cell, on log₂
 * effects relative to the cell's vehicle — built from a model per axis (docs/curve_fit_framework.md
 * §4):
 *
 *   e(a, b) = A · f_b(b; m_b + β_b·(a − ā)) · f_a(a; m_a + β_a·(b − b̄))
 *
 * a and b are the two axes' positions (x: log₁₀ of the level, or the level in steps — the axis
 * model's toX), and each axis's shape f is one of
 *   - '4pl':      S = 1 / (1 + 10^(−h·(x − m)))  from 0 (its baseline) to 1, midpoint m, slope h
 *   - 'linear':   (x − x₀) / (x₁ − x₀)           0 at its baseline x₀, 1 at its last level x₁
 *   - 'constant': 1                              no change along it
 * A 4PL axis may be coupled: its midpoint drifts linearly along the other axis (β). A is the
 * response's size. The dose × time preset — a dose 4PL whose midpoint drifts with time, times a time
 * 4PL from t₀ — is
 *
 *   e(x, u) = top(u) · S(x; m(u), h)
 *   S      = 1 / (1 + 10^(−h·(x − m)))          the dose curve, from 0 (the vehicle) to 1
 *   top(u) = A / (1 + 10^(−k·(u − τ)))          the response size over time, from t₀ (τ ≥ t₀)
 *   m(u)   = m0 + m1·(u − ū)                    the midpoint (log₁₀ dose), drifting with time
 *
 * — parameters named for it (A, k, τ, m0, m1, h; n1 the second axis's drift). A 4PL's midpoint
 * range follows its axis's baseline: against a reference (a control off the curve) within the
 * tested x ± PEC50_DELTA; against a matched baseline (its own first point) at or after it, up to one
 * past the last. Fitted to all the cells at once, so a weak level borrows from its neighbours; the
 * price is the assumed smooth change along each axis. Bounded Levenberg–Marquardt from the best few
 * of a grid of starts (A solved by least squares for each).
 */
import { toX, type AxisBaseline } from './axisModel'
import { PEC50_DELTA, Y_LIMITS_LOG2 } from './curveFit'
import { surfaceMaps, type SplineCurve } from './splineFit'

/** One axis's shape in the joint model. */
export type JointShape = '4pl' | 'linear' | 'constant'

/** One axis of the joint model: its shape, where its baseline sits on x, and (a 4PL) whether its
 *  midpoint drifts along the other axis. */
export interface JointAxis {
  shape: JointShape
  /** what the baseline is to the curve: a control off it ('reference') or its own first point */
  baseline: AxisBaseline
  /** the baseline's position on x: a matched baseline's level (t₀); against a reference one step
   *  below the lowest level (where a linear shape is 0; a 4PL's control is at −∞) */
  baseX: number
  coupled?: boolean
}
export interface JointSpec {
  a: JointAxis
  b: JointAxis
  /** against one position: the vehicle's own response along the second axis (its melt, at the
   *  first axis's base level), a term of its own — e += V · g_b(b), g_b the second axis's shape
   *  with its own midpoint and slope */
  vehicle?: boolean
}

/** The dose × time preset: a dose 4PL (against the vehicle) whose midpoint drifts with time, times
 *  a time 4PL from t₀ at `t0X` (log₁₀ of the offset). */
export const presetSpec = (t0X: number, doseBaseX = -Infinity): JointSpec => ({
  a: { shape: '4pl', baseline: 'reference', baseX: doseBaseX, coupled: true },
  b: { shape: '4pl', baseline: 'matched', baseX: t0X }
})
/** Whether a spec is the preset's shapes (what results before per-axis models were fitted with). */
const isPreset = (s: JointSpec): boolean =>
  !s.vehicle &&
  s.a.shape === '4pl' &&
  s.a.baseline === 'reference' &&
  !!s.a.coupled &&
  s.b.shape === '4pl' &&
  s.b.baseline === 'matched' &&
  !s.b.coupled

/**
 * The fitted joint model. The preset's parameters keep their names (a: the dose 4PL — m0, m1, h; b:
 * the time 4PL — τ, k); a shape without them leaves them 0. `spec` (absent: the preset, as every
 * result fitted before per-axis models) gives the shapes, a linear axis's x range, and the second
 * axis's drift n1 centred on xbar.
 */
export interface JointParams {
  A: number
  k: number
  tau: number
  m0: number
  m1: number
  h: number
  n1?: number
  xbar?: number
  /** the vehicle term (JointSpec.vehicle): its size, and its 4PL's slope and midpoint */
  V?: number
  kv?: number
  tauv?: number
  spec?: JointSpec & { aRange?: [number, number]; bRange?: [number, number] }
}

const sig = (z: number): number =>
  z > 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z))

/** Where each parameter sits in the packed vector the fit works on: A first, then — in the
 *  preset's order (A, k, τ, m0, m1, h) so its fits reproduce exactly — the second axis's slope and
 *  midpoint, the first's midpoint, drift and slope, then the second's drift. -1: not in the model. */
interface Layout {
  n: number
  k: number
  tau: number
  m0: number
  m1: number
  h: number
  n1: number
  V: number
  kv: number
  tauv: number
}
function layoutOf(s: JointSpec): Layout {
  let n = 1
  const at = (on: boolean): number => (on ? n++ : -1)
  const b4 = s.b.shape === '4pl'
  const a4 = s.a.shape === '4pl'
  const k = at(b4)
  const tau = at(b4)
  const m0 = at(a4)
  const m1 = at(a4 && !!s.a.coupled)
  const h = at(a4)
  const n1 = at(b4 && !!s.b.coupled)
  // the vehicle term last, so every model without one keeps its layout
  const V = at(!!s.vehicle)
  const kv = at(!!s.vehicle && b4)
  const tauv = at(!!s.vehicle && b4)
  return { n, k, tau, m0, m1, h, n1, V, kv, tauv }
}

/** The number of parameters the joint model with these shapes fits (the preset's: 6) — the F's
 *  numerator df. */
export const jointParamCount = (s: JointSpec): number => layoutOf(s).n

/** The model's packed form: the spec, its layout, the linear axes' x ranges and the centres the
 *  drifts are taken from. */
interface Packed {
  spec: JointSpec
  L: Layout
  aRange: [number, number]
  bRange: [number, number]
  /** b̄ (ū): the mean b the first axis's midpoint drift is centred on; ā likewise for the second */
  ubar: number
  xbar: number
}

/** One axis's shape at x: its 4PL (midpoint m, slope h), linear ramp or 1. */
function shapeAt(
  sh: JointShape,
  x: number,
  m: number,
  slope: number,
  range: [number, number]
): number {
  if (sh === '4pl') return sig(slope * Math.LN10 * (x - m))
  if (sh === 'linear') return (x - range[0]) / (range[1] - range[0])
  return 1
}

function model(v: number[], M: Packed, x: number, u: number): number {
  const { L, spec } = M
  const fb =
    spec.b.shape === '4pl'
      ? sig(v[L.k] * Math.LN10 * (u - (L.n1 < 0 ? v[L.tau] : v[L.tau] + v[L.n1] * (x - M.xbar))))
      : shapeAt(spec.b.shape, u, 0, 0, M.bRange)
  const fa =
    spec.a.shape === '4pl'
      ? sig(v[L.h] * Math.LN10 * (x - (L.m1 < 0 ? v[L.m0] : v[L.m0] + v[L.m1] * (u - M.ubar))))
      : shapeAt(spec.a.shape, x, 0, 0, M.aRange)
  if (L.V < 0) return v[0] * fb * fa
  const fv =
    spec.b.shape === '4pl'
      ? sig(v[L.kv] * Math.LN10 * (u - v[L.tauv]))
      : shapeAt(spec.b.shape, u, 0, 0, M.bRange)
  return v[0] * fb * fa + v[L.V] * fv
}

function sse(v: number[], M: Packed, xs: number[], us: number[], e: number[]): number {
  let s = 0
  for (let i = 0; i < e.length; i++) s += (e[i] - model(v, M, xs[i], us[i])) ** 2
  return s
}

/** Solve the small dense system M·d = g (Gaussian elimination, partial pivoting); null if singular. */
function solve(M: number[][], g: number[]): number[] | null {
  const n = g.length
  const a = M.map((r, i) => [...r, g[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r
    if (!(Math.abs(a[piv][c]) > 1e-300)) return null
    ;[a[c], a[piv]] = [a[piv], a[c]]
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c]
      for (let j = c; j <= n; j++) a[r][j] -= f * a[c][j]
    }
  }
  const d = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n]
    for (let j = r + 1; j < n; j++) s -= a[r][j] * d[j]
    d[r] = s / a[r][r]
  }
  return d
}

/** Bounded LM with a forward-difference Jacobian; steps are clamped into the box. */
function refine(
  p0: number[],
  lo: number[],
  hi: number[],
  M: Packed,
  xs: number[],
  us: number[],
  e: number[]
): { p: number[]; cost: number } {
  const np = p0.length
  const clamp = (p: number[]): number[] => p.map((v, i) => Math.min(hi[i], Math.max(lo[i], v)))
  let p = clamp(p0)
  let cost = sse(p, M, xs, us, e)
  let lambda = 1e-3
  const n = e.length
  for (let iter = 0; iter < 200 && cost > 0; iter++) {
    const f0 = e.map((_, i) => model(p, M, xs[i], us[i]))
    const J: number[][] = Array.from({ length: n }, () => new Array<number>(np).fill(0))
    for (let j = 0; j < np; j++) {
      const dh = 1e-6 * Math.max(1, Math.abs(p[j]))
      const q = [...p]
      q[j] += dh
      for (let i = 0; i < n; i++) J[i][j] = (model(q, M, xs[i], us[i]) - f0[i]) / dh
    }
    const JtJ = Array.from({ length: np }, (_, a) =>
      Array.from({ length: np }, (_, b) => J.reduce((s, r) => s + r[a] * r[b], 0))
    )
    const g = Array.from({ length: np }, (_, a) =>
      J.reduce((s, r, i) => s + r[a] * (e[i] - f0[i]), 0)
    )
    let improved = false
    while (lambda < 1e10) {
      const Mx = JtJ.map((r, a) => r.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)))
      const d = solve(Mx, g)
      if (d) {
        const q = clamp(p.map((v, j) => v + d[j]))
        const c = sse(q, M, xs, us, e)
        if (c < cost) {
          improved = cost - c > 1e-12 * cost + 1e-14
          p = q
          cost = c
          lambda = Math.max(lambda / 10, 1e-12)
          break
        }
      }
      lambda *= 10
    }
    if (!improved) break
  }
  return { p, cost }
}

/** A cell of a two-axis surface on the fit's own axes: its position on each (x — see the module
 *  comment) and its log₂ effect vs its vehicle. */
export interface JointCell {
  xa: number
  xb: number
  e: number
}

/**
 * Fit the joint model to a fitted surface's treated cells (effects vs their vehicle). Returns the
 * parameters, the first axis's midpoint (x) and the response's size at each treated level of the
 * second, and the residual sum of squares over the cells. Null for one-axis curves. `prefit` is a
 * fit of these same cells already made (the 4PL surface detector's), used as it is rather than
 * fitted again. `spec`: the axes' shapes (absent: the dose × time preset, on the surface's own
 * log₁₀ dose × log₁₀(t + offset)).
 */
export function fitJointSurface(
  c: SplineCurve,
  interpolation = false,
  prefit?: JointFit,
  spec?: JointSpec
): {
  params: JointParams
  byTime: Array<{ time: number; x50: number; top: number }>
  rss: number
  /** ū, the mean b the first axis's midpoint drift is centred on (see jointAt) */
  ubar: number
} | null {
  const s = c.surface
  if (!s) return null
  const nG = s.vehicle.length
  const [mapA, mapB] = surfaceMaps(s)
  const xa = (d: number): number => toX(mapA, d)
  const xb = (t: number): number => toX(mapB, t)
  const sp = spec ?? presetSpec(Math.log10(s.timeOffset))
  const fit =
    prefit ??
    fitJointCells(
      s.treated.map((r, i) => ({
        xa: xa(r.dose),
        xb: xb(r.time),
        e: c.y[nG + i] - s.vehicle[r.group].mean
      })),
      sp,
      interpolation
    )
  const times = [...new Set(s.treated.map((r) => r.time))].sort((a, b) => a - b)
  return {
    params: fit.params,
    byTime: times.map((time) => {
      const u = xb(time)
      const { x50, top } = sliceAt(fit.params, fit.ubar, u)
      return { time, x50, top }
    }),
    rss: fit.rss,
    ubar: fit.ubar
  }
}

/** The joint model along the first axis at one position u of the second: the first axis's 4PL
 *  midpoint there (NaN for another shape; its drift along the second taken) and the response's size
 *  (A times the second axis's shape at u). */
export function sliceAt(p: JointParams, ubar: number, u: number): { x50: number; top: number } {
  const sp = p.spec
  const a4 = (sp?.a.shape ?? '4pl') === '4pl'
  const x50 = a4 ? p.m0 + p.m1 * (u - ubar) : NaN
  // the size at u: the second axis's shape there (its drift along the first not taken)
  const top = p.A * shapeOf(p, 'b', u, NaN)
  return { x50, top }
}

/** One axis's shape value at its position x — the second axis's at u ('b'; its drift along the
 *  first taken at `other`, the first's position), or the first's at x ('a'). */
function shapeOf(p: JointParams, ax: 'a' | 'b', x: number, other: number): number {
  const sp = p.spec
  const sh = sp?.[ax].shape ?? '4pl'
  if (ax === 'b') {
    if (sh !== '4pl') return shapeAt(sh, x, 0, 0, sp?.bRange ?? [0, 1])
    const m = p.n1 && Number.isFinite(other) ? p.tau + p.n1 * (other - (p.xbar ?? 0)) : p.tau
    return sig(p.k * Math.LN10 * (x - m))
  }
  return shapeAt(sh, x, 0, 0, sp?.aRange ?? [0, 1])
}

/** The joint model fitted to bare cells (JointCell: each one's position on both axes and its log₂
 *  effect vs its vehicle), with the axes' shapes `spec`. Returns the parameters, the residual sum
 *  of squares over the cells, and ū (the mean b the first axis's midpoint drift is centred on).
 *  With `interpolation` (CurveCurator's), the fit also sees a point at the centre of each square of
 *  the measured grid (gridInterpolation); the RSS is still over the real cells alone. */
export function fitJointCells(
  cells: JointCell[],
  spec: JointSpec,
  interpolation = false
): { params: JointParams; rss: number; ubar: number } {
  const real = cells
  if (interpolation) cells = [...cells, ...gridInterpolation(cells)]
  const e = cells.map((c) => c.e)
  const xs = cells.map((c) => c.xa)
  const us = cells.map((c) => c.xb)
  const ubar = us.reduce((a, v) => a + v, 0) / us.length
  const xbar = xs.reduce((a, v) => a + v, 0) / xs.length
  const xl = [...new Set(xs)].sort((a, b) => a - b)
  const ul = [...new Set(us)].sort((a, b) => a - b)
  const L = layoutOf(spec)
  const M: Packed = {
    spec,
    L,
    aRange: [spec.a.baseX, xl[xl.length - 1]],
    bRange: [spec.b.baseX, ul[ul.length - 1]],
    ubar,
    xbar
  }
  // each 4PL's bounds: its midpoint by its baseline (see the module comment), slope as CurveCurator's
  const lo = new Array<number>(L.n).fill(0)
  const hi = new Array<number>(L.n).fill(0)
  ;[lo[0], hi[0]] = Y_LIMITS_LOG2
  const midRange = (ax: JointAxis, lv: number[]): [number, number] =>
    ax.baseline === 'matched'
      ? [ax.baseX, lv[lv.length - 1] + 1]
      : [lv[0] - PEC50_DELTA, lv[lv.length - 1] + PEC50_DELTA]
  const set = (i: number, r: [number, number]): void => {
    if (i >= 0) [lo[i], hi[i]] = r
  }
  set(L.k, [0.01, 10])
  if (L.tau >= 0) set(L.tau, midRange(spec.b, ul))
  if (L.m0 >= 0) set(L.m0, midRange(spec.a, xl))
  set(L.m1, [-2, 2])
  set(L.h, [0.01, 10])
  set(L.n1, [-2, 2])
  set(L.V, Y_LIMITS_LOG2)
  set(L.kv, [0.01, 10])
  if (L.tauv >= 0) set(L.tauv, midRange(spec.b, ul))
  const q = (a: number[], f: number): number =>
    a[Math.min(a.length - 1, Math.floor(f * (a.length - 1) + 0.5))]
  // a grid of starts for each 4PL's midpoint — below / inside / above the levels against a
  // reference, from just past the baseline to late against a matched one — the first 4PL's slope
  // shallow or steep (the other's at 2), each with its A by least squares; the best three are refined
  const mids = (ax: JointAxis, lv: number[]): number[] =>
    ax.baseline === 'matched'
      ? [ax.baseX + 0.01, q(lv, 0.25), q(lv, 0.5), q(lv, 0.75)]
      : [lv[0] - 1, q(lv, 0.25), q(lv, 0.5), q(lv, 0.75), lv[lv.length - 1] + 1]
  const one = [NaN]
  const starts: Array<{ p: number[]; cost: number }> = []
  for (const m0 of L.m0 >= 0 ? mids(spec.a, xl) : one)
    for (const tau of L.tau >= 0 ? mids(spec.b, ul) : one)
      for (const h of L.h >= 0 || L.k >= 0 ? [1, 5] : one) {
        const p = new Array<number>(L.n).fill(0)
        p[0] = 1
        if (L.k >= 0) p[L.k] = L.h >= 0 ? 2 : h
        if (L.tau >= 0) p[L.tau] = tau
        if (L.m0 >= 0) p[L.m0] = m0
        if (L.h >= 0) p[L.h] = h
        if (L.V >= 0) {
          // the vehicle term starts on the response's own midpoint along the second axis
          if (L.kv >= 0) p[L.kv] = 2
          if (L.tauv >= 0) p[L.tauv] = L.tau >= 0 ? tau : q(ul, 0.5)
          // A and V together by least squares: the product's shape and the vehicle's
          p[L.V] = 0
          const sh = xs.map((x, i) => model(p, M, x, us[i]))
          p[0] = 0
          p[L.V] = 1
          const gv = xs.map((x, i) => model(p, M, x, us[i]))
          const s11 = sh.reduce((a, v) => a + v * v, 0)
          const s22 = gv.reduce((a, v) => a + v * v, 0)
          const s12 = sh.reduce((a, v, i) => a + v * gv[i], 0)
          const b1 = sh.reduce((a, v, i) => a + v * e[i], 0)
          const b2 = gv.reduce((a, v, i) => a + v * e[i], 0)
          const det = s11 * s22 - s12 * s12
          p[0] = det > 1e-12 ? (b1 * s22 - b2 * s12) / det : s11 > 0 ? b1 / s11 : 0
          p[L.V] = det > 1e-12 ? (b2 * s11 - b1 * s12) / det : 0
          starts.push({ p, cost: sse(p, M, xs, us, e) })
          continue
        }
        const sh = xs.map((x, i) => model(p, M, x, us[i]))
        const ss = sh.reduce((a, v) => a + v * v, 0)
        p[0] = ss > 0 ? sh.reduce((a, v, i) => a + v * e[i], 0) / ss : 0
        starts.push({ p, cost: sse(p, M, xs, us, e) })
      }
  starts.sort((a, b) => a.cost - b.cost)
  let best = { p: starts[0].p, cost: Infinity }
  for (const st of starts.slice(0, 3)) {
    const r = refine(st.p, lo, hi, M, xs, us, e)
    if (r.cost < best.cost) best = r
  }
  const v = best.p
  const rss =
    real === cells
      ? best.cost
      : sse(
          v,
          M,
          real.map((c) => c.xa),
          real.map((c) => c.xb),
          real.map((c) => c.e)
        )
  const at = (i: number): number => (i >= 0 ? v[i] : 0)
  const params: JointParams = {
    A: v[0],
    k: at(L.k),
    tau: at(L.tau),
    m0: at(L.m0),
    m1: at(L.m1),
    h: at(L.h),
    ...(L.n1 >= 0 ? { n1: v[L.n1], xbar } : null),
    ...(L.V >= 0 ? { V: v[L.V], ...(L.kv >= 0 ? { kv: v[L.kv], tauv: v[L.tauv] } : null) } : null),
    // the shapes, unless the preset's (every result before per-axis models)
    ...(isPreset(spec) ? null : { spec: { ...spec, aRange: M.aRange, bRange: M.bRange } })
  }
  return { params, rss, ubar }
}

/** CurveCurator's interpolation points for a surface's cells, at the centre of each square of
 *  the measured grid (on the fit's axes): its value read off the bilinear surface through the
 *  square's four corners — at the centre, their mean (replicates at a corner averaged first). A
 *  square with a corner unmeasured gets none. Inside the squares, never on the grid's lines. */
function gridInterpolation(cells: JointCell[]): JointCell[] {
  const sums = new Map<string, { s: number; n: number }>()
  for (const c of cells) {
    if (!Number.isFinite(c.e)) continue
    const k = `${c.xa}|${c.xb}`
    const a = sums.get(k)
    if (a) {
      a.s += c.e
      a.n++
    } else sums.set(k, { s: c.e, n: 1 })
  }
  const at = (xa: number, xb: number): number | undefined => {
    const a = sums.get(`${xa}|${xb}`)
    return a ? a.s / a.n : undefined
  }
  const as = [...new Set(cells.map((c) => c.xa))].sort((a, b) => a - b)
  const bs = [...new Set(cells.map((c) => c.xb))].sort((a, b) => a - b)
  const out: JointCell[] = []
  for (let i = 0; i + 1 < as.length; i++)
    for (let j = 0; j + 1 < bs.length; j++) {
      const corners = [
        at(as[i], bs[j]),
        at(as[i + 1], bs[j]),
        at(as[i], bs[j + 1]),
        at(as[i + 1], bs[j + 1])
      ]
      if (corners.some((v) => v === undefined)) continue
      out.push({
        xa: (as[i] + as[i + 1]) / 2,
        xb: (bs[j] + bs[j + 1]) / 2,
        e: (corners as number[]).reduce((a, v) => a + v, 0) / 4
      })
    }
  return out
}

/** The joint model's value at a position (xa, xb) on its axes (fitJointCells' parameters and ū). */
export function jointAt(p: JointParams, ubar: number, xa: number, xb: number): number {
  const sp = p.spec
  const fa =
    (sp?.a.shape ?? '4pl') === '4pl'
      ? sig(p.h * Math.LN10 * (xa - (p.m0 + p.m1 * (xb - ubar))))
      : shapeOf(p, 'a', xa, xb)
  const prod = p.A * shapeOf(p, 'b', xb, xa) * fa
  if (!sp?.vehicle || p.V == null) return prod
  // the vehicle term: the second axis's shape with its own midpoint and slope
  const fv =
    sp.b.shape === '4pl'
      ? sig((p.kv ?? 0) * Math.LN10 * (xb - (p.tauv ?? 0)))
      : shapeAt(sp.b.shape, xb, 0, 0, sp.bRange ?? [0, 1])
  return prod + p.V * fv
}

/** The dose × time joint model's value at a dose and time (log₁₀ dose, log₁₀(t + offset)) — the
 *  preset's axes, as results before per-axis models were fitted on. */
export function jointPredict(
  p: JointParams,
  ubar: number,
  dose: number,
  time: number,
  timeOffset: number
): number {
  return jointAt(p, ubar, Math.log10(dose), Math.log10(time + timeOffset))
}

/** A batch of joint fits to hand out (to the worker pool, or fitted in place). */
export type JointBatch = Array<{
  cells: JointCell[]
  spec: JointSpec
  /** CurveCurator's interpolation in the fit (see fitJointCells) */
  interpolation?: boolean
}>
export type JointFit = ReturnType<typeof fitJointCells>
/** Fit a batch here, one surface after another. */
export const fitJointBatch = (batch: JointBatch): JointFit[] =>
  batch.map((j) => fitJointCells(j.cells, j.spec, j.interpolation))
