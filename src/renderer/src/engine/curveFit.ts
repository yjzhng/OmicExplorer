/**
 * Dose–response curve fitting: CurveCurator's recalibrated F-test (Bayer et al., Nat Commun 2023;
 * github.com/kusterlab/curve_curator, `models.py` + `quantification.fit_model`). Each curve is a
 * 4-parameter log-logistic fit of the response RATIO to the control over log₁₀ dose, tested
 * against a flat null (the mean) with an F statistic whose distribution was recalibrated by
 * simulation — a non-linear fit does not follow the textbook F(k − 1, n − k).
 *
 * Ported as CurveCurator runs it by default: OLS, the 'standard' speed (the best of its starting
 * guesses, refined from three slopes), no interpolation points, fold change from the lowest to the
 * highest dose. The control enters as ONE point, ratio 1 at x = −∞ (its replicates go into the
 * ratio's denominator, not the fit). Only the local optimiser differs: SciPy's L-BFGS-B there,
 * bounded Levenberg–Marquardt here — both refine the same starts to the same least-squares minimum.
 */
import { rng } from './sam'
import {
  applyThreshold,
  betai,
  CC_Q_MIN,
  studentTppf,
  type ThresholdCall,
  type ThresholdConfig
} from './stats'

/** CurveCurator's global limits (models.py). */
export const PEC50_DELTA = 2 // pEC50 may lie this many log₁₀ units beyond the tested doses
const SLOPE_LIMITS: [number, number] = [0.01, 10]
const Y_LIMITS: [number, number] = [1e-4, 1e6]
/** The same plateau limits for a fit on log₂ ratios. */
export const Y_LIMITS_LOG2: [number, number] = [Math.log2(Y_LIMITS[0]), Math.log2(Y_LIMITS[1])]
/** The fit's starting slopes ('standard' speed): flat, unit and steep. */
const START_SLOPES = [SLOPE_LIMITS[0], 1, SLOPE_LIMITS[1]]
/** The recalibrated F distribution's location (CurveCurator's default `loc`). */
const F_LOC = 0.12
const LN10 = Math.LN10

/** pec50 = −log₁₀ EC50; front = plateau at low dose (x → −∞), back = at high dose. */
export interface LogisticParams {
  pec50: number
  slope: number
  front: number
  back: number
}
type Vec = [number, number, number, number]
const toVec = (p: LogisticParams): Vec => [p.pec50, p.slope, p.front, p.back]
const fromVec = (v: Vec): LogisticParams => ({ pec50: v[0], slope: v[1], front: v[2], back: v[3] })

/** The low-dose share w of the curve at x: 1 at x = −∞ (front), 0 at +∞ (back). Written as a
 *  logistic in the exponent so it neither overflows nor turns NaN at the control's −∞. */
function lowShare(x: number, pec50: number, slope: number): number {
  if (x === -Infinity) return 1
  const u = slope * (x + pec50) * LN10
  return u > 0 ? Math.exp(-u) / (1 + Math.exp(-u)) : 1 / (1 + Math.exp(u))
}

/** The 4-parameter log-logistic: (front − back) / (1 + 10^(slope·(x + pec50))) + back — in
 *  CurveCurator's own arithmetic, so exact ties between starting guesses break the same way. At
 *  the control (x = −∞) the power is 0 (front); where it overflows, ∞ (back). */
export function logistic(x: number, p: LogisticParams): number {
  return (p.front - p.back) / (1 + 10 ** (p.slope * (x + p.pec50))) + p.back
}

/** Log-doses to draw a fitted curve at, over [xMin, xMax]: `base` evenly spaced, then each span
 *  split in half while the curve still bends inside it — so a steep turn gets as many points as it
 *  needs to look smooth and a flat stretch none extra (thousands of background curves stay cheap).
 *  A span bends when the curve's log₂ value at its quarter points strays from the straight chord
 *  by more than `tol`: a fraction of the curve's own rise, floored. Quarter points, not the
 *  midpoint: a turn centred on the midpoint meets the chord there exactly and would pass. */
export function curveSampleX(
  p: LogisticParams & { xMin: number; xMax: number },
  base = 25,
  maxDepth = 7
): number[] {
  const { xMin, xMax } = p
  const f = (lx: number): number => Math.log2(logistic(lx, p))
  if (!(xMax > xMin) || base < 2) return [xMin, xMax]
  const rise = Math.abs(f(xMax) - f(xMin))
  const tol = Math.max(0.004, rise * 0.002)
  const out: number[] = [xMin]
  const split = (a: number, fa: number, b: number, fb: number, depth: number): void => {
    const q1 = a + (b - a) / 4
    const q3 = a + ((b - a) * 3) / 4
    const bent =
      depth < maxDepth &&
      (Math.abs(f(q1) - (fa * 3 + fb) / 4) > tol || Math.abs(f(q3) - (fa + fb * 3) / 4) > tol)
    if (bent) {
      const m = (a + b) / 2
      const fm = f(m)
      split(a, fa, m, fm, depth + 1)
      split(m, fm, b, fb, depth + 1)
    } else out.push(b)
  }
  let a = xMin
  let fa = f(a)
  for (let i = 1; i < base; i++) {
    const b = xMin + ((xMax - xMin) * i) / (base - 1)
    const fb = f(b)
    split(a, fa, b, fb, 0)
    a = b
    fa = fb
  }
  return out
}

/** ∂f/∂(pec50, slope, front, back) at x — CurveCurator's `jacobian_matrix`, with its NaN → 0 at
 *  the control (x = −∞, where only the front plateau matters). */
function gradient(x: number, v: Vec): Vec {
  const [pec50, slope, front, back] = v
  const w = lowShare(x, pec50, slope)
  if (!Number.isFinite(x)) return [0, 0, w, 1 - w]
  const dw = -w * (1 - w) * LN10 // ∂w/∂(slope·(x + pec50))
  return [(front - back) * dw * slope, (front - back) * dw * (x + pec50), w, 1 - w]
}

function sse(xs: number[], ys: number[], v: Vec): number {
  return sse4(xs, ys, v[0], v[1], v[2], v[3])
}

/** `logistic` on bare parameters (pec50, slope, front, back) — the same arithmetic, without an
 *  object per call. The fit's hot loops call it tens of millions of times. */
function logistic4(x: number, pec50: number, slope: number, front: number, back: number): number {
  return (front - back) / (1 + 10 ** (slope * (x + pec50))) + back
}
/** `sse` on bare parameters (see logistic4). */
function sse4(xs: number[], ys: number[], p0: number, p1: number, p2: number, p3: number): number {
  let s = 0
  for (let i = 0; i < xs.length; i++) {
    const r = ys[i] - logistic4(xs[i], p0, p1, p2, p3)
    s += r * r
  }
  return s
}

export interface Bounds {
  lo: Vec
  hi: Vec
}
/** CurveCurator's `set_boundaries`: pEC50 within the tested doses ± PEC50_DELTA (from the treated
 *  doses only — the control's −∞ is not a dose), slope and plateaus within the global limits
 *  (`yLimits`: CurveCurator's ratio limits unless given). */
export function boundsFor(doseX: number[], yLimits: [number, number] = Y_LIMITS): Bounds {
  let lo = Infinity
  let hi = -Infinity
  for (const x of doseX) {
    lo = Math.min(lo, -x)
    hi = Math.max(hi, -x)
  }
  return {
    lo: [lo - PEC50_DELTA, SLOPE_LIMITS[0], yLimits[0], yLimits[0]],
    hi: [hi + PEC50_DELTA, SLOPE_LIMITS[1], yLimits[1], yLimits[1]]
  }
}
const clampVec = (v: Vec, b: Bounds): Vec =>
  v.map((x, i) => Math.min(b.hi[i], Math.max(b.lo[i], x))) as Vec

