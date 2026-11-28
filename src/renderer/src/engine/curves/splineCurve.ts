/**
 * The spline detector's model for one curve (see splineFit.ts): the natural cubic spline basis,
 * one curve's fit against a flat line, and the variance moderation (limma's fitFDist, with an
 * abundance trend) its F-test is read under.
 */
import { type AxisMap, type AxisShape, DOSE_MODEL, TIME_MODEL } from './axisModel'
import type { ConditionKey } from '../types'
import type { SurfacePins } from './splineSurface'

// ── natural cubic spline basis ───────────────────────────────────────────────────────────────

/** Spline df (excluding the intercept) for a number of treated levels: 3–4 → 1 (a line),
 *  5 → 2, 6–7 → 3, 8+ → 4. Fewer than 3 treated levels → no fit. */
export function splineDf(treatedLevels: number): number | null {
  if (treatedLevels < 3) return null
  if (treatedLevels <= 4) return 1
  if (treatedLevels === 5) return 2
  if (treatedLevels <= 7) return 3
  return 4
}

/** Natural cubic spline design matrix (with intercept): one row per x, df + 1 columns. Knots at
 *  the boundary of the levels and at their quantiles (Hastie–Tibshirani truncated-power form).
 *  `levels` places the knots (default: the distinct xs) — pass the fit's own levels to evaluate a
 *  fitted spline elsewhere. */
export function nsBasis(xs: number[], df: number, levelsOf: number[] = xs): number[][] {
  const levels = [...new Set(levelsOf)].sort((a, b) => a - b)
  const lo = levels[0]
  const hi = levels[levels.length - 1]
  const span = hi - lo || 1
  const K = df + 1
  const knots: number[] = []
  for (let j = 0; j < K; j++) {
    const pos = (j / (K - 1)) * (levels.length - 1)
    const a = Math.floor(pos)
    const b = Math.min(levels.length - 1, a + 1)
    knots.push((levels[a] + (levels[b] - levels[a]) * (pos - a) - lo) / span)
  }
  const cube = (v: number): number => (v > 0 ? v * v * v : 0)
  const d = (u: number, k: number): number =>
    (cube(u - knots[k]) - cube(u - knots[K - 1])) / (knots[K - 1] - knots[k])
  return xs.map((x) => {
    const u = (x - lo) / span
    const row = [1, u]
    for (let k = 0; k < K - 2; k++) row.push(d(u, k) - d(u, K - 2))
    return row
  })
}

/** Least squares: coefficients of y on X (small, dense; tiny ridge for stability). */
export function lstsq(X: number[][], y: number[]): number[] | null {
  const p = X[0].length
  const A = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p + 1 }, (_, j) =>
      j < p
        ? X.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? 1e-10 : 0)
        : X.reduce((s, r, k) => s + r[i] * y[k], 0)
    )
  )
  for (let c = 0; c < p; c++) {
    let piv = c
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
    if (!(Math.abs(A[piv][c]) > 1e-14)) return null
    ;[A[c], A[piv]] = [A[piv], A[c]]
    for (let r = c + 1; r < p; r++) {
      const f = A[r][c] / A[c][c]
      for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k]
    }
  }
  const b = new Array<number>(p).fill(0)
  for (let r = p - 1; r >= 0; r--) {
    let s = A[r][p]
    for (let k = r + 1; k < p; k++) s -= A[r][k] * b[k]
    b[r] = s / A[r][r]
  }
  return b
}

// ── one curve ────────────────────────────────────────────────────────────────────────────────

export interface SplineCurve {
  /** level positions (baseline first) and level means relative to the baseline (baseline = 0) */
  x: number[]
  y: number[]
  fitted: number[]
  /** the F-test's numerator df: parameters beyond the flat line (baseline level + spline) */
  df: number
  /** residual sum of squares and its df */
  rss: number
  dfRes: number
  /** sum of squares the spline explains beyond the flat line */
  ssModel: number
  /** signed peak of the fitted curve relative to the fitted baseline, over the treated levels */
  peak: number
  /** mean log₂ abundance of the curve's values (for the variance trend) */
  abundance: number
  /** within-level replicate scatter: pooled sum of squares, its df, and the mean replicates per level */
  repSS: number
  repDf: number
  nPerLevel: number
  /** the fitted spline over the treated levels, sampled finely (one-axis curves; for drawing) */
  line?: { x: number[]; y: number[] }
  /** how x maps back to the axis (one-axis curves): the axis, its model and offset (axisModel.ts).
   *  Against one reference (dose) the baseline sits one step below the lowest level; against a
   *  matched control (time) at the level 0, e.g. log₁₀(t + offset) at t₀ */
  scale?: AxisMap & { axis: ConditionKey }
  /** a surface tested for response changes (runSliceShift): the response axis the curves run along,
   *  the axis they're compared across, and how the slices differ from the base slice */
  shift?: SliceShift
  /** two-axis surfaces: the layout behind y / fitted — the vehicle level per level of the second
   *  axis it was measured at first, then each treated cell (its vehicle group by index) — and the
   *  axes. `dose` / `time` name the two slots (the first axis's level, the second's), as on every
   *  surface before any pair could be fitted; `timeOffset` is the second axis's offset. */
  surface?: {
    /** the control's groups — one per reference (see surfaceFrame): its levels and mean */
    vehicle: Array<{ dose?: number; time: number; mean: number }>
    treated: Array<{ dose: number; time: number; group: number }>
    timeOffset: number
    /** the two axes as fitted (absent: dose × time, log₁₀ dose and log₁₀(t + offset), spline) */
    axes?: [SurfaceAxis, SurfaceAxis]
    /** the baseline's pins as fitted (surfaceFrame; absent on results fitted before) */
    pins?: SurfacePins
    /** both axes pinned — one position: one control group, every other cell against it */
    position?: boolean
    /** the samples that aren't cells, kept for drawing (not fitted): the vehicle's replicates at
     *  each of its levels (`vehicle`; at the first axis's base level), and treated samples at a
     *  baseline level (t₀ under a matched second axis, a first axis's level at or below its base)
     *  — each one's log₂ values as measured and its vehicle group (absent on results fitted before
     *  they were kept) */
    samples?: SurfaceSample[]
  }
}

