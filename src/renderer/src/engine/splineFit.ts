/**
 * Shape-free curve detection — the spline detector of the unified curve-fit design (one numeric
 * axis, placed by its axis model: axisModel.ts).
 *
 * Each curve is its level means on the log₂ scale, relative to the baseline (the control), with the
 * baseline itself as one more level (value 0): one step below the lowest level against one
 * reference (dose), at the level 0 against a matched control (time's t₀). A natural
 * cubic spline over those levels is tested against a flat line by an F-test. The spline's df follows
 * the number of treated levels, so it can bend into any gentle shape (rise, fall, peak, plateau)
 * but not a zig-zag; nothing about a sigmoid is assumed.
 *
 * Noise is per gene: the curve's residual around its spline — between level means, so condition-
 * level variation shared by replicates is in it — moderated toward a prior from the gene's OWN
 * replicate scatter (scaled by κ), with the prior's weight (df) estimated across genes; where
 * condition-level variation differs between genes the weight drops and the residual leads.
 * Single-replicate curves are moderated toward an abundance-trend prior instead (limma-style).
 * The moderated F has an exact null distribution, so p comes from it directly; q is Benjamini–
 * Hochberg over every curve of the run, scaled by Storey's π₀ (the estimated share of curves with no
 * response) when the curves have replicates. The effect size is the PEAK |log₂ ratio| of the fitted
 * curve over the treated levels — not lowest → highest — so transient and saturated responses keep
 * their size.
 *
 * A matched baseline (time) takes the control AT each level as that level's baseline (interpolated
 * between its levels, the nearest beyond them), so control drift cancels. A curve against one
 * reference whose control was measured only at another time (t₀) estimates the drift to its own
 * time from the treated compounds: drift is shared by every compound, a response is specific to one.
 */