const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length
function median(a: number[]): number {
  const s = [...a].sort((p, q) => p - q)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** CurveCurator's `alternative_guesses` (x ascending, the control first at −∞): a flat null guess,
 *  then a step between every pair of neighbouring doses (front = mean of the points before it, back
 *  = mean of those after), plus one step beyond each end. All at the steepest slope, clipped. */
export function startGuesses(xs: number[], ys: number[], b: Bounds): Vec[] {
  const s = SLOPE_LIMITS[1]
  const yMean = mean(ys)
  const n = xs.length
  const out: Vec[] = []
  const add = (logEc50: number, front: number, back: number): void => {
    out.push(clampVec([-logEc50, s, front, back], b))
  }
  add(median(xs), yMean, yMean)
  add(xs[0] - (xs[1] - xs[0]) / 2, 1, yMean)
  add(xs[1] - (xs[2] - xs[1]) / 2, ys[0], mean(ys.slice(1)))
  for (let k = 2; k < n; k++) add((xs[k - 1] + xs[k]) / 2, mean(ys.slice(0, k)), mean(ys.slice(k)))
  add(xs[n - 1] + (xs[n - 1] - xs[n - 2]) / 2, yMean, 1)
  return out
}

/** Solve the 4×4 system A·d = g (Gaussian elimination, partial pivoting), over the free indices
 *  only (the rest of d stays 0). False when singular. Allocation-free: `A` is row-major 4×4, the
 *  answer goes into `d`, and `M` holds the m working rows (each m + 1 wide). */
function solve(
  A: Float64Array,
  g: Float64Array,
  free: Int32Array,
  m: number,
  d: Float64Array,
  M: Float64Array[]
): boolean {
  for (let r = 0; r < m; r++) {
    const row = M[r]
    const fr = free[r]
    for (let j = 0; j < m; j++) row[j] = A[fr * 4 + free[j]]
    row[m] = g[fr]
  }
  for (let c = 0; c < m; c++) {
    let piv = c
    for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    if (!(Math.abs(M[piv][c]) > 1e-300)) return false
    const tmp = M[c]
    M[c] = M[piv]
    M[piv] = tmp
    const Mc = M[c]
    for (let r = c + 1; r < m; r++) {
      const Mr = M[r]
      const f = Mr[c] / Mc[c]
      for (let k = c; k <= m; k++) Mr[k] -= f * Mc[k]
    }
  }
  d[0] = 0
  d[1] = 0
  d[2] = 0
  d[3] = 0
  for (let r = m - 1; r >= 0; r--) {
    const Mr = M[r]
    let s = Mr[m]
    for (let k = r + 1; k < m; k++) s -= Mr[k] * d[free[k]]
    d[free[r]] = s / Mr[r]
  }
  return true
}

const clampTo = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))

/** Bounded Levenberg–Marquardt least squares from `start`. A parameter pinned at a bound with the
 *  gradient pushing it further out is held there for the step (a simple active set), so the rest
 *  can still move. Returns the refined parameters and their SSE.
 *
 *  Written on scalars and preallocated buffers (it runs ~10⁵ times per curve-fit comparison), in
 *  exactly the floating-point operations and order of the straightforward version — so its
 *  results are bit-identical to it. */
function refine(xs: number[], ys: number[], start: Vec, b: Bounds): { v: Vec; cost: number } {
  const lo = b.lo
  const hi = b.hi
  let v0 = clampTo(start[0], lo[0], hi[0])
  let v1 = clampTo(start[1], lo[1], hi[1])
  let v2 = clampTo(start[2], lo[2], hi[2])
  let v3 = clampTo(start[3], lo[3], hi[3])
  let cost = sse4(xs, ys, v0, v1, v2, v3)
  let lambda = 1e-3
  const A = new Float64Array(16)
  const D = new Float64Array(16)
  const g = new Float64Array(4)
  const d = new Float64Array(4)
  const free = new Int32Array(4)
  const M = [new Float64Array(5), new Float64Array(5), new Float64Array(5), new Float64Array(5)]
  const n = xs.length
  for (let iter = 0; iter < 200 && cost > 0; iter++) {
    // Normal equations: A = JᵀJ, g = Jᵀr (r = y − f).
    A.fill(0)
    g.fill(0)
    const fb = v2 - v3
    for (let i = 0; i < n; i++) {
      const x = xs[i]
      // the gradient (see `gradient`)
      const w = lowShare(x, v0, v1)
      let J0 = 0
      let J1 = 0
      const J2 = w
      const J3 = 1 - w
      if (Number.isFinite(x)) {
        const dw = -w * (1 - w) * LN10
        J0 = fb * dw * v1
        J1 = fb * dw * (x + v0)
      }
      const r = ys[i] - logistic4(x, v0, v1, v2, v3)
      g[0] += J0 * r
      A[0] += J0 * J0
      A[1] += J0 * J1
      A[2] += J0 * J2
      A[3] += J0 * J3
      g[1] += J1 * r
      A[4] += J1 * J0
      A[5] += J1 * J1
      A[6] += J1 * J2
      A[7] += J1 * J3
      g[2] += J2 * r
      A[8] += J2 * J0
      A[9] += J2 * J1
      A[10] += J2 * J2
      A[11] += J2 * J3
      g[3] += J3 * r
      A[12] += J3 * J0
      A[13] += J3 * J1
      A[14] += J3 * J2
      A[15] += J3 * J3
    }
    let m = 0
    if (!((v0 <= lo[0] && g[0] < 0) || (v0 >= hi[0] && g[0] > 0))) free[m++] = 0
    if (!((v1 <= lo[1] && g[1] < 0) || (v1 >= hi[1] && g[1] > 0))) free[m++] = 1
    if (!((v2 <= lo[2] && g[2] < 0) || (v2 >= hi[2] && g[2] > 0))) free[m++] = 2
    if (!((v3 <= lo[3] && g[3] < 0) || (v3 >= hi[3] && g[3] > 0))) free[m++] = 3
    if (m === 0) break
    let improved = false
    while (lambda < 1e12) {
      for (let k = 0; k < 16; k++) {
        const x = A[k]
        D[k] = k % 5 === 0 ? x + lambda * (x + 1e-9) : x
      }
      if (solve(D, g, free, m, d, M)) {
        const n0 = clampTo(v0 + d[0], lo[0], hi[0])
        const n1 = clampTo(v1 + d[1], lo[1], hi[1])
        const n2 = clampTo(v2 + d[2], lo[2], hi[2])
        const n3 = clampTo(v3 + d[3], lo[3], hi[3])
        const nextCost = sse4(xs, ys, n0, n1, n2, n3)
        if (nextCost < cost) {
          const gain = cost - nextCost
          v0 = n0
          v1 = n1
          v2 = n2
          v3 = n3
          cost = nextCost
          lambda = Math.max(lambda / 10, 1e-12)
          improved = gain > 1e-14 + 1e-12 * cost
          break
        }
      }
      lambda *= 10
    }
    if (!improved) break
  }
  return { v: [v0, v1, v2, v3], cost }
}

/** CurveCurator's 'standard' OLS fit: the starting guess with the lowest SSE, refined from each
 *  of the three starting slopes; the lowest-SSE result wins. `doseX` sets the pEC50 bounds,
 *  `yLimits` the plateaus' (see boundsFor); `pec50Max` caps pEC50 further (the midpoint may not lie
 *  below −pec50Max on x); `front` fixes the low plateau. */