/** A surface's control or baseline-level samples at one (first, second) level — see
 *  SplineCurve.surface.samples. */
export interface SurfaceSample {
  dose: number
  time: number
  group: number
  v: number[]
  vehicle?: true
}

/** One axis of a surface as fitted: its condition, how its levels map to x (axisModel.ts), and the
 *  detector's shape along it. */
export interface SurfaceAxis {
  axis: ConditionKey
  map: AxisMap
  detect: AxisShape
  /** its baseline's level: the lowest the vehicle sits at on it (a matched axis's first point) */
  base: number
}

/** How a surface's slices differ from its base slice (SplineCurve.shift): the largest consistent
 *  offset (drift, log₂), the largest departure beyond it (a change of shape — a stability change in
 *  TPP, log₂), and the share of the slices' difference that is consistent offset. */
export interface SliceShift {
  response: ConditionKey
  across: ConditionKey
  drift: number
  shape: number
  driftShare: number
  /** the cell carrying the peak (the largest departure): its first and second axes' levels — which
   *  curve shows it, along either axis; absent on results from before they were kept */
  peakA?: number
  peakB?: number
}

/** How a surface is described along each axis: the descriptor's shape ('none': that direction
 *  isn't described) and — the joint model — whether a 4PL's midpoint drifts along the other.
 *  Absent: 4PL along both, each coupled as its baseline gives (driftsByDefault — the dose × time
 *  preset: dose's drifting with time). */
export interface SurfaceDescribe {
  shapes: [AxisShape | 'none', AxisShape | 'none']
  coupled: [boolean, boolean]
}
/** A surface's x maps (its own axes, else dose × time's: log₁₀ dose, log₁₀(t + offset)). */
export function surfaceMaps(s: NonNullable<SplineCurve['surface']>): [AxisMap, AxisMap] {
  return s.axes
    ? [s.axes[0].map, s.axes[1].map]
    : [
        { ...DOSE_MODEL, offset: 0, step: 1 },
        { ...TIME_MODEL, offset: s.timeOffset, step: 1 }
      ]
}

/** One axis's columns of a surface's tensor-product detector at positions xs: the natural spline
 *  (df by its levels; null when too few), a line (the spline with 1 df) or a constant. */
export function axisBasis(shape: AxisShape, xs: number[]): number[][] | null {
  if (shape === 'constant') return xs.map(() => [1])
  if (shape === 'linear') return nsBasis(xs, 1)
  const df = splineDf(new Set(xs).size)
  return df == null ? null : nsBasis(xs, df)
}

/** Fit one curve: level positions x (baseline at index 0) and level means y (baseline = 0).
 *  The baseline level has its own parameter and the spline runs over the treated levels only, so a
 *  step from the baseline (a response already saturated at the lowest dose, or present from the
 *  first time point) is representable; the null is still one flat line through every level. */
export function fitSplineCurve(
  x: number[],
  y: number[],
  abundance: number,
  rep: { ss: number; df: number; nPerLevel: number } = { ss: 0, df: 0, nPerLevel: 1 },
  shape: AxisShape = 'spline'
): SplineCurve | null {
  // the detector's columns over the treated levels: the spline (its df by their number), or a line
  // (the spline with 1 df)
  const df = shape === 'linear' ? (x.length - 1 >= 2 ? 1 : null) : splineDf(x.length - 1)
  const p = df == null ? 0 : df + 2
  if (df == null || x.length - p < 1) return null
  const B = nsBasis(x.slice(1), df)
  const X = [[1, ...new Array<number>(df + 1).fill(0)], ...B.map((r) => [0, ...r])]
  const b = lstsq(X, y)
  if (!b) return null
  const fitted = X.map((r) => r.reduce((s, v, j) => s + v * b[j], 0))
  const mean = y.reduce((s, v) => s + v, 0) / y.length
  const rss = y.reduce((s, v, i) => s + (v - fitted[i]) ** 2, 0)
  const ssModel = fitted.reduce((s, v) => s + (v - mean) ** 2, 0)
  let peak = 0
  for (let i = 1; i < fitted.length; i++)
    if (Math.abs(fitted[i] - fitted[0]) > Math.abs(peak)) peak = fitted[i] - fitted[0]
  // The spline between the treated levels, for drawing (the baseline is its own point).
  const lo = x[1]
  const hi = x[x.length - 1]
  const gx = Array.from({ length: 41 }, (_, i) => lo + ((hi - lo) * i) / 40)
  const gy = nsBasis(gx, df, x.slice(1)).map((r) => r.reduce((a, v, j) => a + v * b[j + 1], 0))
  return {
    x,
    y,
    fitted,
    line: { x: gx, y: gy },
    df: p - 1,
    rss,
    dfRes: x.length - p,
    ssModel,
    peak,
    abundance,
    repSS: rep.ss,
    repDf: rep.df,
    nPerLevel: rep.nPerLevel
  }
}

