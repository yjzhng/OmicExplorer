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
const PEC50_DELTA = 2 // pEC50 may lie this many log₁₀ units beyond the tested doses
const SLOPE_LIMITS: [number, number] = [0.01, 10]
const Y_LIMITS: [number, number] = [1e-4, 1e6]
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
  const p = fromVec(v)
  let s = 0
  for (let i = 0; i < xs.length; i++) {
    const r = ys[i] - logistic(xs[i], p)
    s += r * r
  }
  return s
}

export interface Bounds {
  lo: Vec
  hi: Vec
}
/** CurveCurator's `set_boundaries`: pEC50 within the tested doses ± PEC50_DELTA (from the treated
 *  doses only — the control's −∞ is not a dose), slope and plateaus within the global limits. */
export function boundsFor(doseX: number[]): Bounds {
  let lo = Infinity
  let hi = -Infinity
  for (const x of doseX) {
    lo = Math.min(lo, -x)
    hi = Math.max(hi, -x)
  }
  return {
    lo: [lo - PEC50_DELTA, SLOPE_LIMITS[0], Y_LIMITS[0], Y_LIMITS[0]],
    hi: [hi + PEC50_DELTA, SLOPE_LIMITS[1], Y_LIMITS[1], Y_LIMITS[1]]
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
 *  only (the rest of d stays 0). Null when singular. */
function solve(A: number[][], g: number[], free: number[]): Vec | null {
  const m = free.length
  const M = free.map((i) => [...free.map((j) => A[i][j]), g[i]])
  for (let c = 0; c < m; c++) {
    let piv = c
    for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    if (!(Math.abs(M[piv][c]) > 1e-300)) return null
    ;[M[c], M[piv]] = [M[piv], M[c]]
    for (let r = c + 1; r < m; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= m; k++) M[r][k] -= f * M[c][k]
    }
  }
  const d: Vec = [0, 0, 0, 0]
  for (let r = m - 1; r >= 0; r--) {
    let s = M[r][m]
    for (let k = r + 1; k < m; k++) s -= M[r][k] * d[free[k]]
    d[free[r]] = s / M[r][r]
  }
  return d
}

/** Bounded Levenberg–Marquardt least squares from `start`. A parameter pinned at a bound with the
 *  gradient pushing it further out is held there for the step (a simple active set), so the rest
 *  can still move. Returns the refined parameters and their SSE. */
function refine(xs: number[], ys: number[], start: Vec, b: Bounds): { v: Vec; cost: number } {
  let v = clampVec(start, b)
  let cost = sse(xs, ys, v)
  let lambda = 1e-3
  for (let iter = 0; iter < 200 && cost > 0; iter++) {
    // Normal equations: A = JᵀJ, g = Jᵀr (r = y − f).
    const A = [0, 1, 2, 3].map(() => [0, 0, 0, 0])
    const g = [0, 0, 0, 0]
    const p = fromVec(v)
    for (let i = 0; i < xs.length; i++) {
      const J = gradient(xs[i], v)
      const r = ys[i] - logistic(xs[i], p)
      for (let a = 0; a < 4; a++) {
        g[a] += J[a] * r
        for (let c = 0; c < 4; c++) A[a][c] += J[a] * J[c]
      }
    }
    const atBound = (i: number): boolean =>
      (v[i] <= b.lo[i] && g[i] < 0) || (v[i] >= b.hi[i] && g[i] > 0)
    const free = [0, 1, 2, 3].filter((i) => !atBound(i))
    if (free.length === 0) break
    let improved = false
    while (lambda < 1e12) {
      const D = A.map((row, i) => row.map((x, j) => (i === j ? x + lambda * (x + 1e-9) : x)))
      const d = solve(D, g, free)
      if (d) {
        const next = clampVec(v.map((x, i) => x + d[i]) as Vec, b)
        const nextCost = sse(xs, ys, next)
        if (nextCost < cost) {
          const gain = cost - nextCost
          v = next
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
  return { v, cost }
}

/** CurveCurator's 'standard' OLS fit: the starting guess with the lowest SSE, refined from each
 *  of the three starting slopes; the lowest-SSE result wins. `doseX` sets the pEC50 bounds. */
export function fitLogistic(xs: number[], ys: number[], doseX: number[]): LogisticParams {
  const b = boundsFor(doseX)
  let best: Vec = startGuesses(xs, ys, b)[0]
  let bestCost = Infinity
  for (const guess of startGuesses(xs, ys, b)) {
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
export function fitCurve(doseX: number[], ratios: number[]): CurveFit | null {
  const pts: Array<[number, number]> = []
  for (let i = 0; i < doseX.length; i++)
    if (Number.isFinite(doseX[i]) && Number.isFinite(ratios[i])) pts.push([doseX[i], ratios[i]])
  pts.sort((a, b) => a[0] - b[0])
  const xs = [-Infinity, ...pts.map((p) => p[0])]
  const ys = [1, ...pts.map((p) => p[1])]
  const n = xs.length
  if (n <= 4) return null
  const dx = xs.slice(1)
  const p = fitLogistic(xs, ys, dx)
  const v = toVec(p)

  // Null model: the mean of every point (control included); both SSEs nudged as CurveCurator does
  // so a perfect fit doesn't divide by zero.
  const yMean = mean(ys)
  const sst = ys.reduce((s, y) => s + (y - yMean) ** 2, 0)
  const m0 = sst + 1e-20
  const m1 = sse(xs, ys, v) + 1e-20
  const k = 4
  const f = Math.max(0, ((m0 - m1) / m1) * (n / k))
  const { dfn, dfd } = curveDofs(n)
  const r2 = Math.max(0, 1 - (m1 - 1e-20 + 1e-10) / (sst + 1e-10))
  const xMin = dx[0]
  const xMax = dx[dx.length - 1]
  return {
    ...p,
    log2FC: Math.log2(logistic(xMax, p)) - Math.log2(logistic(xMin, p)),
    f,
    pVal: fSurvival(f, dfn, dfd, F_LOC),
    r2,
    rmse: Math.sqrt(Math.max(0, m1 - 1e-20) / n),
    n,
    xMin,
    xMax,
    m0: yMean,
    m0SE: Math.sqrt(sst / (n - 1) / n)
  }
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
    curve?: { f: number; n: number; q?: number; ccAlpha?: number }
  },
  t: ThresholdConfig
): ThresholdCall {
  const call = classifyCall(r, t)
  return r.curve ? { ...call, model: curveModel(r, t) } : call
}

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
    const a = t.ccCallBy === 'fdr' ? r.curve?.ccAlpha : Math.pow(10, -t.statMin)
    const signf =
      !!r.curve && a != null && curveCuratorSignificant(fc, r.curve.f, r.curve.n, lim, a)
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
  'relevance',
  'q_decoy'
] as const

/**
 * A fitted curve's metrics as CurveCurator's results table lists them, for tables and exports:
 * potency (EC50 in the dose's units; pEC50 = −log₁₀ of it in molar, given the unit's scale), the slope and plateaus (ratios to the
 * control), the fit's quality (R², RMSE, points incl. the control), the F statistic, and — under
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
  return {
    pEC50: c.pec50 - Math.log10(doseScale),
    EC50: 10 ** -c.pec50,
    slope: c.slope,
    front: c.front,
    back: c.back,
    R2: c.r2,
    RMSE: rmse,
    points: c.n,
    F: c.f,
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
  const out: DecoyCurve[] = []
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
    const fit = fitCurve(
      doseX,
      raw.slice(0, doseX.length).map((v) => v / ctrl)
    )
    if (fit) out.push({ f: fit.f, log2FC: fit.log2FC, n: fit.n })
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
    curve?: { f: number; n: number; q?: number; ccAlpha?: number }
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
      return r.curve && r.log2FC != null
        ? { f: r.curve.f, log2FC: r.log2FC, n: r.curve.n }
        : undefined
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
      if (r.curve)
        out[i] = {
          ...r,
          curve: { ...r.curve, q: res.q[j], ...(byFdr ? { ccAlpha: a } : { ccAlpha: undefined }) }
        }
    })
    if (Number.isFinite(res.ratio)) decoyCalled += res.decoyCalled * res.ratio
  }
  const calls = out.filter((r) => classifyCompareRow(r, t).signf)
  // By FDR with nothing within the target there's no FDR to report (NaN), not a 0%.
  if (byFdr)
    return {
      rows: out,
      fdr: calls.length ? calls.reduce((m, r) => Math.max(m, r.curve?.q ?? 0), 0) : NaN,
      alphas
    }
  return { rows: out, fdr: Math.min(1, (decoyCalled + 1) / (calls.length + 1)) }
}