export function fitLogistic(
  xs: number[],
  ys: number[],
  doseX: number[],
  opts: { yLimits?: [number, number]; pec50Max?: number; front?: number } = {}
): LogisticParams {
  const b = boundsFor(doseX, opts.yLimits)
  if (opts.pec50Max != null) b.hi[0] = Math.max(b.lo[0], Math.min(b.hi[0], opts.pec50Max))
  if (opts.front != null) b.lo[2] = b.hi[2] = opts.front
  const guesses = startGuesses(xs, ys, b)
  let best: Vec = guesses[0]
  let bestCost = Infinity
  for (const guess of guesses) {
    const c = sse(xs, ys, guess)
    if (c <= bestCost) [best, bestCost] = [guess, c]
  }
  let fit = { v: best, cost: Infinity }
  for (const slope of START_SLOPES) {
    const r = refine(xs, ys, [best[0], slope, best[2], best[3]], b)
    if (r.cost < fit.cost) fit = r
  }
  return fromVec(fit.v)
}

/** Invert a symmetric 4×4 matrix by Gauss–Jordan with partial pivoting; null when singular. */
function invert4(m: number[][]): number[][] | null {
  const a = m.map((row, i) => [...row, ...[0, 1, 2, 3].map((j) => (i === j ? 1 : 0))])
  for (let c = 0; c < 4; c++) {
    let piv = c
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r
    if (!(Math.abs(a[piv][c]) > 1e-12)) return null
    ;[a[c], a[piv]] = [a[piv], a[c]]
    const d = a[c][c]
    for (let j = 0; j < 8; j++) a[c][j] /= d
    for (let r = 0; r < 4; r++) {
      if (r === c) continue
      const f = a[r][c]
      if (f !== 0) for (let j = 0; j < 8; j++) a[r][j] -= f * a[c][j]
    }
  }
  return a.map((row) => row.slice(4))
}

/**
 * A fitted curve's pointwise confidence band — where the TRUE curve plausibly lies at each dose —
 * by the standard non-linear least-squares approximation: the parameters' covariance is
 * s²·(JᵀJ)⁻¹ (J the model's gradient at the fit's points, s² = SSE / (n − 4)), the curve's
 * standard error at x is √(gᵀ·Cov·g) with g the gradient there, and the band is ± the two-sided
 * t-quantile (n − 4 df) times it. The fit's own points: the control as one point, ratio 1 at
 * −∞, plus every measured ratio (`doseX` log₁₀ doses, `ratios`) — as fitCurve fits them.
 *
 * Returned on the plot's log₂ scale by the delta method (se / (f·ln 2)), so it stays defined
 * where the ratio's band would cross 0. Null when it can't be estimated: four or fewer points, a
 * singular JᵀJ (a parameter the data don't constrain), or a non-positive fitted ratio.
 */
export function curveBand(
  p: LogisticParams,
  doseX: number[],
  ratios: number[],
  at: number[],
  level = 0.95
): { mid: number[]; lo: number[]; hi: number[] } | null {
  const xs = [-Infinity]
  const ys = [1]
  for (let i = 0; i < doseX.length; i++)
    if (Number.isFinite(doseX[i]) && Number.isFinite(ratios[i])) {
      xs.push(doseX[i])
      ys.push(ratios[i])
    }
  const n = xs.length
  const df = n - 4
  if (df <= 0) return null
  const v = toVec(p)
  const jtj = [0, 1, 2, 3].map(() => [0, 0, 0, 0])
  let ss = 0
  for (let i = 0; i < n; i++) {
    const g = gradient(xs[i], v)
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) jtj[r][c] += g[r] * g[c]
    const e = ys[i] - logistic(xs[i], p)
    ss += e * e
  }
  const inv = invert4(jtj)
  if (!inv) return null
  const s2 = ss / df
  const t = studentTppf(1 - level, df)
  if (!Number.isFinite(t)) return null
  const mid: number[] = []
  const lo: number[] = []
  const hi: number[] = []
  for (const x of at) {
    const f = logistic(x, p)
    if (!(f > 0)) return null
    const g = gradient(x, v)
    let q = 0
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) q += g[r] * inv[r][c] * g[c]
    const half = (t * Math.sqrt(Math.max(0, s2 * q))) / (f * Math.LN2)
    const m = Math.log2(f)
    mid.push(m)
    lo.push(m - half)
    hi.push(m + half)
  }
  return { mid, lo, hi }
}

/**
 * A curve's M0 — the flat null, its mean ratio — on the plot's log₂ scale, with that mean's
 * two-sided confidence half-width (t on n − 1 df; the delta method onto log₂). From the m0 / m0SE
 * kept with the fit, else rebuilt from its kept points (the control: ratio 1). Null when neither is
 * there; `half` is Infinity with a single point.
 */
export function curveM0(
  c: { m0?: number; m0SE?: number; n: number; y?: number[] },
  level = 0.95
): { mid: number; half: number } | null {
  let mean = c.m0
  let se = c.m0SE
  let n = c.n
  if (mean == null || se == null) {
    if (!c.y) return null
    const ys = [1, ...c.y.filter(Number.isFinite)]
    n = ys.length
    mean = ys.reduce((s, y) => s + y, 0) / n
    const m = mean
    se = n > 1 ? Math.sqrt(ys.reduce((s, y) => s + (y - m) ** 2, 0) / (n - 1) / n) : Infinity
  }
  if (!(mean > 0)) return null
  const t = n > 1 ? studentTppf(1 - level, n - 1) : Infinity
  return { mid: Math.log2(mean), half: (t * se) / (mean * Math.LN2) }
}

/** The recalibrated degrees of freedom for the 4-parameter fit on n points (control included):
 *  dfn = 5, dfd = (0.8 − 1/((n − 4)⁴/n + 4))·(n − 2.5) — CurveCurator's `get_dofs(optimized)`. */
export function curveDofs(n: number): { dfn: number; dfd: number } {
  return { dfn: 5, dfd: (0.8 - 1 / ((n - 4) ** 4 / n + 4)) * (n - 2.5) }
}

/** P(F > f) for an F(dfn, dfd) distribution shifted by `loc` (scipy's `f.sf(f, dfn, dfd, loc)`). */
export function fSurvival(f: number, dfn: number, dfd: number, loc = 0): number {
  const x = f - loc
  if (!(x > 0)) return 1
  if (!Number.isFinite(x)) return 0
  return betai(dfd / 2, dfn / 2, dfd / (dfd + dfn * x))
}

/** Curves are described (4PL) up to this q, so a stricter or looser call made later — the
 *  threshold follows without a re-run — still finds its called curves described. Read by the
 *  response surface method's description, and by a 4PL curve's when it describes responders only
 *  (there the q is BH over the run's raw p, fixed at run time). */
export const DESCRIBE_Q = 0.25

/** Whether a 4PL curve's description (EC50, slope, plateaus) is meant to be read: every curve's
 *  is, unless its run described responders only and it isn't one (`described: false`). Its test
 *  stands either way. */
export const curveDescribed = (c: { described?: false }): boolean => c.described !== false

/** One fitted curve and its test. `xMin`/`xMax` are the tested log₁₀ doses' range. */
export interface CurveFit extends LogisticParams {
  /** curve fold change, log₂: the fitted ratio at the highest dose over that at the lowest */
  log2FC: number
  /** CurveCurator's recalibrated F statistic and its p-value */
  f: number
  pVal: number
  /** R² of the fit (0 when no better than the flat line) */
  r2: number
  /** root-mean-square residual of the fit over its points (control included) — absent on results
   *  run before it was kept */
  rmse?: number
  /** points in the fit, the control's included */
  n: number
  /** the lack-of-fit test (curveLackOfFit): its F and p-value — absent where the doses have no
   *  replicates to estimate pure error from, or on results run before it was kept */
  lofF?: number
  lofP?: number
  xMin: number
  xMax: number
  /** M0, the flat null the F-test compares against: the mean ratio of the fit's points (control
   *  included), and that mean's standard error — absent on results run before they were kept */
  m0?: number
  m0SE?: number
}