// ── variance moderation (limma's fitFDist, with an abundance trend) ──────────────────────────

export function digamma(x: number): number {
  let r = 0
  while (x < 6) {
    r -= 1 / x
    x += 1
  }
  const f = 1 / (x * x)
  return (
    r +
    Math.log(x) -
    0.5 / x -
    f * (1 / 12 - f * (1 / 120 - f * (1 / 252 - f * (1 / 240 - f / 132))))
  )
}
export function trigamma(x: number): number {
  let r = 0
  while (x < 6) {
    r += 1 / (x * x)
    x += 1
  }
  const f = 1 / (x * x)
  return r + 1 / x + f / 2 + (f / x) * (1 / 6 - f * (1 / 30 - f * (1 / 42 - f / 30)))
}
/** ψ''(x), the tetragamma function. */
function tetragamma(x: number): number {
  let r = 0
  while (x < 6) {
    r -= 2 / (x * x * x)
    x += 1
  }
  const f = 1 / (x * x)
  return r - f * (1 + 1 / x + f * (0.5 - f * (1 / 6 - f * (1 / 6 - (3 / 10) * f))))
}
/** Inverse of trigamma (limma's trigammaInverse: Newton from 0.5 + 1/y). */
export function trigammaInverse(y: number): number {
  if (y > 1e7) return 1 / Math.sqrt(y)
  if (y < 1e-6) return 1 / y
  let x = 0.5 + 1 / y
  for (let i = 0; i < 50; i++) {
    const tri = trigamma(x)
    const dif = (tri * (1 - tri / y)) / tetragamma(x)
    x += dif
    if (-dif / x < 1e-8) break
  }
  return x
}

export interface Moderation {
  /** prior df (Infinity = every curve gets the prior variance) */
  d0: number
  /** prior variance as a function of abundance */
  s0sq: (abundance: number) => number
}

/** Fit the prior: log variances against abundance (10 quantile bins, linearly interpolated), and
 *  the prior df from their spread beyond what their own df explain. */
export function fitPrior(curves: Array<{ s2: number; d: number; abundance: number }>): Moderation {
  const ok = curves.filter((c) => c.s2 > 0 && c.d > 0 && Number.isFinite(c.abundance))
  if (ok.length < 3) return { d0: 0, s0sq: () => NaN }
  const e = ok.map((c) => Math.log(c.s2) - digamma(c.d / 2) + Math.log(c.d / 2))
  const order = ok.map((_, i) => i).sort((a, b) => ok[a].abundance - ok[b].abundance)
  const nb = Math.max(1, Math.min(10, Math.floor(ok.length / 50)))
  const knots: Array<[number, number]> = []
  for (let b = 0; b < nb; b++) {
    const idx = order.slice(
      Math.floor((b * order.length) / nb),
      Math.floor(((b + 1) * order.length) / nb)
    )
    knots.push([
      idx.reduce((s, i) => s + ok[i].abundance, 0) / idx.length,
      idx.reduce((s, i) => s + e[i], 0) / idx.length
    ])
  }
  const trend = (a: number): number => {
    if (knots.length === 1 || a <= knots[0][0]) return knots[0][1]
    for (let k = 1; k < knots.length; k++)
      if (a <= knots[k][0]) {
        const [a0, e0] = knots[k - 1]
        const [a1, e1] = knots[k]
        return e0 + ((e1 - e0) * (a - a0)) / (a1 - a0 || 1)
      }
    return knots[knots.length - 1][1]
  }
  const resid = e.map((v, i) => v - trend(ok[i].abundance))
  const n = resid.length
  const rmean = resid.reduce((s, v) => s + v, 0) / n
  const evar =
    resid.reduce((s, v) => s + (v - rmean) ** 2, 0) / (n - 1) -
    ok.reduce((s, c) => s + trigamma(c.d / 2), 0) / n
  const d0 = evar > 0 ? 2 * trigammaInverse(evar) : Infinity
  const shift = Number.isFinite(d0) ? digamma(d0 / 2) - Math.log(d0 / 2) : 0
  return { d0, s0sq: (a) => Math.exp(trend(a) + rmean + shift) }
}