import {
  axisMapFor,
  baseLevelOf,
  axisModelFor,
  DOSE_MODEL,
  driftsByDefault,
  fromX,
  TIME_MODEL,
  toX,
  treatedLevel,
  type AxisMap,
  type AxisModel,
  type AxisScale,
  type AxisShape
} from './axisModel'
import { condValue, numValue } from './compare'
import { NO_PROGRESS, type ProgressTracker } from './progress'
import {
  fSurvival,
  fitLogistic,
  interpolatedPoints,
  interpolationGrid,
  logistic,
  Y_LIMITS_LOG2,
  type LogisticParams
} from './curveFit'
import { baselineText, compareSlices } from './direct'
import { rng } from './sam'
import { benjaminiHochberg, gammaln } from './stats'
import { fitNullTail, nullSurvival } from './surfaceNull'
import { fitJointSurface, type JointFit, type JointParams, type JointSpec } from './surfaceJoint'
import { numericConds, type CompareInput, type ConditionKey, type StandardRow } from './types'

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
function lstsq(X: number[][], y: number[]): number[] | null {
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
    vehicle: Array<{ time: number; mean: number }>
    treated: Array<{ dose: number; time: number; group: number }>
    timeOffset: number
    /** the two axes as fitted (absent: dose × time, log₁₀ dose and log₁₀(t + offset), spline) */
    axes?: [SurfaceAxis, SurfaceAxis]
    /** against one position (SurfacePlan.position): one vehicle group, the first axis's base level
     *  a cell at every other level of the second */
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
function axisBasis(shape: AxisShape, xs: number[]): number[][] | null {
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

function digamma(x: number): number {
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
function trigamma(x: number): number {
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
function trigammaInverse(y: number): number {
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

// ── run over a comparison ────────────────────────────────────────────────────────────────────

export interface SplineRow {
  uniqID: string
  cmpd: string
  /** the comparison it belongs to (compareSlices' label, e.g. "dose curve | DMSO") */
  comparison?: string
  /** its baseline in words (baselineText) */
  baseline?: string
  /** the slice's context values (the other conditions), e.g. { time: 480 } for a dose curve */
  context: Record<string, string | number | null>
  peak: number
  F: number
  df1: number
  df2: number
  p: number
  q: number
  curve: SplineCurve
}

const log2v = (v: number | null): number | null => (v != null && v > 0 ? Math.log2(v) : null)
const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length

interface Level {
  mean: number
  ss: number
  n: number
}
/** Level means (and replicate scatter) of a gene's rows by the axis value (its treated levels:
 *  treatedLevel — above 0 on a log axis). */
function levelStats(
  rows: StandardRow[],
  axis: ConditionKey,
  scale: AxisScale = 'log'
): Map<number, Level> {
  const by = new Map<number, number[]>()
  for (const r of rows) {
    const lv = numValue(r, axis)
    const y = log2v(r.value)
    if (!treatedLevel(scale, lv) || y == null) continue
    const a = by.get(lv)
    if (a) a.push(y)
    else by.set(lv, [y])
  }
  return new Map([...by].map(([k, v]) => [k, stats(v)]))
}
function stats(v: number[]): Level {
  const m = mean(v)
  return { mean: m, ss: v.reduce((s, x) => s + (x - m) ** 2, 0), n: v.length }
}

/**
 * Vehicle drift to a level t of a drift condition (`along`: time, or any other numeric condition
 * the curves are taken at) for a gene, for curves with no vehicle measured at t: drift is shared by
 * every compound, a response is specific to one — so each compound's two lowest levels of the
 * curve's axis (`axis`: dose) at t, relative to the measured vehicle, estimate drift + that
 * compound's low-level response; the compound that moves least gives the estimate.
 */
function driftEstimator(
  rows: StandardRow[],
  cmpds: Set<string>,
  axis: ConditionKey = 'dose',
  scale: AxisScale = 'log',
  along: ConditionKey = 'time'
): (t: number, uniqID: string, vehicle: number) => number {
  const byTime = new Map<number, Map<string, Map<string, StandardRow[]>>>()
  const treatedAt = (t: number): Map<string, Map<string, StandardRow[]>> => {
    let m = byTime.get(t)
    if (m) return m
    m = new Map()
    for (const r of rows) {
      if (
        !cmpds.has(r.cmpd) ||
        !treatedLevel(scale, numValue(r, axis)) ||
        (numValue(r, along) ?? 0) !== t
      )
        continue
      let g = m.get(r.uniqID)
      if (!g) m.set(r.uniqID, (g = new Map()))
      const a = g.get(r.cmpd)
      if (a) a.push(r)
      else g.set(r.cmpd, [r])
    }
    byTime.set(t, m)
    return m
  }
  return (t, uniqID, vehicle) => {
    const g = treatedAt(t).get(uniqID)
    if (!g) return 0
    let best: number | null = null
    for (const rs of g.values()) {
      const lv = levelStats(rs, axis, scale)
      const low = [...lv.keys()].sort((a, b) => a - b).slice(0, 2)
      if (!low.length) continue
      const d = mean(low.map((k) => lv.get(k)!.mean)) - vehicle
      if (best == null || Math.abs(d) < Math.abs(best)) best = d
    }
    return best ?? 0
  }
}

/** The distinct values `axis` takes in these rows (what its scale is detected from). */
export function axisLevels(rows: readonly StandardRow[], axis: ConditionKey): number[] {
  const seen = new Set<number>()
  for (const r of rows) {
    const v = numValue(r, axis)
    if (v != null) seen.add(v)
  }
  return [...seen]
}

export interface SplineRun {
  rows: SplineRow[]
  prior: Moderation
  /** replicate-prediction scale: residual between level means vs replicate scatter / n, typical gene */
  kappa: number
  /** prior df of the replicate prediction (small = condition-level variation differs between genes) */
  priorDfReplicates: number
  /** estimated share of curves with no response (Storey's π₀), applied to the q-values */
  pi0: number
  /** one-axis runs: the comparisons present and the compared condition (as compareSlices) */
  comparisons?: string[]
  cmpCond?: string
}

/** Storey's π₀ at λ = 0.5: null p-values are uniform, so twice the share above 0.5 estimates the
 *  null share; capped at 1. */
export function storeyPi0(p: number[], lambda = 0.5): number {
  const ok = p.filter((v) => Number.isFinite(v))
  if (ok.length < 20) return 1
  return Math.min(1, ok.filter((v) => v > lambda).length / ((1 - lambda) * ok.length))
}

/**
 * Spline detection for every numerator group of a comparison (grouping as runCurveFit:
 * compareSlices), over `curveAxis`. Rows come back with p, q (BH over all curves) and the peak.
 */
export function runSplineFit(
  input: CompareInput & { curveAxis: ConditionKey },
  progress: ProgressTracker = NO_PROGRESS
): SplineRun {
  const axis = input.curveAxis
  const { slices, contextDims, comparisons, cmpCond } = compareSlices(input)
  progress.stage('Fitting spline curves')
  progress.plan(slices.reduce((a, sl) => a + new Set(sl.grp.map((r) => r.uniqID)).size, 0))
  const runLevels = axisLevels(
    slices.flatMap((sl) => sl.grp),
    axis
  )
  const model = axisModelFor(axis, input.axisModel, input.axisScale, runLevels, input.axisBaseline)
  // a linear axis counts in one step for the whole run (its treated levels' spacing), so every
  // gene's x is on the same footing; a log axis's offset is each gene's own, as it always was
  const runMap = axisMapFor(
    model,
    runLevels.filter((v) => treatedLevel(model.scale, v))
  )
  const fits: Array<Omit<SplineRow, 'F' | 'df1' | 'df2' | 'p' | 'q'>> = []
  // Drift: along every numeric condition but the curve's own axis and dose (the agent — the
  // vehicle is its absence, never drifting along it): time, a temperature, … — a curve whose
  // control wasn't measured at its own level of one has the drift there estimated (driftEstimator).
  const cmpds = new Set(slices.flatMap((sl) => sl.grp.map((r) => r.cmpd)))
  const driftConds = [...numericConds(input.numericConditions)].filter(
    (c) => c !== axis && c !== 'dose' && input.activeConditions.includes(c)
  )
  const driftAt = new Map(
    driftConds.map((c) => [c, driftEstimator(input.rows, cmpds, axis, model.scale, c)])
  )
  for (const { grp, denSlice, rep, label } of slices) {
    const context = Object.fromEntries(contextDims.map((c) => [c, condValue(rep, c) ?? null]))
    const byGene = new Map<string, StandardRow[]>()
    for (const r of grp) {
      const a = byGene.get(r.uniqID)
      if (a) a.push(r)
      else byGene.set(r.uniqID, [r])
    }
    const ctlByGene = new Map<string, StandardRow[]>()
    for (const r of denSlice) {
      const a = ctlByGene.get(r.uniqID)
      if (a) a.push(r)
      else ctlByGene.set(r.uniqID, [r])
    }
    for (const [uniqID, rows] of byGene) {
      progress.add(1)
      const ctl = ctlByGene.get(uniqID) ?? []
      const lv = levelStats(rows, axis, model.scale)
      if (lv.size < 3) continue
      let ctlStats: Level = { mean: 0, ss: 0, n: 1 }
      const levels = [...lv.keys()].sort((a, b) => a - b)
      let x: number[]
      let y: number[]
      // A matched baseline's level: the control's lowest (t₀; absent counts as 0) — below the
      // curve's levels, else (a baseline picked above them) 0 as it always was.
      const b = baseLevelOf(ctl.map((r) => numValue(r, axis)))
      const base0 = model.baseline === 'matched' && b < levels[0] ? b : 0
      const map = model.scale === 'linear' ? runMap : axisMapFor(model, levels, base0)
      const tx = (t: number): number => toX(map, t)
      if (model.baseline === 'matched') {
        // Baseline per level: the control at that level; between its levels interpolated (on x),
        // beyond them the nearest; the control's own level (t₀, the lowest temperature) is the
        // curve's baseline.
        const vByTime = new Map<number, number[]>()
        for (const r of ctl) {
          const v = log2v(r.value)
          if (v == null) continue
          const t = numValue(r, axis) ?? 0
          const a = vByTime.get(t)
          if (a) a.push(v)
          else vByTime.set(t, [v])
        }
        if (vByTime.size === 0) continue
        const vt = [...vByTime]
          .map(([t, v]) => [tx(t), mean(v)] as [number, number])
          .sort((a, b) => a[0] - b[0])
        const base = (t: number): number => {
          const u = tx(t)
          if (u <= vt[0][0]) return vt[0][1]
          for (let k = 1; k < vt.length; k++)
            if (u <= vt[k][0])
              return (
                vt[k - 1][1] +
                ((vt[k][1] - vt[k - 1][1]) * (u - vt[k - 1][0])) / (vt[k][0] - vt[k - 1][0])
              )
          return vt[vt.length - 1][1]
        }
        x = [tx(base0), ...levels.map(tx)]
        y = [0, ...levels.map((t) => lv.get(t)!.mean - base(t))]
        const v0 = vByTime.get(base0)
        if (v0) ctlStats = stats(v0)
      } else {
        const cv = ctl.map((r) => log2v(r.value)).filter((v): v is number => v != null)
        if (cv.length === 0) continue
        ctlStats = stats(cv)
        // A curve whose vehicle was measured only at another level of a drift condition (a dose
        // curve at 60 min, its vehicle at t₀ only): add the drift to the curve's own level,
        // estimated from the treated compounds (driftAt) — for each such condition.
        let c = ctlStats.mean
        for (const [d, at] of driftAt) {
          const t = numValue(rep, d)
          if (t == null) continue
          const ctlAt = new Set(ctl.map((r) => numValue(r, d) ?? 0))
          if (!ctlAt.has(t)) c += at(t, uniqID, ctlStats.mean)
        }
        const lx = levels.map(tx)
        const steps = lx
          .slice(1)
          .map((v, i) => v - lx[i])
          .sort((a, b) => a - b)
        const step = steps.length ? steps[steps.length >> 1] : 0.5
        x = [lx[0] - step, ...lx]
        y = [0, ...levels.map((d) => lv.get(d)!.mean - c)]
      }
      const all = rows.map((r) => log2v(r.value)).filter((v): v is number => v != null)
      const lvs = [...lv.values(), ctlStats]
      const repInfo = {
        ss: lvs.reduce((a, l) => a + l.ss, 0),
        df: lvs.reduce((a, l) => a + l.n - 1, 0),
        nPerLevel: mean([...lv.values()].map((l) => l.n))
      }
      const curve = fitSplineCurve(x, y, mean(all), repInfo, input.axisFits?.[axis]?.detect)
      if (curve)
        fits.push({
          uniqID,
          cmpd: rep.cmpd,
          comparison: label,
          baseline: baselineText(denSlice, grp, numericConds(input.numericConditions)),
          context,
          peak: curve.peak,
          curve: { ...curve, scale: { ...map, axis } }
        })
    }
  }
  return { ...score(fits), comparisons, cmpCond }
}

/** Per-gene noise, moderated F, p and BH q for fitted curves (or surfaces). */
function score(fits: Array<Omit<SplineRow, 'F' | 'df1' | 'df2' | 'p' | 'q'>>): SplineRun {
  // Noise of a level mean = condition-level variation + replicate scatter / n — per gene. The
  // residual between level means estimates it without bias but with few df; the gene's own
  // replicate scatter / n predicts it with many df but misses condition-level variation. So the
  // replicate prediction is the gene's PRIOR for its residual variance, with a scale (κ) and a
  // prior df (d0) estimated across genes (limma's fitFDist on log residual / prediction): where
  // condition-level variation differs a lot between genes, d0 comes out small and each gene relies
  // on its own residual. Curves without replicates use the abundance-trend prior on the residual.
  const withRep = fits.filter((f) => f.curve.repDf > 0 && f.curve.repSS > 0 && f.curve.rss > 0)
  const pred = (c: SplineCurve): number => c.repSS / c.repDf / c.nPerLevel
  let kappa = 1
  let d0r = 0
  if (withRep.length >= 3) {
    const e = withRep.map(
      ({ curve: c }) =>
        Math.log(c.rss / c.dfRes / pred(c)) -
        digamma(c.dfRes / 2) +
        Math.log(c.dfRes / 2) +
        digamma(c.repDf / 2) -
        Math.log(c.repDf / 2)
    )
    const n = e.length
    const em = e.reduce((a, v) => a + v, 0) / n
    const evar =
      e.reduce((a, v) => a + (v - em) ** 2, 0) / (n - 1) -
      withRep.reduce((a, { curve: c }) => a + trigamma(c.dfRes / 2) + trigamma(c.repDf / 2), 0) / n
    d0r = evar > 0 ? 2 * trigammaInverse(evar) : Infinity
    kappa = Math.exp(em + (Number.isFinite(d0r) ? digamma(d0r / 2) - Math.log(d0r / 2) : 0))
  }
  const prior = fitPrior(
    fits.map((f) => ({
      s2: f.curve.rss / f.curve.dfRes,
      d: f.curve.dfRes,
      abundance: f.curve.abundance
    }))
  )
  const scored = fits.map((f) => {
    const c = f.curve
    const s2 = c.rss / c.dfRes
    const own = withRep.length >= 3 && c.repDf > 0 && c.repSS > 0
    const s0 = own ? kappa * pred(c) : prior.s0sq(c.abundance)
    // The replicate prediction is itself an estimate (repDf): its weight combines that sampling
    // noise with the spread between genes (variances of log add → trigamma).
    const d0 = own
      ? 2 * trigammaInverse((Number.isFinite(d0r) ? trigamma(d0r / 2) : 0) + trigamma(c.repDf / 2))
      : prior.d0
    const post = Number.isFinite(d0) ? (d0 * s0 + c.dfRes * s2) / (d0 + c.dfRes) : s0
    const df2 = Number.isFinite(d0) ? d0 + c.dfRes : 1e6
    const F = c.ssModel / c.df / post
    const p = Number.isFinite(F) ? fSurvival(F, c.df, df2) : 1
    return { ...f, F, df1: c.df, df2, p }
  })
  // q: Benjamini–Hochberg scaled by Storey's π₀ (the share of curves with no response). BH alone
  // assumes every curve could be null, which is conservative when many respond. π₀ needs null
  // p-values that are uniform, which holds when the noise comes from replicates; with single
  // replicates (residual + trend prior only) π₀ came out too low on real data, so plain BH there.
  const pv = scored.map((s) => s.p)
  const pi0 = withRep.length >= 0.5 * fits.length ? storeyPi0(pv) : 1
  const q = benjaminiHochberg(pv).map((v) => Math.min(1, pi0 * v))
  return {
    rows: scored.map((s, i) => ({ ...s, q: q[i] })),
    prior,
    kappa,
    priorDfReplicates: d0r,
    pi0
  }
}

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
  const { p, pred, mid } =
    model === 'linear' ? fitLine(c.x, c.y) : fit4pl(c.x, c.y, sc, interpolation)
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
    const by = new Map<number, number[]>()
    s.treated.forEach((r, i) => {
      const a = by.get(r[key])
      if (a) a.push(i)
      else by.set(r[key], [i])
    })
    const slices: SliceDescription[] = []
    let rss = 0
    for (const at of [...by.keys()].sort((a, b) => a - b)) {
      let idx = by.get(at)!
      // against one position, a slice's own base cell (dose 0 at this temperature: the vehicle's
      // melt) is where it starts — its value, not 0
      const baseIdx = s.position
        ? idx.find((i) => (key === 'time' ? s.treated[i].dose : s.treated[i].time) === base)
        : undefined
      if (baseIdx != null) idx = idx.filter((i) => i !== baseIdx)
      if (idx.length < 4) return null
      // along the axis, on its x: against a reference (dose) the baseline at −∞ (placed a unit
      // below the lowest), against its own first point (t₀) from that level
      const lv = (i: number): number =>
        key === 'time' ? toX(sc, s.treated[i].dose) : toX(sc, s.treated[i].time)
      idx.sort((a, b) => lv(a) - lv(b))
      const x0 =
        baseIdx != null ? lv(baseIdx) : sc.baseline === 'matched' ? toX(sc, base) : lv(idx[0]) - 1
      const xs = [x0, ...idx.map(lv)]
      const ys = [baseIdx != null ? eff[baseIdx] : 0, ...idx.map((i) => eff[i])]
      const { p, pred, mid } =
        shape === 'linear' ? fitLine(xs, ys) : fit4pl(xs, ys, sc, interpolation)
      idx.forEach((i, k) => (rss += (eff[i] - pred[k + 1]) ** 2))
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
  const axis = (k: 0 | 1): JointSpec['a'] | null => {
    const sh = shapes[k]
    if (sh !== '4pl' && sh !== 'linear' && sh !== 'constant') return null
    const m = maps[k]
    const lv = [...new Set(s.treated.map((t) => toX(m, k === 0 ? t.dose : t.time)))].sort(
      (x, y) => x - y
    )
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

// ── dose × time surface ──────────────────────────────────────────────────────────────────────

/**
 * Fit one dose × time surface. Rows are level means: the vehicle at each of its times, and every
 * treated (dose, time). The null gives each vehicle time its own level, shared by the treated
 * points at that time (no treatment effect, drift allowed); the alternative adds a tensor-product
 * natural spline over (log dose, log time) on the treated points. Treated times with no vehicle are
 * attached to the nearest vehicle time, their means shifted by the estimated drift (driftEstimator).
 */
export function fitSurface(
  vehicle: Array<{ time: number; mean: number }>,
  treated: Array<{ dose: number; time: number; mean: number; group: number }>,
  abundance: number,
  rep: { ss: number; df: number; nPerLevel: number },
  axes?: [SurfaceAxis, SurfaceAxis],
  position = false
): SplineCurve | null {
  const doses = [...new Set(treated.map((r) => r.dose))].sort((a, b) => a - b)
  const times = [...new Set(treated.map((r) => r.time))].sort((a, b) => a - b)
  if (splineDf(doses.length) == null || splineDf(times.length) == null) return null
  const gaps = [0, ...times].map((t, i, a) => (i ? t - a[i - 1] : Infinity)).filter((g) => g > 0)
  const off = axes ? axes[1].map.offset : Math.min(...gaps)
  // each axis's columns (its detector's shape), crossed: the tensor-product detector
  const xa = axes
    ? (d: number): number => toX(axes[0].map, d)
    : (d: number): number => Math.log10(d)
  const xb = axes
    ? (t: number): number => toX(axes[1].map, t)
    : (t: number): number => Math.log10(t + off)
  const BD = axisBasis(
    axes?.[0].detect ?? 'spline',
    treated.map((r) => xa(r.dose))
  )
  const BT = axisBasis(
    axes?.[1].detect ?? 'spline',
    treated.map((r) => xb(r.time))
  )
  if (!BD || !BT) return null
  const nG = vehicle.length
  const nT = BD[0].length * BT[0].length
  const n = nG + treated.length
  if (n - nG - nT < 1) return null
  const X: number[][] = []
  const y: number[] = []
  vehicle.forEach((v, g) => {
    X.push([
      ...Array.from({ length: nG }, (_, k) => (k === g ? 1 : 0)),
      ...new Array<number>(nT).fill(0)
    ])
    y.push(v.mean)
  })
  treated.forEach((r, i) => {
    const tensor: number[] = []
    for (const a of BD[i]) for (const b of BT[i]) tensor.push(a * b)
    X.push([...Array.from({ length: nG }, (_, k) => (k === r.group ? 1 : 0)), ...tensor])
    y.push(r.mean)
  })
  const b = lstsq(X, y)
  if (!b) return null
  const fitted = X.map((row) => row.reduce((s, v, j) => s + v * b[j], 0))
  const rss = y.reduce((s, v, i) => s + (v - fitted[i]) ** 2, 0)
  // null: each group (vehicle time + its treated points) at its own mean
  const gSum = new Array<number>(nG).fill(0)
  const gN = new Array<number>(nG).fill(0)
  vehicle.forEach((v, g) => ((gSum[g] += v.mean), gN[g]++))
  treated.forEach((r) => ((gSum[r.group] += r.mean), gN[r.group]++))
  let rss0 = 0
  vehicle.forEach((v, g) => (rss0 += (v.mean - gSum[g] / gN[g]) ** 2))
  treated.forEach((r) => (rss0 += (r.mean - gSum[r.group] / gN[r.group]) ** 2))
  let peak = 0
  treated.forEach((r, i) => {
    const e = fitted[nG + i] - b[r.group]
    if (Math.abs(e) > Math.abs(peak)) peak = e
  })
  return {
    x: [],
    y,
    fitted,
    df: nT,
    rss,
    dfRes: n - nG - nT,
    ssModel: Math.max(0, rss0 - rss),
    peak,
    abundance,
    repSS: rep.ss,
    repDf: rep.df,
    nPerLevel: rep.nPerLevel,
    surface: {
      vehicle,
      treated: treated.map((r) => ({ dose: r.dose, time: r.time, group: r.group })),
      timeOffset: off,
      ...(axes ? { axes } : null),
      ...(position ? { position: true } : null)
    }
  }
}

/** The two axes a surface run fits over, with each one's model (scale and baseline) and its
 *  detector's shape — absent: dose × time, on log axes against the vehicle at each time, the spline
 *  along both (as every surface before any pair could be fitted). */
export interface SurfacePlan {
  a: ConditionKey
  b: ConditionKey
  models: [AxisModel, AxisModel]
  detect: [AxisShape, AxisShape]
  /** the second axis's first point, from the whole dataset (t₀ — its rows may be filtered out of
   *  this run by a pin); absent: the lowest the run's vehicle sits at */
  bBase?: number
  /** the baseline is one position — the vehicle at one level of each axis (dose 0 at the lowest
   *  temperature) — rather than the vehicle at each level of the second axis: every other cell is
   *  measured against it, the first axis's own base level included (dose 0 at a higher
   *  temperature: the vehicle's melt is response too) */
  position?: boolean
}

/** A log axis map that places a level at or below 0 (its base, as a data point) a median step
 *  below its lowest level (AxisMap.zeroX); any other map as it is. */
function withZero(m: AxisMap, levels: readonly number[]): AxisMap {
  if (m.scale !== 'log' || m.offset > 0) return m
  const xs = levels.filter((v) => v > 0).map((v) => toX(m, v))
  if (!xs.length) return m
  const sorted = [...new Set(xs)].sort((a, b) => a - b)
  const steps = sorted
    .slice(1)
    .map((v, i) => v - sorted[i])
    .sort((a, b) => a - b)
  return { ...m, zeroX: sorted[0] - (steps.length ? steps[steps.length >> 1] : 1) }
}

/**
 * Two-axis detection: one surface per gene × compound (num.cmpd vs the den.cmpd vehicle), so a gene
 * is tested once rather than once per slice. The first axis (`plan.a`: dose) runs from the vehicle
 * (a control off it, or — matched — its own first point); the vehicle is measured at levels of the
 * second (`plan.b`: time), each treated cell taken against the vehicle at its level of it (a level
 * without one: the nearest, shifted by the drift along it the treated compounds show). A second
 * axis whose baseline is its own first point (t₀) has nothing to respond at that level: those cells
 * are left out. Other conditions must already be filtered to one value. Rows come back with p, q (BH
 * over all surfaces) and the peak (vs the vehicle level).
 */
export function runSurfaceFit(
  input: Pick<CompareInput, 'rows' | 'num' | 'den'>,
  plan?: SurfacePlan,
  progress: ProgressTracker = NO_PROGRESS
): SplineRun {
  const A = plan?.a ?? 'dose'
  const B = plan?.b ?? 'time'
  const [mA, mB] = plan?.models ?? [DOSE_MODEL, TIME_MODEL]
  const numC = new Set(input.num.cmpd ?? [])
  const denC = new Set(input.den.cmpd ?? [])
  const driftAt = driftEstimator(input.rows, numC, A, mA.scale, B)
  const byGene = new Map<string, { veh: StandardRow[]; trt: Map<string, StandardRow[]> }>()
  for (const r of input.rows) {
    const isVeh = denC.has(r.cmpd)
    if (!isVeh && !numC.has(r.cmpd)) continue
    let g = byGene.get(r.uniqID)
    if (!g) byGene.set(r.uniqID, (g = { veh: [], trt: new Map() }))
    if (isVeh) g.veh.push(r)
    else {
      const a = g.trt.get(r.cmpd)
      if (a) a.push(r)
      else g.trt.set(r.cmpd, [r])
    }
  }
  // the second axis's level of a sample (none counts as 0: t₀), and its first point — the lowest
  // the vehicle sits at — before which a matched axis has nothing to respond
  const bOf = (r: StandardRow): number => numValue(r, B) ?? 0
  const vehRows = input.rows.filter((r) => denC.has(r.cmpd))
  const bBase = plan?.bBase ?? baseLevelOf(vehRows.map((r) => numValue(r, B)))
  const aBase = baseLevelOf(vehRows.map((r) => numValue(r, A)))
  // against one position, every level but that position is a cell (the first axis's base level
  // at another level of the second carries the vehicle's own response)
  const position = !!plan?.position
  const bTreated = (v: number): boolean =>
    position ? true : mB.baseline === 'matched' ? v > bBase : treatedLevel(mB.scale, v)
  const aTreated = (v: number | null): v is number =>
    position ? v != null : treatedLevel(mA.scale, v)
  // a linear axis counts in one step for the whole run (its treated levels' spacing)
  const runLevels = (k: ConditionKey, keep: (v: number) => boolean): number[] =>
    [
      ...new Set(
        input.rows
          .filter((r) => numC.has(r.cmpd))
          .map((r) => numValue(r, k))
          .filter((v): v is number => v != null && keep(v))
      )
    ].sort((x, y) => x - y)
  const aLevels = runLevels(A, (v) => treatedLevel(mA.scale, v))
  const aMap0 = axisMapFor(mA, aLevels)
  // one position: the first axis's base level is a data point — on a log axis a step below
  const aMapRun = position ? withZero(aMap0, aLevels) : aMap0
  const bLevelsRun = runLevels(B, bTreated)
  // which vehicle level is nearest a treated level without one: by log (t + 1) on a log axis
  const near = (t: number): number => (mB.scale === 'log' ? Math.log10(t + 1) : t)
  const fits: Array<Omit<SplineRow, 'F' | 'df1' | 'df2' | 'p' | 'q'>> = []
  for (const [uniqID, { veh, trt }] of byGene) {
    progress.add(1)
    const vBy = new Map<number, number[]>()
    for (const r of veh) {
      const v = log2v(r.value)
      if (v == null) continue
      const t = bOf(r) || 0
      const a = vBy.get(t)
      if (a) a.push(v)
      else vBy.set(t, [v])
    }
    if (vBy.size === 0) continue
    const vTimes = [...vBy.keys()].sort((a, b) => a - b)
    const vStats = vTimes.map((t) => stats(vBy.get(t)!))
    // the vehicle's replicates, for drawing (the surface's samples)
    const vehSamples: SurfaceSample[] = vTimes.map((t, k) => ({
      dose: aBase,
      time: t,
      group: k,
      v: vBy.get(t)!,
      vehicle: true
    }))
    for (const [cmpd, rows] of trt) {
      const cells = new Map<string, { dose: number; time: number; v: number[] }>()
      // treated samples at a baseline level: not cells, kept to draw (the surface's samples)
      const atBase = new Map<string, { dose: number; time: number; v: number[] }>()
      for (const r of rows) {
        const v = log2v(r.value)
        const d = numValue(r, A)
        const t = bOf(r)
        if (v == null) continue
        // (the position itself is the baseline: the vehicle's, not a cell)
        const baseLevel = !aTreated(d) || !bTreated(t) || (position && d === aBase && t === bBase)
        const into = baseLevel ? atBase : cells
        const dd = d ?? aBase
        const k = `${dd}|${t}`
        const c = into.get(k)
        if (c) c.v.push(v)
        else into.set(k, { dose: dd, time: t, v: [v] })
      }
      const treated = [...cells.values()].map((c) => {
        const st = stats(c.v)
        // against one position, every cell against that one vehicle group
        let group = position ? 0 : vTimes.indexOf(c.time)
        let m = st.mean
        if (group < 0) {
          // no vehicle at this level: the nearest vehicle level, shifted by the estimated drift
          group = vTimes.reduce(
            (best, t, k) =>
              Math.abs(near(t) - near(c.time)) < Math.abs(near(vTimes[best]) - near(c.time))
                ? k
                : best,
            0
          )
          m -= driftAt(c.time, uniqID, vStats[group].mean)
        }
        return { dose: c.dose, time: c.time, mean: m, group, st }
      })
      if (treated.length < 4) continue
      const lvls = [...treated.map((t) => t.st), ...vStats]
      const all = rows.map((r) => log2v(r.value)).filter((v): v is number => v != null)
      // the second axis's map: a log one with a matched baseline at 0 takes this surface's own
      // offset (as it always has); a linear one the run's step
      const bTimes = [...new Set(treated.map((t) => t.time))].sort((x, y) => x - y)
      const bMap0 =
        mB.scale === 'linear' ? axisMapFor(mB, bLevelsRun) : axisMapFor(mB, bTimes, bBase)
      // one position: a base level at 0 with no offset to place it is a step below too
      const bMap = position ? withZero(bMap0, bTimes) : bMap0
      const curve = fitSurface(
        vTimes.map((t, k) => ({ time: t, mean: vStats[k].mean })),
        treated,
        mean(all),
        {
          ss: lvls.reduce((a, l) => a + l.ss, 0),
          df: lvls.reduce((a, l) => a + l.n - 1, 0),
          nPerLevel: mean(treated.map((t) => t.st.n))
        },
        plan
          ? [
              { axis: A, map: aMapRun, detect: plan.detect[0], base: aBase },
              { axis: B, map: bMap, detect: plan.detect[1], base: bBase }
            ]
          : undefined,
        position
      )
      if (curve) {
        // each baseline-level sample against its level's vehicle (the nearest without one)
        const groupOf = (t: number): number => {
          const k = vTimes.indexOf(t)
          if (k >= 0) return k
          return vTimes.reduce(
            (best, vt, j) =>
              Math.abs(near(vt) - near(t)) < Math.abs(near(vTimes[best]) - near(t)) ? j : best,
            0
          )
        }
        curve.surface!.samples = [
          ...vehSamples,
          ...[...atBase.values()].map((c) => ({ ...c, group: groupOf(c.time) }))
        ]
        fits.push({ uniqID, cmpd, context: {}, peak: curve.peak, curve })
      }
    }
  }
  return score(fits)
}

// ── response changes: curves along one axis compared across the other ───────────────────────

/**
 * Two-axis test of response CHANGES (the "test response changes" intent): does the curve along the
 * response axis differ between the levels of the other (the compared axis — the treatment)? One test
 * per gene × compound, every sample of it (the compared axis's base slice — dose 0, the vehicle's own
 * curve — included), on log₂ level means:
 *
 *   null:        y(c, r) = m_r               one level per response level, shared by every slice
 *   alternative: y(c, r) = m_r + d_c(r)      plus each non-base slice's own deviation, d_c the
 *                                            response axis's detector shape (spline / line /
 *                                            constant) with its own intercept
 *
 * The null's levels are free (not a smooth curve), so whatever every slice shares — the intrinsic
 * melt, a TMT plex's step between temperatures — cancels; what's tested is the slices differing.
 * Moderated F as every spline test (score): exact, nested linear models. The peak (the volcano's
 * effect) is the largest departure from the shared fit; `shift` says what kind it is. Laid out for
 * drawing as a surface against one position — the vehicle's lowest level on both axes — so the
 * Response plot shows the curves themselves (the melt), each slice from its own first point.
 */
export function runSliceShift(
  input: Pick<CompareInput, 'rows' | 'num' | 'den'>,
  plan: SurfacePlan,
  response: ConditionKey,
  progress: ProgressTracker = NO_PROGRESS,
  /** a 4PL along the response axis: its F's null — NPARC's (df estimated across the run's genes)
   *  or the adjusted F (simulated on each design) */
  stat: SliceStat = 'adjusted',
  /** the shape along the response axis (absent: the plan's detect) — a 4PL fits slice 4PLs */
  shape?: AxisShape
): SplineRun {
  const A = plan.a
  const B = plan.b
  const [mA, mB] = plan.models
  const rk: 0 | 1 = response === B ? 1 : 0
  const across = rk === 1 ? A : B
  const shapeR = shape ?? plan.detect[rk]
  const numC = new Set(input.num.cmpd ?? [])
  const denC = new Set(input.den.cmpd ?? [])
  const aOf = (r: StandardRow): number => numValue(r, A) ?? 0
  const bOf = (r: StandardRow): number => numValue(r, B) ?? 0
  const byGene = new Map<string, { veh: StandardRow[]; trt: Map<string, StandardRow[]> }>()
  for (const r of input.rows) {
    const isVeh = denC.has(r.cmpd)
    if (!isVeh && !numC.has(r.cmpd)) continue
    let g = byGene.get(r.uniqID)
    if (!g) byGene.set(r.uniqID, (g = { veh: [], trt: new Map() }))
    if (isVeh) g.veh.push(r)
    else {
      const a = g.trt.get(r.cmpd)
      if (a) a.push(r)
      else g.trt.set(r.cmpd, [r])
    }
  }
  // each axis's map over the run's levels — a log one placing its 0 a step below (one position)
  const levelsOf = (k: ConditionKey): number[] =>
    [
      ...new Set(
        input.rows
          .filter((r) => numC.has(r.cmpd) || denC.has(r.cmpd))
          .map((r) => numValue(r, k) ?? 0)
      )
    ].sort((x, y) => x - y)
  const vehRows = input.rows.filter((r) => denC.has(r.cmpd))
  const aBase = baseLevelOf(vehRows.map((r) => numValue(r, A)))
  const bBase = plan.bBase ?? baseLevelOf(vehRows.map((r) => numValue(r, B)))
  const mapOf = (m: AxisModel, levels: number[], base: number): AxisMap =>
    withZero(
      m.scale === 'linear'
        ? axisMapFor(m, levels)
        : axisMapFor(
            m,
            levels.filter((v) => treatedLevel(m.scale, v)),
            base
          ),
      levels
    )
  const aMap = mapOf(mA, levelsOf(A), aBase)
  const bMap = mapOf(mB, levelsOf(B), bBase)
  const rMap = rk === 0 ? aMap : bMap
  // the compared axis's control level: where the vehicle sits on it (the Curve fit's baseline)
  const ctlLevel = rk === 0 ? bBase : aBase
  type Cell = { a: number; b: number; v: number[] }
  const fits: Array<Omit<SplineRow, 'F' | 'df1' | 'df2' | 'p' | 'q'>> = []
  // a 4PL along the response axis: the fits, scored together once all are in (the null is the run's)
  const pending4: Array<{
    f: SliceFits
    uniqID: string
    cmpd: string
    all: Cell[]
    rOf: (c: Cell) => number
    cOf: (c: Cell) => number
    baseSlice: number
  }> = []
  for (const [uniqID, { veh, trt }] of byGene) {
    progress.add(1)
    for (const [cmpd, rows] of trt) {
      // every (first, second) level's samples: the compound's, then the vehicle's where the
      // compound has none there (a control that is the compound's own dose 0 is already in)
      const put = (r: StandardRow, into: Map<string, Cell>): void => {
        const v = log2v(r.value)
        if (v == null) return
        const a = aOf(r)
        const b = bOf(r)
        const k = `${a}|${b}`
        const c = into.get(k)
        if (c) c.v.push(v)
        else into.set(k, { a, b, v: [v] })
      }
      const cells = new Map<string, Cell>()
      for (const r of rows) put(r, cells)
      const vehCells = new Map<string, Cell>()
      for (const r of veh) put(r, vehCells)
      for (const [k, c] of vehCells) if (!cells.has(k)) cells.set(k, c)
      const all = [...cells.values()]
      if (all.length < 6) continue
      const rOf = (c: Cell): number => (rk === 0 ? c.a : c.b)
      const cOf = (c: Cell): number => (rk === 0 ? c.b : c.a)
      const rLevels = [...new Set(all.map(rOf))].sort((x, y) => x - y)
      const slices = [...new Set(all.map(cOf))].sort((x, y) => x - y)
      if (slices.length < 2 || rLevels.length < 3) continue
      // the reference slice: the compared axis's control level (the vehicle's — dose 0 as the Curve
      // fit's baseline sets it), else its lowest
      const baseSlice = slices.includes(ctlLevel) ? ctlLevel : slices[0]
      if (shapeR === '4pl') {
        const f = sliceFits4pl(all, rOf, cOf, rMap)
        if (f) {
          pending4.push({ f, uniqID, cmpd, all, rOf, cOf, baseSlice })
          continue
        }
        continue
      }
      // the alternative's columns: each non-base slice's own deviation along the response axis
      const dev: Array<{ idx: number[]; basis: number[][] }> = []
      let nDev = 0
      for (const sl of slices.slice(1)) {
        const idx = all.flatMap((c, i) => (cOf(c) === sl ? [i] : []))
        if (idx.length < 2) continue
        const xs = idx.map((i) => toX(rMap, rOf(all[i])))
        let basis = axisBasis(shapeR, xs)
        // too few points for the shape: just its offset
        if (!basis || basis[0].length >= xs.length) basis = xs.map(() => [1])
        dev.push({ idx, basis })
        nDev += basis[0].length
      }
      const nR = rLevels.length
      const n = all.length
      const p1 = nR + nDev
      if (!nDev || n - p1 < 1) continue
      const y = all.map((c) => mean(c.v))
      const X0: number[][] = all.map((c) => rLevels.map((l) => (rOf(c) === l ? 1 : 0)))
      const X1 = X0.map((row) => [...row, ...new Array<number>(nDev).fill(0)])
      let col = nR
      for (const { idx, basis } of dev) {
        idx.forEach((i, k) => basis[k].forEach((v, j) => (X1[i][col + j] = v)))
        col += basis[0].length
      }
      const b0 = lstsq(X0, y)
      const b1 = lstsq(X1, y)
      if (!b0 || !b1) continue
      const f0 = X0.map((row) => row.reduce((s, v, j) => s + v * b0[j], 0))
      const f1 = X1.map((row) => row.reduce((s, v, j) => s + v * b1[j], 0))
      const rss0 = y.reduce((s, v, i) => s + (v - f0[i]) ** 2, 0)
      const rss1 = y.reduce((s, v, i) => s + (v - f1[i]) ** 2, 0)
      const built = sliceCurve(all, rOf, cOf, baseSlice, y, f0, f1, {
        df: p1 - nR,
        rss: rss1,
        dfRes: n - p1,
        ssModel: Math.max(0, rss0 - rss1)
      })
      fits.push({ uniqID, cmpd, context: {}, peak: built.peak, curve: built.curve })
    }
  }
  if (pending4.length) return scoreSlices4pl(pending4, stat)
  return score(fits)

  /** A tested gene's curve: the effect (the largest departure from the shared fit), what kind of
   *  change it is, and the layout it's drawn by — a surface against one position. */
  function sliceCurve(
    all: Cell[],
    rOf: (c: Cell) => number,
    cOf: (c: Cell) => number,
    baseSlice: number,
    y: number[],
    f0: number[],
    f1: number[],
    test: Pick<SplineCurve, 'df' | 'rss' | 'dfRes' | 'ssModel'>
  ): { peak: number; curve: SplineCurve } {
    const slices = [...new Set(all.map(cOf))].sort((x, y) => x - y)
    // the effect: the largest departure from the shared fit, signed
    let peak = 0
    let peakA: number | undefined
    let peakB: number | undefined
    all.forEach((c, i) => {
      if (cOf(c) === baseSlice) return
      const e = f1[i] - f0[i]
      if (Math.abs(e) > Math.abs(peak)) {
        peak = e
        peakA = c.a
        peakB = c.b
      }
    })
    // what kind: each slice against the base slice (fitted), split into its consistent offset
    // and the rest
    const baseAt = new Map<number, number>()
    all.forEach((c, i) => {
      if (cOf(c) === baseSlice) baseAt.set(rOf(c), f1[i])
    })
    let drift = 0
    let shapeDev = 0
    let ssDrift = 0
    let ssShape = 0
    for (const sl of slices.slice(1)) {
      const d = all.flatMap((c, i) =>
        cOf(c) === sl && baseAt.has(rOf(c)) ? [f1[i] - baseAt.get(rOf(c))!] : []
      )
      if (!d.length) continue
      const m = mean(d)
      if (Math.abs(m) > Math.abs(drift)) drift = m
      ssDrift += d.length * m * m
      for (const v of d) {
        ssShape += (v - m) ** 2
        if (Math.abs(v - m) > Math.abs(shapeDev)) shapeDev = v - m
      }
    }
    // replicate scatter within the cells
    let repSS = 0
    let repDf = 0
    for (const c of all) {
      const m = mean(c.v)
      repSS += c.v.reduce((s, v) => s + (v - m) ** 2, 0)
      repDf += c.v.length - 1
    }
    // drawn as a surface against one position: the vehicle's lowest level on both axes (else the
    // first cell), every other cell against it
    const refIdx = Math.max(
      0,
      all.findIndex((c) => c.a === aBase && c.b === bBase)
    )
    const ref = all[refIdx]
    const order = all.map((_, i) => i).filter((i) => i !== refIdx)
    const curve: SplineCurve = {
      x: [],
      y: [y[refIdx], ...order.map((i) => y[i])],
      fitted: [y[refIdx], ...order.map((i) => f1[i])],
      ...test,
      peak,
      abundance: mean(all.flatMap((c) => c.v)),
      repSS,
      repDf,
      nPerLevel: mean(all.map((c) => c.v.length)),
      surface: {
        vehicle: [{ time: ref.b, mean: y[refIdx] }],
        treated: order.map((i) => ({ dose: all[i].a, time: all[i].b, group: 0 })),
        timeOffset: bMap.offset,
        axes: [
          { axis: A, map: aMap, detect: plan.detect[0], base: ref.a },
          { axis: B, map: bMap, detect: plan.detect[1], base: ref.b }
        ],
        position: true,
        samples: [{ dose: ref.a, time: ref.b, group: 0, v: ref.v, vehicle: true }]
      },
      shift: {
        response,
        across,
        drift,
        shape: shapeDev,
        driftShare: ssDrift + ssShape > 0 ? ssDrift / (ssDrift + ssShape) : 0,
        ...(peakA != null && peakB != null ? { peakA, peakB } : null)
      }
    }
    return { peak, curve }
  }

  /** The 4PL slices' rows: each gene's F on the run's null (NPARC's df, or the adjusted F). */
  function scoreSlices4pl(items: typeof pending4, how: SliceStat): SplineRun {
    const rows = items.map(({ f, uniqID, cmpd, all, rOf, cOf }) => {
      // the cells tested, and the reference slice among them: the control level, else the lowest
      const cells = f.idx.map((k) => all[k])
      const levels = cells.map(cOf)
      const base = levels.includes(ctlLevel) ? ctlLevel : Math.min(...levels)
      const built = sliceCurve(cells, rOf, cOf, base, f.y, f.f0, f.f1, {
        df: f.d1,
        rss: f.rss1,
        dfRes: f.d2,
        ssModel: Math.max(0, f.rss0 - f.rss1)
      })
      return { uniqID, cmpd, context: {}, peak: built.peak, curve: built.curve }
    })
    // the structure (prior, π₀ fields) as any run's; F, p and q are the 4PL's
    const run = score(rows)
    const p =
      how === 'adjusted' ? adjustedSliceP(items.map((x) => x.f)) : nparcP(items.map((x) => x.f))
    const q = benjaminiHochberg(p.map((x) => x.p))
    run.rows = run.rows.map((r, i) => ({
      ...r,
      F: p[i].F,
      df1: p[i].d1,
      df2: p[i].d2,
      p: p[i].p,
      q: q[i]
    }))
    run.pi0 = 1
    return run
  }
}

// ── response changes with a 4PL along the response axis ─────────────────────────────────────

/** The null a 4PL slice test's F is read against: NPARC's (Childs et al. 2019 — the F's df
 *  estimated across the run's genes) or the adjusted F (its null simulated on each design). */
export type SliceStat = 'nparc' | 'adjusted'

/** One gene's 4PL slice fits: its level means, the shared 4PL's fit (null) and each slice's own
 *  (alternative) at them, both RSS and the textbook df (d1 = 4 per extra slice, d2 = the rest). */
export interface SliceFits {
  y: number[]
  f0: number[]
  f1: number[]
  rss0: number
  rss1: number
  d1: number
  d2: number
  /** for simulating its null: the cells' places on the response axis, by slice */
  xs: number[]
  slice: number[]
  /** the cells tested (of the gene's): every slice with 5+ levels */
  idx: number[]
}

/** A 4PL along the response axis on log₂ level means: one shared by every slice (null) vs each
 *  slice its own (alternative). A slice with fewer than 5 levels can't take its own 4PL: left out
 *  of both. Null when fewer than 2 slices remain, or no df is left over. */
function sliceFits4pl<C>(
  all: C[],
  rOf: (c: C) => number,
  cOf: (c: C) => number,
  rMap: AxisMap
): SliceFits | null {
  const bySlice = new Map<number, number[]>()
  all.forEach((c, i) => {
    const k = cOf(c)
    const a = bySlice.get(k)
    if (a) a.push(i)
    else bySlice.set(k, [i])
  })
  const kept = [...bySlice.entries()].filter(([, idx]) => idx.length >= 5)
  if (kept.length < 2) return null
  const idx = kept.flatMap(([, i]) => i)
  const n = idx.length
  const d1 = 4 * (kept.length - 1)
  const d2 = n - 4 * kept.length
  if (d2 < 1) return null
  const xs = idx.map((i) => toX(rMap, rOf(all[i])))
  const slice = kept.flatMap(([, i], k) => i.map(() => k))
  // centred on the gene's own mean: the 4PL's plateaus are bounded (Y_LIMITS_LOG2), raw log₂
  // intensities (~20–30) lie beyond them — and a shift changes neither RSS
  const raw = idx.map((i) => mean((all[i] as unknown as { v: number[] }).v))
  const centre = mean(raw)
  const y = raw.map((v) => v - centre)
  return { ...fitSlices(xs, y, slice, kept.length), y, d1, d2, xs, slice, idx }
}

/** The shared and the per-slice 4PLs through (xs, y), slices numbered 0..k−1. */
function fitSlices(
  xs: number[],
  y: number[],
  slice: number[],
  k: number
): Pick<SliceFits, 'f0' | 'f1' | 'rss0' | 'rss1'> {
  // (the fitter's starting guesses read the points in ascending x)
  const fit = (ix: number[]): number[] => {
    const order = [...ix].sort((a, b) => xs[a] - xs[b])
    const x = order.map((i) => xs[i])
    const p = fitLogistic(
      x,
      order.map((i) => y[i]),
      x,
      { yLimits: Y_LIMITS_LOG2 }
    )
    const at = new Map(order.map((i) => [i, logistic(xs[i], p)]))
    return ix.map((i) => at.get(i)!)
  }
  const all = xs.map((_, i) => i)
  const f0 = fit(all)
  const f1 = new Array<number>(xs.length)
  for (let s = 0; s < k; s++) {
    const ix = all.filter((i) => slice[i] === s)
    fit(ix).forEach((v, j) => (f1[ix[j]] = v))
  }
  const rss = (f: number[]): number => y.reduce((a, v, i) => a + (v - f[i]) ** 2, 0)
  return { f0, f1, rss0: rss(f0), rss1: rss(f1) }
}

/** Degrees of freedom of a χ² by maximum likelihood (golden section on log k). */
function chiSqDf(z: number[]): number {
  const n = z.length
  const sLog = z.reduce((a, v) => a + Math.log(v), 0)
  const sum = z.reduce((a, v) => a + v, 0)
  const ll = (k: number): number =>
    (k / 2 - 1) * sLog - sum / 2 - n * ((k / 2) * Math.LN2 + gammaln(k / 2))
  let lo = Math.log(1e-3)
  let hi = Math.log(Math.max(2, n))
  const g = (Math.sqrt(5) - 1) / 2
  for (let it = 0; it < 100; it++) {
    const a = hi - g * (hi - lo)
    const b = lo + g * (hi - lo)
    if (ll(Math.exp(a)) < ll(Math.exp(b))) lo = a
    else hi = b
  }
  return Math.exp((lo + hi) / 2)
}

const medianOf = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * NPARC's F-test (Childs et al. 2019; the Bioconductor package's empirical df, NPARCtest): the
 * RSS reduction and the alternative's RSS are each taken as a scaled χ² — scale
 * σ₀² = ½ · MAD(ΔRSS)² / median(ΔRSS) over the run's genes, each df by maximum likelihood on
 * ΔRSS / σ₀² and RSS₁ / σ₀² — and F = (ΔRSS / d1) / (RSS₁ / d2) is read on F(d1, d2). Fewer than
 * 10 genes with ΔRSS > 0: the textbook df.
 */
function nparcP(fits: SliceFits[]): Array<{ F: number; d1: number; d2: number; p: number }> {
  const diff = fits.map((f) => f.rss0 - f.rss1)
  const pos = diff.filter((v) => Number.isFinite(v) && v > 0)
  let d1: number | null = null
  let d2: number | null = null
  if (pos.length >= 10) {
    const m = medianOf(pos)
    const mad = 1.4826 * medianOf(pos.map((v) => Math.abs(v - m)))
    const s0sq = (0.5 * mad * mad) / m
    if (s0sq > 0) {
      const ok = fits.filter((f, i) => diff[i] > 0 && f.rss1 > 0)
      d1 = chiSqDf(ok.map((f) => (f.rss0 - f.rss1) / s0sq))
      d2 = chiSqDf(ok.map((f) => f.rss1 / s0sq))
    }
  }
  return fits.map((f, i) => {
    const a = d1 ?? f.d1
    const b = d2 ?? f.d2
    const F = Math.max(0, diff[i]) / a / (f.rss1 / b)
    return { F, d1: a, d2: b, p: Number.isFinite(F) ? fSurvival(F, a, b) : 1 }
  })
}

/** Null simulations per design for the adjusted F, and how many designs get their own. */
const SLICE_NULL_SIMS = 1000
const SLICE_DESIGNS = 6
const SLICE_STRATA = 4

/** A gene's split for the adjusted F's null: what every slice shares (the shared 4PL plus its
 *  residual at each response level averaged over the slices), the noise level beyond it, and the
 *  share's size against that noise (the null F depends on it). */
function sharedPart(g: SliceFits): { shared: number[]; sd: number; ratio: number } {
  const byLevel = new Map<number, number[]>()
  g.xs.forEach((x, i) => {
    const a = byLevel.get(x)
    if (a) a.push(i)
    else byLevel.set(x, [i])
  })
  const shared = new Array<number>(g.y.length)
  let ss = 0
  let structure = 0
  for (const ix of byLevel.values()) {
    const m = mean(ix.map((i) => g.y[i] - g.f0[i]))
    structure += ix.length * m * m
    for (const i of ix) {
      shared[i] = g.f0[i] + m
      ss += (g.y[i] - shared[i]) ** 2
    }
  }
  const sd = Math.sqrt(ss / Math.max(1, g.y.length - byLevel.size))
  return { shared, sd, ratio: sd > 0 ? Math.sqrt(structure / g.y.length) / sd : Infinity }
}

/**
 * The adjusted F of a 4PL slice test: F = (ΔRSS / d1) / (RSS₁ / d2) read against its own null,
 * simulated. A null data set keeps what every slice shares exactly — the shared 4PL plus its
 * residual at each response level averaged over the slices (a plex's step, the curve's departure
 * from a 4PL) — and draws only the rest anew: normal noise at the gene's own level beyond it. The
 * null F depends on how large that shared part is against the noise, so the genes are simulated in
 * strata: per design (which cells it has) and within it per quartile of that ratio, each gene read
 * against its own stratum's null (the stratified null NPARC's authors suggest). Refitted both ways
 * and scored the same; the tail a generalized Pareto beyond the 90th percentile (surfaceNull's
 * fitNullTail). The commonest designs get their own strata; a rarer one takes the nearest by cell
 * count. Fixed seeds: a re-run gives the same p. (Tried first: one null per design — the genes
 * dominated by shared structure have far smaller null F's than the noise-dominated ones, so one
 * pool was far too conservative for them; a permutation across slices within each level — the genes
 * with real effects, shuffled, made its tail far too heavy.)
 */
function adjustedSliceP(
  fits: SliceFits[]
): Array<{ F: number; d1: number; d2: number; p: number }> {
  const key = (f: SliceFits): string =>
    f.xs.map((x, i) => `${f.slice[i]}:${x.toFixed(4)}`).join('|')
  const parts = fits.map(sharedPart)
  const byDesign = new Map<string, number[]>()
  fits.forEach((f, i) => {
    const k = key(f)
    const a = byDesign.get(k)
    if (a) a.push(i)
    else byDesign.set(k, [i])
  })
  const designs = [...byDesign.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, SLICE_DESIGNS)
  const Fof = (f: Pick<SliceFits, 'rss0' | 'rss1' | 'd1' | 'd2'>): number =>
    Math.max(0, f.rss0 - f.rss1) / f.d1 / (f.rss1 / f.d2)
  // per design, its genes in quartiles of the shared-to-noise ratio: each quartile its own null
  const strata = designs.flatMap(([, members], k) => {
    const sorted = [...members].sort((a, b) => parts[a].ratio - parts[b].ratio)
    const nq = Math.min(SLICE_STRATA, sorted.length)
    return Array.from({ length: nq }, (_, q) => {
      const ms = sorted.slice(
        Math.floor((q * sorted.length) / nq),
        Math.floor(((q + 1) * sorted.length) / nq)
      )
      const r = rng(7919 + 101 * k + q)
      const sample: number[] = []
      for (let s = 0; s < SLICE_NULL_SIMS; s++) {
        const i = ms[s % ms.length]
        const g = fits[i]
        const { shared, sd } = parts[i]
        const ySim = shared.map(
          (v) => v + sd * Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
        )
        const sim = fitSlices(g.xs, ySim, g.slice, Math.max(...g.slice) + 1)
        const F = Fof({ ...sim, d1: g.d1, d2: g.d2 })
        if (Number.isFinite(F)) sample.push(F)
      }
      return {
        design: k,
        lo: parts[ms[0]].ratio,
        hi: parts[ms[ms.length - 1]].ratio,
        n: fits[ms[0]].xs.length,
        tail: fitNullTail(sample)
      }
    })
  })
  return fits.map((f, i) => {
    const F = Fof(f)
    const own = designs.findIndex(([k]) => k === key(f))
    // its design's strata (a rare design: the nearest by cell count), then the stratum its ratio
    // falls in (the nearest at the ends)
    const d =
      own >= 0
        ? own
        : strata.reduce((a, b) =>
            Math.abs(b.n - f.xs.length) < Math.abs(a.n - f.xs.length) ? b : a
          ).design
    const mine = strata.filter((s) => s.design === d)
    const ratio = parts[i].ratio
    const t =
      mine.find((s) => ratio >= s.lo && ratio <= s.hi) ??
      mine.reduce((a, b) =>
        Math.min(Math.abs(ratio - b.lo), Math.abs(ratio - b.hi)) <
        Math.min(Math.abs(ratio - a.lo), Math.abs(ratio - a.hi))
          ? b
          : a
      )
    return { F, d1: f.d1, d2: f.d2, p: Number.isFinite(F) ? nullSurvival(F, t.tail) : 1 }
  })
}