/**
 * Fit and test one curve — CurveCurator's `fit_model`. `doseX` are the treated points' log₁₀ doses
 * and `ratios` their response relative to the control's mean (both may hold replicates, in any
 * order; non-finite ratios are dropped). The control is added as one point, ratio 1 at −∞. Null
 * when 4 or fewer points remain — the fit has 4 parameters.
 */
export function fitCurve(doseX: number[], ratios: number[], grid?: number[]): CurveFit | null {
  const pts: Array<[number, number]> = []
  for (let i = 0; i < doseX.length; i++)
    if (Number.isFinite(doseX[i]) && Number.isFinite(ratios[i])) pts.push([doseX[i], ratios[i]])
  pts.sort((a, b) => a[0] - b[0])
  const xs = [-Infinity, ...pts.map((p) => p[0])]
  const ys = [1, ...pts.map((p) => p[1])]
  const n = xs.length
  if (n <= 4) return null
  const dx = xs.slice(1)
  // CurveCurator's interpolation (`interpolation = true`): the fit — both models — also sees the
  // grid's points within the curve's measured range, each read off the straight line between the
  // neighbouring measured ratios; the test, R² and fold change stay on the real points alone.
  const fitPts = grid?.length ? withInterpolation(xs, ys, pts, grid) : { x: xs, y: ys }
  const p = fitLogistic(fitPts.x, fitPts.y, dx)
  const v = toVec(p)

  // Null model: the flat line fitted to the same points as the curve — the mean of every point
  // (control included), the grid's too when interpolating; both SSEs on the real points, nudged as
  // CurveCurator does so a perfect fit doesn't divide by zero.
  const level = mean(fitPts.y)
  const yMean = mean(ys)
  const sst = ys.reduce((s, y) => s + (y - yMean) ** 2, 0)
  const m0 = ys.reduce((s, y) => s + (y - level) ** 2, 0) + 1e-20
  const m1 = sse(xs, ys, v) + 1e-20
  const k = 4
  const f = Math.max(0, ((m0 - m1) / m1) * (n / k))
  const { dfn, dfd } = curveDofs(n)
  const r2 = Math.max(0, 1 - (m1 - 1e-20 + 1e-10) / (sst + 1e-10))
  const xMin = dx[0]
  const xMax = dx[dx.length - 1]
  const lof = curveLackOfFit(dx, ys.slice(1), p)
  return {
    ...p,
    ...(lof ? { lofF: lof.f, lofP: lof.p } : null),
    log2FC: Math.log2(logistic(xMax, p)) - Math.log2(logistic(xMin, p)),
    f,
    pVal: fSurvival(f, dfn, dfd, F_LOC),
    r2,
    rmse: Math.sqrt(Math.max(0, m1 - 1e-20) / n),
    n,
    xMin,
    xMax,
    m0: level,
    m0SE: Math.sqrt(sst / (n - 1) / n)
  }
}

/**
 * The lack-of-fit test of a fitted curve: does the 4PL describe the dose means, given how much the
 * replicates scatter about them? The fit's residual sum of squares (on its real points, the
 * control — ratio 1 at −∞ — included, as the F-test's) splits into pure error (each replicate
 * about its dose's mean) and lack of fit (the rest); F = (SS_lof / (c − 4)) / (SS_pe / (n − c)) over
 * c dose groups and n points, against F(c − 4, n − c). Undefined without both degrees of freedom —
 * no replicates, or 4 or fewer doses. `doseX` / `ratios` are the treated points (log₁₀ dose, ratio
 * to the control).
 */
export function curveLackOfFit(
  doseX: number[],
  ratios: number[],
  p: LogisticParams
): { f: number; p: number } | undefined {
  const groups = new Map<number, number[]>()
  let sseAll = (1 - p.front) ** 2
  let n = 1
  for (let i = 0; i < doseX.length; i++) {
    const x = doseX[i]
    const y = ratios[i]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    sseAll += (y - logistic(x, p)) ** 2
    n++
    const g = groups.get(x)
    if (g) g.push(y)
    else groups.set(x, [y])
  }
  const c = groups.size + 1
  const dfLof = c - 4
  const dfPe = n - c
  if (dfLof < 1 || dfPe < 1) return undefined
  let ssPe = 0
  for (const ys of groups.values()) {
    const m = mean(ys)
    for (const y of ys) ssPe += (y - m) ** 2
  }
  const ssLof = Math.max(0, sseAll - ssPe)
  if (!(ssPe > 0)) return undefined
  const f = ssLof / dfLof / (ssPe / dfPe)
  return { f, p: fSurvival(f, dfLof, dfPe) }
}

/** Whether a curve has (or can be given, from its kept points) a lack-of-fit test. */
export function curveHasLof(
  c: LogisticParams & { lofF?: number; x?: number[]; y?: number[] }
): boolean {
  return c.lofF != null || (!!c.x && !!c.y && curveLackOfFit(c.x, c.y, c) != null)
}

/** The interpolation grid: the tested positions (log₁₀ dose, or log time) with ONE midpoint in
 *  every gap between neighbours, whatever its width — so each gap weighs the same in the fit, on any
 *  dilution series. (CurveCurator's own `build_interpolation_points` keeps halving gaps wider than
 *  half a 10/3-fold step instead: 0, 1 or 3 points a gap depending on the series.) */
export function interpolationGrid(doseX: number[]): number[] {
  const x = [...new Set(doseX.filter(Number.isFinite))].sort((a, b) => a - b)
  const mid = x.slice(1).map((v, i) => (x[i] + v) / 2)
  return [...x, ...mid].sort((a, b) => a - b)
}

/** The fit's points with CurveCurator's interpolation: the real ones (control first) plus the
 *  grid's (interpolatedPoints). */
function withInterpolation(
  xs: number[],
  ys: number[],
  pts: Array<[number, number]>,
  grid: number[]
): { x: number[]; y: number[] } {
  const extra = interpolatedPoints(
    pts.map((p) => p[0]),
    pts.map((p) => p[1]),
    grid
  )
  return { x: [...xs, ...extra.x], y: [...ys, ...extra.y] }
}

/** CurveCurator's interpolation points for one line of measurements (x along one axis, y the
 *  responses): every grid point within the measured x, its y read off the straight line between
 *  the measured values either side (replicates at an x averaged). Fit-only helpers — added to a
 *  fit's points, never to what it is scored on. Empty with fewer than two measured x. */
export function interpolatedPoints(
  px: number[],
  py: number[],
  grid: number[]
): { x: number[]; y: number[] } {
  const byX = new Map<number, number[]>()
  px.forEach((x, i) => {
    if (!Number.isFinite(x) || !Number.isFinite(py[i])) return
    const a = byX.get(x)
    if (a) a.push(py[i])
    else byX.set(x, [py[i]])
  })
  const ux = [...byX.keys()].sort((a, b) => a - b)
  if (ux.length < 2) return { x: [], y: [] }
  const uy = ux.map((x) => mean(byX.get(x)!))
  const at = (v: number): number => {
    let k = 0
    while (k < ux.length - 2 && ux[k + 1] < v) k++
    return uy[k] + ((uy[k + 1] - uy[k]) * (v - ux[k])) / (ux[k + 1] - ux[k])
  }
  const inside = grid.filter((v) => v >= ux[0] && v <= ux[ux.length - 1])
  return { x: inside, y: inside.map(at) }
}

// ── CurveCurator's significance: the relevance score (thresholding.py) ───────────────────────

/** The F(dfn, dfd) quantile at probability p, shifted by `loc` — scipy's `f.ppf(p, dfn, dfd,
 *  loc)` — by bisection on the survival function. */
export function fQuantile(p: number, dfn: number, dfd: number, loc = 0): number {
  return fInverseSurvival(1 - p, dfn, dfd, loc)
}

/** The F value with upper-tail probability `tail` (scipy's `f.isf`) — exact for tiny tails,
 *  where 1 − p would round away. */
export function fInverseSurvival(tail: number, dfn: number, dfd: number, loc = 0): number {
  if (!(tail > 0 && tail < 1) || !(dfn > 0) || !(dfd > 0)) return NaN
  let lo = 0
  let hi = 1
  while (fSurvival(hi, dfn, dfd) > tail && hi < 1e12) hi *= 2
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (fSurvival(mid, dfn, dfd) > tail) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2 + loc
}

/** The F a CurveCurator curve of `n` points would need for raw p `p` — on that scale another test
 *  (a 4PL surface's adjusted F) runs through CurveCurator's relevance score and decoy FDR as is. */
export function ccEquivalentF(p: number, n: number): number {
  if (!(p < 1)) return 0
  const { dfn, dfd } = curveDofs(n)
  return fInverseSurvival(Math.max(p, 1e-300), dfn, dfd, F_LOC)
}

/** CurveCurator's SAM fudge factor for a fold-change limit and alpha: s0 = FC_lim / √F⁻¹(1 − α)
 *  (`get_s0`, one-sided, called without a loc). */
function samS0(fcLim: number, alpha: number, dfn: number, dfd: number): number {
  const key = `${fcLim}|${alpha}|${dfn}|${dfd}`
  let s0 = s0Cache.get(key)
  if (s0 === undefined) {
    const q = fQuantile(1 - alpha, dfn, dfd)
    s0 = q > 0 ? Math.abs(fcLim) / Math.sqrt(q) : 0
    if (s0Cache.size > 10_000) s0Cache.clear()
    s0Cache.set(key, s0)
  }
  return s0
}
/** s0 per (limit, α, degrees of freedom) — the same few values for every curve, each a 200-step
 *  search, so computed once. */
const s0Cache = new Map<string, number>()

/**
 * CurveCurator's relevance score for one curve: its F statistic shrunk by its fold change,
 * 1/√F_adj = 1/√F + s0/|FC| (`sam_correction`), then −log₁₀ of F_adj's p-value on the same
 * recalibrated distribution. `fcLim` and `alpha` are the two asymptotes (s0 follows from them);
 * `n` is the curve's point count (control included), which sets its degrees of freedom.
 */
export function relevanceScore(
  log2FC: number,
  f: number,
  n: number,
  fcLim: number,
  alpha: number
): number {
  if (!Number.isFinite(log2FC) || !Number.isFinite(f) || n <= 4) return NaN
  const { dfn, dfd } = curveDofs(n)
  const s0 = samS0(fcLim, alpha, dfn, dfd)
  const fAdj = 1 / (1 / Math.sqrt(f) + s0 / Math.abs(log2FC)) ** 2
  return -Math.log10(Math.max(fSurvival(fAdj, dfn, dfd, F_LOC), 1e-300))
}

/** CurveCurator's call (`define_regulated_curves`): relevance score ≥ −log₁₀ α AND |FC| ≥ FC_lim. */
export function curveCuratorSignificant(
  log2FC: number,
  f: number,
  n: number,
  fcLim: number,
  alpha: number
): boolean {
  return (
    Math.abs(log2FC) >= fcLim && relevanceScore(log2FC, f, n, fcLim, alpha) >= -Math.log10(alpha)
  )
}

/** The decision boundary on a volcano (−log₁₀ raw p against log₂FC) for curves of `n` points:
 *  the p a curve at |FC| needs to be called. Infinity inside the fold-change wall. The relevance
 *  cutoff is −log₁₀ α unless `cutoff` sets another (calling by FDR); α still shapes it (s0). */
export function curveCuratorBoundary(
  absFC: number,
  n: number,
  fcLim: number,
  alpha: number,
  cutoff = -Math.log10(alpha)
): number {
  if (absFC < fcLim || n <= 4) return Infinity
  const { dfn, dfd } = curveDofs(n)
  const s0 = samS0(fcLim, alpha, dfn, dfd)
  const qL = fInverseSurvival(10 ** -cutoff, dfn, dfd, F_LOC) // F_adj at the relevance cutoff
  const inv = 1 / Math.sqrt(qL) - s0 / absFC // 1/√F the curve itself needs
  if (!(inv > 0)) return Infinity
  return -Math.log10(Math.max(fSurvival(1 / inv ** 2, dfn, dfd, F_LOC), 1e-300))
}

/** The smallest |curve log₂FC| CurveCurator's relevance score can call at `alpha` for a curve of
 *  `n` points — the volcano boundary's vertical wall (curveCuratorBoundary is infinite inside
 *  it): the fold-change limit, or further out where the cutoff's own F needs more. */
export function curveCuratorWall(
  n: number,
  fcLim: number,
  alpha: number,
  cutoff = -Math.log10(alpha)
): number {
  if (n <= 4) return Infinity
  const { dfn, dfd } = curveDofs(n)
  const s0 = samS0(fcLim, alpha, dfn, dfd)
  const qL = fInverseSurvival(10 ** -cutoff, dfn, dfd, F_LOC)
  return Math.max(fcLim, s0 * Math.sqrt(qL))
}

/** A result row's significance call under `t`: CurveCurator's relevance score from the row's
 *  curve when that's the threshold type, otherwise the usual cutoff on its p or q. */
export function classifyCompareRow(
  r: {
    log2FC: number | null
    pP: number | null
    pQ: number | null
    curve?: CcTest
    rs?: { cc?: CcTest }
  },
  t: ThresholdConfig
): ThresholdCall {
  const call = classifyCall(r, t)
  return r.curve ? { ...call, model: curveModel(r, t) } : call
}

/** The per-row test CurveCurator's relevance score and target–decoy FDR run on: its F, its point
 *  count n (which sets the F's recalibrated distribution), its decoy q and — called by FDR — the
 *  α its group settled on. */
export interface CcTest {
  f: number
  n: number
  q?: number
  ccAlpha?: number
}

/** A row's CurveCurator test: a 4PL curve's, or a 4PL surface's (`rs.cc` — see scoreJoint4pl). */
export const ccTestOf = (r: { curve?: CcTest; rs?: { cc?: CcTest } }): CcTest | undefined =>
  r.curve ?? r.rs?.cc

/** A curve's final model: the 4PL when its F-test (the row's raw p, `pP` = −log₁₀ p) rejects the
 *  flat null at the threshold's α — 10^−statMin, or under CurveCurator called by FDR the α its
 *  comparison settled on — else M0. Independent of the fold-change limit and the call itself: a
 *  curve can be real (4PL) yet called none for a small fold change. */
export function curveModel(
  r: { pP: number | null; curve?: { ccAlpha?: number } },
  t: ThresholdConfig
): '4PL' | 'M0' {
  const alpha =
    (t.type === 'curvecurator' && t.ccCallBy === 'fdr' ? r.curve?.ccAlpha : undefined) ??
    10 ** -t.statMin
  return r.pP != null && Number.isFinite(r.pP) && r.pP >= -Math.log10(alpha) ? '4PL' : 'M0'
}

function classifyCall(
  r: Parameters<typeof classifyCompareRow>[0],
  t: ThresholdConfig
): ThresholdCall {
  const fc = r.log2FC ?? NaN
  // SAM: called when its permutation q-value (pQ) is within the FDR.
  if (t.type === 'sam_fdr') {
    const signf = Number.isFinite(fc) && (r.pQ ?? -Infinity) >= t.statMin
    return { signf, effect: signf ? (fc > 0 ? 'up' : fc < 0 ? 'down' : 'none') : 'none' }
  }
  if (t.type === 'curvecurator') {
    const lim = fc < 0 ? -t.fcLow : t.fcHigh
    // By α: the relevance score's own cutoff. By FDR: the same, at the α its comparison settled on
    // for the target (applyCurveFdr) — none until that's been worked out (no decoys, no FDR).
    const cc = ccTestOf(r)
    const a = t.ccCallBy === 'fdr' ? cc?.ccAlpha : Math.pow(10, -t.statMin)
    const signf = !!cc && a != null && curveCuratorSignificant(fc, cc.f, cc.n, lim, a)
    return { signf, effect: signf ? (fc > 0 ? 'up' : 'down') : 'none' }
  }
  const stat = t.statType === 'pP' ? r.pP : r.pQ
  return applyThreshold(fc, stat ?? NaN, t)
}

/** The keys curveMetrics returns, in table order. */
export const CURVE_METRICS = [
  'pEC50',
  'EC50',
  'slope',
  'front',
  'back',
  'R2',
  'RMSE',
  'points',
  'F',
  'F_lof',
  'pP_lof',
  'relevance',
  'q_decoy'
] as const

/**
 * A fitted curve's metrics as CurveCurator's results table lists them, for tables and exports:
 * potency (EC50 in the dose's units; pEC50 = −log₁₀ of it in molar, given the unit's scale), the slope and plateaus (ratios to the
 * control), the fit's quality (R², RMSE, points incl. the control, the lack-of-fit test's F and
 * −log₁₀ p), the F statistic, and — under
 * CurveCurator's threshold — the relevance score (at the threshold's fold-change limit on the
 * curve's side, and its α: the one the comparison settled on when called by a target FDR) and the
 * target–decoy q.
 */
export function curveMetrics(
  log2FC: number | null | undefined,
  c: Omit<CurveFit, 'log2FC' | 'pVal'> & {
    ccAlpha?: number
    q?: number
    x?: number[]
    y?: number[]
    described?: false
  },
  t: ThresholdConfig | undefined,
  /** the dose unit's size in molar (1e-9 for nM), so pEC50 is molar; 1 = in the dose's own units */
  doseScale = 1
): Record<(typeof CURVE_METRICS)[number], number | undefined> {
  let relevance: number | undefined
  if (t?.type === 'curvecurator' && log2FC != null && Number.isFinite(log2FC)) {
    const a = t.ccCallBy === 'fdr' ? c.ccAlpha : 10 ** -t.statMin
    const lim = log2FC < 0 ? -t.fcLow : t.fcHigh
    if (a != null) relevance = relevanceScore(log2FC, c.f, c.n, lim, a)
  }
  // Kept with newer fits; an older one's from its kept points (the control: ratio 1 at −∞, where
  // the curve sits on its front plateau).
  let rmse = c.rmse
  if (rmse == null && c.x && c.y) {
    let ss = (1 - c.front) ** 2
    for (let i = 0; i < c.x.length; i++) ss += (c.y[i] - logistic(c.x[i], c)) ** 2
    rmse = Math.sqrt(ss / (c.x.length + 1))
  }
  // Kept with newer fits; an older one's from its kept points.
  const lof =
    c.lofF != null && c.lofP != null
      ? { f: c.lofF, p: c.lofP }
      : c.x && c.y
        ? curveLackOfFit(c.x, c.y, c)
        : undefined
  // an undescribed curve (responders only, not one of them): its test, without its description
  const d = curveDescribed(c)
  return {
    pEC50: d ? c.pec50 - Math.log10(doseScale) : undefined,
    EC50: d ? 10 ** -c.pec50 : undefined,
    slope: d ? c.slope : undefined,
    front: d ? c.front : undefined,
    back: d ? c.back : undefined,
    R2: c.r2,
    RMSE: rmse,
    points: c.n,
    F: c.f,
    F_lof: lof?.f,
    pP_lof: lof ? -Math.log10(Math.max(lof.p, 1e-300)) : undefined,
    relevance,
    q_decoy: c.q
  }
}

/** One sample's fit residuals across a set of curves (see curveResidualMad). */
export interface DoseMad {
  /** log₁₀ dose; null = the control */
  x: number | null
  /** the sample's replicate at that dose (null = none given, or the dose's replicates pooled) */
  rep: number | null
  /** median |ratio − fitted ratio| over every curve's point from this sample */
  mad: number
  /** the signed residuals' (ratio − fitted ratio) median and quartiles — the sample's bias, and
   *  its spread either side */
  median: number
  q1: number
  q3: number
  /** every signed residual of the sample, and the curve (its `id`) each is from */
  residuals: number[]
  ids: Array<string | undefined>
  /** each residual's replicate (differing only when the replicates are pooled) */
  reps: Array<number | null>
  /** how many points that median is over */
  n: number
}

/**
 * CurveCurator's MAD analysis (quality_control.mad_analysis): for each experiment — a sample, i.e.
 * a dose and replicate — the median absolute residual of its ratios from their own curve's fit,
 * across every curve; on the linear ratio scale and not centred (CurveCurator's exact
 * definition). The control's samples count too: each one's ratio to the control mean against the
 * fit's front plateau (a result without them: the control as one point, ratio 1). A sample
 * standing well above the rest is one where many curves miss their points — an injection,
 * normalisation or sample problem. Curves without their kept points are skipped.
 */
export function curveResidualMad(
  curves: Array<
    LogisticParams & {
      x?: number[]
      y?: number[]
      rep?: Array<number | null>
      cy?: number[]
      crep?: Array<number | null>
      /** the curve's own key (e.g. its gene), carried onto its residuals */
      id?: string
    }
  >,
  /** each dose's replicates pooled into one group (rep null) rather than one per sample */
  pool = false
): DoseMad[] {
  const groups = new Map<
    string,
    {
      x: number | null
      rep: number | null
      v: number[]
      ids: Array<string | undefined>
      reps: Array<number | null>
    }
  >()
  const add = (x: number | null, rep: number | null, r: number, id?: string): void => {
    if (!Number.isFinite(r)) return
    const k = pool ? `${x}` : `${x}|${rep}`
    let g = groups.get(k)
    if (!g) groups.set(k, (g = { x, rep: pool ? null : rep, v: [], ids: [], reps: [] }))
    g.v.push(r)
    g.ids.push(id)
    g.reps.push(rep)
  }
  for (const c of curves) {
    if (!c.x || !c.y) continue
    if (c.cy) c.cy.forEach((y, i) => add(null, c.crep?.[i] ?? null, y - c.front, c.id))
    else add(null, null, 1 - c.front, c.id)
    for (let i = 0; i < c.x.length; i++)
      add(c.x[i], c.rep?.[i] ?? null, c.y[i] - logistic(c.x[i], c), c.id)
  }
  const order = (a: number | null, b: number | null): number =>
    a === b ? 0 : a == null ? -1 : b == null ? 1 : a - b
  return [...groups.values()]
    .sort((a, b) => order(a.x, b.x) || order(a.rep, b.rep))
    .map((g) => {
      const v = [...g.v].sort((a, b) => a - b)
      return {
        x: g.x,
        rep: g.rep,
        mad: median(v.map(Math.abs)),
        median: quantile(v, 0.5),
        q1: quantile(v, 0.25),
        q3: quantile(v, 0.75),
        n: v.length,
        residuals: g.v,
        ids: g.ids,
        reps: g.reps
      }
    })
}

/** Whether a residual check by sample (dose × replicate) can differ from by dose: some curve with
 *  two numbered replicates at one dose, or two in its control. Curves without their kept points
 *  can't say (they're rebuilt with their replicates when drawn), so with none kept: true. */
export function curvesReplicated(
  rows: ReadonlyArray<{
    curve?: { x?: number[]; rep?: Array<number | null>; cy?: number[]; crep?: Array<number | null> }
  }>
): boolean {
  const kept = rows.filter((r) => r.curve?.x)
  if (!kept.length) return true
  // more distinct (dose, replicate) pairs than doses: a dose holds several replicates
  const several = (xs: Array<number | null>, reps: Array<number | null> | undefined): boolean =>
    new Set(xs.map((x, i) => `${x}|${reps?.[i] ?? ''}`)).size > new Set(xs).size
  return kept.some(
    (r) =>
      several(r.curve!.x!, r.curve!.rep) ||
      several(
        (r.curve!.cy ?? []).map(() => null),
        r.curve!.crep
      )
  )
}

/** One residual of a curve's fit, with what the residual checks plot it against. */
export interface ResidualPoint {
  /** the fitted ratio at this point (the front plateau for a control sample) */
  fitted: number
  /** ratio − fitted ratio */
  residual: number
  /** the residual over its curve's residual standard deviation (√(SS / (n − 4)) over its n dosed
   *  points — the four parameters' degrees of freedom) */
  std: number
  /** log₁₀ dose (null = a control sample) and replicate */
  x: number | null
  rep: number | null
  /** the curve's own key (e.g. its gene) */
  id?: string
}

/** Every residual of every curve's fit, flat — for the checks curveResidualMad's per-dose view
 *  can't make: against the fitted value (does the error grow with the signal — the constant-
 *  variance assumption the F-test makes) and their distribution (normal, as the F-test also
 *  assumes). Residuals as curveResidualMad's: the linear ratio scale, the control's samples
 *  against the front plateau. Curves without their kept points are skipped, and so are curves of
 *  four or fewer dosed points (fitted exactly — no residual information). */
export function curveResidualPoints(
  curves: Array<
    LogisticParams & {
      x?: number[]
      y?: number[]
      rep?: Array<number | null>
      cy?: number[]
      crep?: Array<number | null>
      id?: string
    }
  >
): ResidualPoint[] {
  const out: ResidualPoint[] = []
  for (const c of curves) {
    if (!c.x || !c.y) continue
    // Four parameters through four (or fewer) dosed points fit them exactly: residuals of 0 that
    // say nothing about the noise, and would pile on the zero line — such curves are left out.
    const nFit = c.y.filter(Number.isFinite).length
    if (nFit <= 4) continue
    const pts: Omit<ResidualPoint, 'std'>[] = []
    c.cy?.forEach((y, i) =>
      pts.push({
        fitted: c.front,
        residual: y - c.front,
        x: null,
        rep: c.crep?.[i] ?? null,
        id: c.id
      })
    )
    for (let i = 0; i < c.x.length; i++) {
      const f = logistic(c.x[i], c)
      pts.push({ fitted: f, residual: c.y[i] - f, x: c.x[i], rep: c.rep?.[i] ?? null, id: c.id })
    }
    const ok = pts.filter((q) => Number.isFinite(q.residual) && Number.isFinite(q.fitted))
    // The residual SD from the points the curve was fitted to (the dosed ones), on their degrees
    // of freedom; the control's residuals are standardised by it too.
    const dosed = ok.filter((q) => q.x != null)
    const dof = dosed.length - 4
    const sd = dof > 0 ? Math.sqrt(dosed.reduce((s, q) => s + q.residual ** 2, 0) / dof) : NaN
    for (const q of ok) out.push({ ...q, std: sd > 0 ? q.residual / sd : NaN })
  }
  return out
}

// ── CurveCurator's target–decoy FDR (data_simulator.py, thresholding.calculate_qvalue) ───────

/** A decoy curve's fit, as far as the relevance score needs it. */
export interface DecoyCurve {
  f: number
  log2FC: number
  n: number
}

/** One real curve's points and fit, for estimating the noise its decoys get. */
export interface TargetCurve {
  /** treated log₁₀ doses and their ratios to the control (control not included) */
  doseX: number[]
  ratios: number[]
  fit: CurveFit
}

/** A real curve's noise: √(SSE / recalibrated dfd) over its points, the control's included
 *  (CurveCurator's `estimate_noise_distribution`). */
function curveNoise(t: TargetCurve): number {
  let sse = 1 - logistic(-Infinity, t.fit)
  sse *= sse
  t.doseX.forEach((x, i) => {
    if (Number.isFinite(x) && Number.isFinite(t.ratios[i]))
      sse += (t.ratios[i] - logistic(x, t.fit)) ** 2
  })
  return Math.sqrt(sse / curveDofs(t.fit.n).dfd)
}

/** The q-th quantile (linear interpolation, numpy's default). */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/**
 * Decoys for one group of curves — CurveCurator's `simulate_decoys`, one per real curve. Each takes
 * a noise level drawn from the real curves' (trimmed to their 1–99% range), raw values ~N(1, noise)
 * at every treated point (`doseX`, the group's dose layout) and at each of `nControls` control
 * samples (their mean is the ratio's denominator, as for the real curves), redrawn while its spread
 * falls below the noise floor, clipped to [1/1000, 1000]. Then fitted exactly as the real curves.
 */
export function simulateDecoys(
  targets: TargetCurve[],
  doseX: number[],
  nControls: number,
  seed: number
): DecoyCurve[] {
  return decoyFits(decoyInputs(targets, doseX, nControls, seed).map((c) => fitCurve(c.x, c.y)))
}

/** The decoys from their fits (decoyInputs' curves, fitted in order; null = no fit). */
export function decoyFits(fits: Array<CurveFit | null>): DecoyCurve[] {
  const out: DecoyCurve[] = []
  for (const fit of fits) if (fit) out.push({ f: fit.f, log2FC: fit.log2FC, n: fit.n })
  return out
}

/** simulateDecoys' random curves before fitting: one per target, each its treated points' log₁₀
 *  doses and ratios — drawn in order from the one seeded stream, so the fitting (the slow part)
 *  can be shared out (engine/pool) and still give exactly the same decoys. */
export function decoyInputs(
  targets: TargetCurve[],
  doseX: number[],
  nControls: number,
  seed: number
): Array<{ x: number[]; y: number[] }> {
  const noise = targets
    .map(curveNoise)
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b)
  if (noise.length === 0 || doseX.length === 0) return []
  const lo = quantile(noise, 0.01) / 1.1
  const hi = quantile(noise, 0.99) * 1.1
  const pool = noise.filter((v) => v >= lo && v <= hi)
  const rand = rng(seed)
  const normal = (): number => {
    const u = 1 - rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
  const clip = (v: number): number => Math.min(1000, Math.max(1 / 1000, v))
  const nCtrl = Math.max(1, nControls)
  const out: Array<{ x: number[]; y: number[] }> = []
  for (let k = 0; k < targets.length; k++) {
    let sd = pool[Math.floor(rand() * pool.length)]
    let raw: number[]
    for (;;) {
      raw = Array.from({ length: doseX.length + nCtrl }, () => 1 + sd * normal())
      const m = raw.reduce((a, b) => a + b, 0) / raw.length
      const spread = Math.sqrt(raw.reduce((a, b) => a + (b - m) ** 2, 0) / raw.length)
      if (spread > lo) break
      sd *= 1.01 // CurveCurator's guarantee that the loop ends
    }
    raw = raw.map(clip)
    const ctrl = raw.slice(doseX.length).reduce((a, b) => a + b, 0) / nCtrl
    out.push({ x: doseX, y: raw.slice(0, doseX.length).map((v) => v / ctrl) })
  }
  return out
}

/**
 * Target–decoy q-values on the relevance score (CurveCurator's `calculate_qvalue`): real and decoy
 * curves ranked together by score, a decoy ahead of a real curve on a tie; at each rank
 * q = (decoys + 1)/(targets + 1), made monotone from the bottom up, scaled by targets/decoys. The
 * score uses the threshold's fold-change limits (up `fcUp`, down `fcDown`) and alpha. Returns q
 * per target (NaN when it has no score), and for the FDR of the α cutoff's calls (`get_fdr`): the
 * decoys that cutoff would call, and the targets/decoys ratio.
 */
export function curveCuratorFdr(
  targets: Array<DecoyCurve | undefined>,
  decoys: DecoyCurve[],
  fcUp: number,
  fcDown: number,
  alpha: number
): { q: number[]; decoyCalled: number; ratio: number } {
  const score = (c: DecoyCurve): number =>
    relevanceScore(c.log2FC, c.f, c.n, c.log2FC < 0 ? fcDown : fcUp, alpha)
  const items: Array<{ s: number; decoy: boolean; i: number }> = []
  targets.forEach((c, i) => {
    const s = c ? score(c) : NaN
    if (Number.isFinite(s)) items.push({ s, decoy: false, i })
  })
  const decoyScores = decoys.map(score)
  for (const s of decoyScores) if (Number.isFinite(s)) items.push({ s, decoy: true, i: -1 })
  const nT = items.filter((x) => !x.decoy).length
  const nD = items.length - nT
  const q = new Array<number>(targets.length).fill(NaN)
  if (nT === 0 || nD === 0) return { q, decoyCalled: 0, ratio: NaN }
  const ratio = nT / nD
  items.sort((a, b) => b.s - a.s || Number(b.decoy) - Number(a.decoy))
  const raw = new Array<number>(items.length)
  let d = 0
  let t = 0
  items.forEach((x, k) => {
    if (x.decoy) d++
    else t++
    raw[k] = ((d + 1) / (t + 1)) * ratio
  })
  let runMin = Infinity
  for (let k = items.length - 1; k >= 0; k--) {
    runMin = Math.min(runMin, raw[k])
    if (!items[k].decoy) q[items[k].i] = Math.min(1, runMin)
  }
  const cut = -Math.log10(alpha)
  const decoyCalled = decoys.filter(
    (c, k) => decoyScores[k] >= cut && Math.abs(c.log2FC) >= (c.log2FC < 0 ? fcDown : fcUp)
  ).length
  return { q, decoyCalled, ratio }
}

/** The comparison group a curve-fit row belongs to (its comparison and context) — the unit its
 *  decoys were simulated for. */
export const curveGroupKey = (r: {
  comparison: string
  cell?: string
  cmpd: string
  dose: number | null
  time: number | null
  extra?: Record<string, string>
}): string =>
  [r.comparison, r.cell ?? '', r.cmpd, r.dose, r.time, JSON.stringify(r.extra ?? {})].join('|')

/**
 * Re-derive a curve fit's target–decoy q-values (`curve.q`) and the estimated FDR of its calls for
 * `t` — they depend on its alpha and fold-change limits. Only for CurveCurator's threshold; under
 * any other the rows come back as they are. Calls are made from these rows (by FDR they need the
 * q), so classify after this. Called by α, the FDR pools every group's decoys and calls; called by
 * FDR, it's the highest q among the calls (within the target by construction).
 */
export function applyCurveFdr<
  R extends {
    comparison: string
    cmpd: string
    dose: number | null
    time: number | null
    cell?: string
    extra?: Record<string, string>
    log2FC: number | null
    pP: number | null
    pQ: number | null
    curve?: CcTest
    rs?: { cc?: CcTest }
  }
>(
  rows: R[],
  decoys: Record<string, DecoyCurve[]> | undefined,
  t: ThresholdConfig
): { rows: R[]; fdr?: number; alphas?: Record<string, number> } {
  if (t.type !== 'curvecurator' || !decoys) return { rows }
  const alpha = Math.pow(10, -t.statMin)
  const groups = new Map<string, number[]>()
  rows.forEach((r, i) => {
    const k = curveGroupKey(r)
    const g = groups.get(k)
    if (g) g.push(i)
    else groups.set(k, [i])
  })
  const out = [...rows]
  let decoyCalled = 0
  const alphas: Record<string, number> = {}
  const byFdr = t.ccCallBy === 'fdr'
  const qMax = Math.pow(10, -(t.ccQMin ?? CC_Q_MIN))
  for (const [k, idx] of groups) {
    const ds = decoys[k]
    if (!ds?.length) continue
    const targets = idx.map((i) => {
      const r = rows[i]
      const cc = ccTestOf(r)
      return cc && r.log2FC != null ? { f: cc.f, log2FC: r.log2FC, n: cc.n } : undefined
    })
    let a = alpha
    let res = curveCuratorFdr(targets, ds, t.fcHigh, -t.fcLow, a)
    if (byFdr) {
      // Called by FDR, the score's curvature follows the cutoff the FDR settles on — as CurveCurator
      // sets it from α — so the hyperbola's wall stays on the fold-change limit: the effective α is
      // the lowest call's score, which reshapes the score (s0), which re-ranks… until it settles.
      for (let iter = 0; iter < 20; iter++) {
        let cut = Infinity
        targets.forEach((c, j) => {
          if (!c || !(res.q[j] <= qMax)) return
          const lim = c.log2FC < 0 ? -t.fcLow : t.fcHigh
          if (Math.abs(c.log2FC) < lim) return
          cut = Math.min(cut, relevanceScore(c.log2FC, c.f, c.n, lim, a))
        })
        if (!Number.isFinite(cut)) break // nothing within the target: keep α's shape
        const next = Math.min(0.999, Math.pow(10, -cut))
        if (Math.abs(Math.log10(next) - Math.log10(a)) < 1e-4) break
        a = next
        res = curveCuratorFdr(targets, ds, t.fcHigh, -t.fcLow, a)
      }
      // The calls are then exactly the boundary's — relevance ≥ −log₁₀ a and |FC| ≥ the limit — so
      // the line and the colours always agree. Where the ranking hasn't quite settled, step a down
      // until the highest q among those calls is within the target.
      const worstQ = (): number => {
        let m = -Infinity
        targets.forEach((c, j) => {
          if (!c) return
          const lim = c.log2FC < 0 ? -t.fcLow : t.fcHigh
          if (curveCuratorSignificant(c.log2FC, c.f, c.n, lim, a)) m = Math.max(m, res.q[j])
        })
        return m
      }
      for (let guard = 0; guard < 60 && worstQ() > qMax; guard++) {
        a *= 0.9
        res = curveCuratorFdr(targets, ds, t.fcHigh, -t.fcLow, a)
      }
      alphas[k] = a
    }
    // Called by FDR, each curve carries its group's settled α: its call is CurveCurator's at that α.
    idx.forEach((i, j) => {
      const r = rows[i]
      const set = { q: res.q[j], ...(byFdr ? { ccAlpha: a } : { ccAlpha: undefined }) }
      if (r.curve) out[i] = { ...r, curve: { ...r.curve, ...set } }
      else if (r.rs?.cc) out[i] = { ...r, rs: { ...r.rs, cc: { ...r.rs.cc, ...set } } }
    })
    if (Number.isFinite(res.ratio)) decoyCalled += res.decoyCalled * res.ratio
  }
  const calls = out.filter((r) => classifyCompareRow(r, t).signf)
  // By FDR with nothing within the target there's no FDR to report (NaN), not a 0%.
  if (byFdr)
    return {
      rows: out,
      fdr: calls.length ? calls.reduce((m, r) => Math.max(m, ccTestOf(r)?.q ?? 0), 0) : NaN,
      alphas
    }
  return { rows: out, fdr: Math.min(1, (decoyCalled + 1) / (calls.length + 1)) }
}
