/**
 * Shape-free curve detection — the spline detector of the unified curve-fit design (first
 * increment: one axis, dose or time).
 *
 * Each curve is its level means on the log₂ scale, relative to the baseline (the vehicle), with the
 * baseline itself as one more level (value 0) one step below the lowest dose or at t₀. A natural
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
 * Time curves take the vehicle AT each time as that time's baseline (interpolated between vehicle
 * times, the nearest beyond them), so vehicle drift cancels. A dose curve whose vehicle was measured
 * only at another time (t₀) estimates the drift to its own time from the treated compounds: drift is
 * shared by every compound, a response is specific to one.
 */
import { condValue } from './compare'
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
import { benjaminiHochberg } from './stats'
import { fitJointSurface, type JointFit, type JointParams } from './surfaceJoint'
import type { CompareInput, ConditionKey, StandardRow } from './types'

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
  /** how x maps back to the axis (one-axis curves): dose x = log₁₀ dose with the baseline at a
   *  pseudo-dose one step below the lowest; time x = log₁₀(t + offset) with t₀ as the baseline */
  scale?: { axis: 'dose' } | { axis: 'time'; offset: number }
  /** dose × time surfaces: the layout behind y / fitted — the vehicle level per vehicle time
   *  first, then each treated cell (its vehicle group by index) — and the time axis offset */
  surface?: {
    vehicle: Array<{ time: number; mean: number }>
    treated: Array<{ dose: number; time: number; group: number }>
    timeOffset: number
  }
}

/** Fit one curve: level positions x (baseline at index 0) and level means y (baseline = 0).
 *  The baseline level has its own parameter and the spline runs over the treated levels only, so a
 *  step from the baseline (a response already saturated at the lowest dose, or present from the
 *  first time point) is representable; the null is still one flat line through every level. */
export function fitSplineCurve(
  x: number[],
  y: number[],
  abundance: number,
  rep: { ss: number; df: number; nPerLevel: number } = { ss: 0, df: 0, nPerLevel: 1 }
): SplineCurve | null {
  const df = splineDf(x.length - 1)
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
/** Level means (and replicate scatter) of a gene's rows by the axis value (> 0 only). */
function levelStats(rows: StandardRow[], axis: ConditionKey): Map<number, Level> {
  const by = new Map<number, number[]>()
  for (const r of rows) {
    const lv = Number(condValue(r, axis))
    const y = log2v(r.value)
    if (!(lv > 0) || y == null) continue
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
 * Vehicle drift to time t for a gene, for curves with no vehicle measured at t: drift is shared by
 * every compound, a response is specific to one — so each compound's two lowest doses at t,
 * relative to the measured vehicle, estimate drift + that compound's low-dose response; the
 * compound that moves least gives the estimate.
 */
function driftEstimator(
  rows: StandardRow[],
  cmpds: Set<string>
): (t: number, uniqID: string, vehicle: number) => number {
  const byTime = new Map<number, Map<string, Map<string, StandardRow[]>>>()
  const treatedAt = (t: number): Map<string, Map<string, StandardRow[]>> => {
    let m = byTime.get(t)
    if (m) return m
    m = new Map()
    for (const r of rows) {
      if (!cmpds.has(r.cmpd) || !(Number(r.dose) > 0) || Number(condValue(r, 'time') ?? 0) !== t)
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
      const lv = levelStats(rs, 'dose')
      const low = [...lv.keys()].sort((a, b) => a - b).slice(0, 2)
      if (!low.length) continue
      const d = mean(low.map((k) => lv.get(k)!.mean)) - vehicle
      if (best == null || Math.abs(d) < Math.abs(best)) best = d
    }
    return best ?? 0
  }
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
export function runSplineFit(input: CompareInput & { curveAxis: ConditionKey }): SplineRun {
  const axis = input.curveAxis
  const { slices, contextDims, comparisons, cmpCond } = compareSlices(input)
  const fits: Array<Omit<SplineRow, 'F' | 'df1' | 'df2' | 'p' | 'q'>> = []
  const driftAt = driftEstimator(
    input.rows,
    new Set(slices.flatMap((sl) => sl.grp.map((r) => r.cmpd)))
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
      const ctl = ctlByGene.get(uniqID) ?? []
      const lv = levelStats(rows, axis)
      if (lv.size < 3) continue
      let ctlStats: Level = { mean: 0, ss: 0, n: 1 }
      const levels = [...lv.keys()].sort((a, b) => a - b)
      let x: number[]
      let y: number[]
      let scale: SplineCurve['scale'] = { axis: 'dose' }
      if (axis === 'time') {
        // Baseline per time: the vehicle at that time; between vehicle times interpolated (log
        // time), beyond them the nearest; t₀ (time 0 / null) is the curve's baseline level.
        const vByTime = new Map<number, number[]>()
        for (const r of ctl) {
          const v = log2v(r.value)
          if (v == null) continue
          const t = Number(condValue(r, 'time') ?? 0) || 0
          const a = vByTime.get(t)
          if (a) a.push(v)
          else vByTime.set(t, [v])
        }
        if (vByTime.size === 0) continue
        const gaps = [0, ...levels]
          .map((t, i, a) => (i ? t - a[i - 1] : Infinity))
          .filter((g) => g > 0)
        const off = Math.min(...gaps)
        const tx = (t: number): number => Math.log10(t + off)
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
        x = [tx(0), ...levels.map(tx)]
        scale = { axis: 'time', offset: off }
        y = [0, ...levels.map((t) => lv.get(t)!.mean - base(t))]
        const v0 = vByTime.get(0)
        if (v0) ctlStats = stats(v0)
      } else {
        const cv = ctl.map((r) => log2v(r.value)).filter((v): v is number => v != null)
        if (cv.length === 0) continue
        ctlStats = stats(cv)
        // A dose curve whose vehicle was measured only at another time (e.g. t₀): add the drift
        // to the curve's own time, estimated from the treated compounds (driftAt).
        const t = condValue(rep, 'time')
        const ctlTimes = new Set(ctl.map((r) => Number(condValue(r, 'time') ?? 0)))
        const c =
          ctlStats.mean +
          (t != null && !ctlTimes.has(Number(t)) ? driftAt(Number(t), uniqID, ctlStats.mean) : 0)
        const lx = levels.map(Math.log10)
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
      const curve = fitSplineCurve(x, y, mean(all), repInfo)
      if (curve)
        fits.push({
          uniqID,
          cmpd: rep.cmpd,
          comparison: label,
          baseline: baselineText(denSlice, grp),
          context,
          peak: curve.peak,
          curve: { ...curve, scale }
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
  /** the 4PL's midpoint — half the effect on log₂ — in axis units: dose (as the data's dose unit)
   *  or time; front / back are the plateaus as log₂ ratios to the baseline (0 = no change) */
  mid: number
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
 * midpoint is half the effect on log₂, the same for rises and falls). Dose: the baseline is the
 * control at −∞, as in CurveCurator. Time: t₀ is a real point on the log(t + offset) axis, so the
 * 4PL runs over time from t₀: it starts at the baseline (front fixed at 0) and its midpoint may
 * not lie before t₀ (a response already full at the first time point puts it between t₀ and that
 * time). Fitted to the level means — the same points the spline detector
 * sees — and judged against it: a curve the 4PL explains much less of than the spline does is
 * flagged (`lowShape`). Description never affects calls or q. Null for surfaces (no scale) and for
 * curves with too few levels for 4 parameters.
 */
export function describeCurve(
  c: SplineCurve,
  minShapeRatio = 0.8,
  interpolation = false
): CurveDescription | null {
  const sc = c.scale
  if (!sc || c.x.length < 5) return null
  const { p, pred, mid } = fit4pl(c.x, c.y, sc, interpolation)
  const ym = mean(c.y)
  const sst = c.y.reduce((s, v) => s + (v - ym) ** 2, 0)
  const rss = pred.reduce((s, f, i) => s + (c.y[i] - f) ** 2, 0)
  return { ...p, mid, ...shape(rss, c.rss, sst, minShapeRatio) }
}

/** The description's 4PL on one curve's log₂ level means (baseline first, value 0), with its
 *  predictions at every level and its midpoint in axis units. Dose: the baseline is the control at
 *  −∞. Time: nothing responds before t₀ — the curve starts at the baseline (front fixed at 0, else
 *  it invents a plateau before t₀ to fit an early jump) and its midpoint stays at or after t₀. */
function fit4pl(
  x: number[],
  y: number[],
  sc: NonNullable<SplineCurve['scale']>,
  interpolation = false
): { p: LogisticParams; pred: number[]; mid: number } {
  const time = sc.axis === 'time'
  const xs = time ? x : [-Infinity, ...x.slice(1)]
  // CurveCurator's interpolation: grid points between the treated levels, in the fit only
  const extra = interpolation
    ? interpolatedPoints(x.slice(1), y.slice(1), interpolationGrid(x.slice(1)))
    : { x: [], y: [] }
  const p = fitLogistic([...xs, ...extra.x], [...y, ...extra.y], x.slice(1), {
    yLimits: Y_LIMITS_LOG2,
    pec50Max: time ? -x[0] : undefined,
    front: time ? 0 : undefined
  })
  const x50 = -p.pec50
  return {
    p,
    pred: xs.map((v) => logistic(v, p)),
    mid: sc.axis === 'time' ? Math.max(0, 10 ** x50 - sc.offset) : 10 ** x50
  }
}

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
  detected?: JointFit
): SurfaceDescription | null {
  const s = c.surface
  if (!s) return null
  const nG = s.vehicle.length
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
    const j = fitJointSurface(c, interpolation, detected)
    if (!j) return null
    return {
      method,
      byTime: j.byTime.map((t) => ({
        at: t.time,
        pec50: -t.x50,
        slope: j.params.h,
        front: 0,
        back: t.top,
        mid: 10 ** t.x50
      })),
      byDose: [],
      joint: j.params,
      jointUbar: j.ubar,
      ...fitOf(j.rss)
    }
  }
  const direction = (
    key: 'time' | 'dose',
    sc: NonNullable<SplineCurve['scale']>
  ): { slices: SliceDescription[]; rss: number } | null => {
    const by = new Map<number, number[]>()
    s.treated.forEach((r, i) => {
      const a = by.get(r[key])
      if (a) a.push(i)
      else by.set(r[key], [i])
    })
    const slices: SliceDescription[] = []
    let rss = 0
    for (const at of [...by.keys()].sort((a, b) => a - b)) {
      const idx = by.get(at)!
      if (idx.length < 4) return null
      // along the other axis: dose curves by log dose (baseline at −∞), time curves from t₀
      const lv = (i: number): number =>
        key === 'time'
          ? Math.log10(s.treated[i].dose)
          : Math.log10(s.treated[i].time + s.timeOffset)
      idx.sort((a, b) => lv(a) - lv(b))
      const x0 = key === 'time' ? lv(idx[0]) - 1 : Math.log10(s.timeOffset)
      const { p, pred, mid } = fit4pl(
        [x0, ...idx.map(lv)],
        [0, ...idx.map((i) => eff[i])],
        sc,
        interpolation
      )
      idx.forEach((i, k) => (rss += (eff[i] - pred[k + 1]) ** 2))
      slices.push({ ...p, at, mid })
    }
    return { slices, rss }
  }
  const byTime = direction('time', { axis: 'dose' })
  const byDose = direction('dose', { axis: 'time', offset: s.timeOffset })
  if (!byTime && !byDose) return null
  // the worse direction: the lower shape ratio against a spline, else the lower R²
  const worst = [byTime, byDose]
    .filter((d): d is NonNullable<typeof d> => d != null)
    .map((d) => fitOf(d.rss))
    .reduce((a, b) => ((b.shapeRatio ?? b.r2) < (a.shapeRatio ?? a.r2) ? b : a))
  return { method, byTime: byTime?.slices ?? [], byDose: byDose?.slices ?? [], ...worst }
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
  rep: { ss: number; df: number; nPerLevel: number }
): SplineCurve | null {
  const doses = [...new Set(treated.map((r) => r.dose))].sort((a, b) => a - b)
  const times = [...new Set(treated.map((r) => r.time))].sort((a, b) => a - b)
  const dfD = splineDf(doses.length)
  const dfT = splineDf(times.length)
  if (dfD == null || dfT == null) return null
  const gaps = [0, ...times].map((t, i, a) => (i ? t - a[i - 1] : Infinity)).filter((g) => g > 0)
  const off = Math.min(...gaps)
  const BD = nsBasis(
    treated.map((r) => Math.log10(r.dose)),
    dfD
  )
  const BT = nsBasis(
    treated.map((r) => Math.log10(r.time + off)),
    dfT
  )
  const nG = vehicle.length
  const nT = (dfD + 1) * (dfT + 1)
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
      timeOffset: off
    }
  }
}

/**
 * Dose × time detection: one surface per gene × compound (num.cmpd vs the den.cmpd vehicle), so a
 * gene is tested once rather than once per time slice. Other conditions must already be filtered to
 * one value. Rows come back with p, q (BH over all surfaces) and the peak (vs the vehicle level).
 */
export function runSurfaceFit(input: Pick<CompareInput, 'rows' | 'num' | 'den'>): SplineRun {
  const numC = new Set(input.num.cmpd ?? [])
  const denC = new Set(input.den.cmpd ?? [])
  const driftAt = driftEstimator(input.rows, numC)
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
  const fits: Array<Omit<SplineRow, 'F' | 'df1' | 'df2' | 'p' | 'q'>> = []
  for (const [uniqID, { veh, trt }] of byGene) {
    const vBy = new Map<number, number[]>()
    for (const r of veh) {
      const v = log2v(r.value)
      if (v == null) continue
      const t = Number(condValue(r, 'time') ?? 0) || 0
      const a = vBy.get(t)
      if (a) a.push(v)
      else vBy.set(t, [v])
    }
    if (vBy.size === 0) continue
    const vTimes = [...vBy.keys()].sort((a, b) => a - b)
    const vStats = vTimes.map((t) => stats(vBy.get(t)!))
    for (const [cmpd, rows] of trt) {
      const cells = new Map<string, { dose: number; time: number; v: number[] }>()
      for (const r of rows) {
        const v = log2v(r.value)
        const d = Number(r.dose)
        const t = Number(condValue(r, 'time') ?? 0)
        if (v == null || !(d > 0) || !(t > 0)) continue
        const k = `${d}|${t}`
        const c = cells.get(k)
        if (c) c.v.push(v)
        else cells.set(k, { dose: d, time: t, v: [v] })
      }
      const lt = (t: number): number => Math.log10(t + 1)
      const treated = [...cells.values()].map((c) => {
        const st = stats(c.v)
        let group = vTimes.indexOf(c.time)
        let m = st.mean
        if (group < 0) {
          // no vehicle at this time: nearest vehicle time, shifted by the estimated drift
          group = vTimes.reduce(
            (best, t, k) =>
              Math.abs(lt(t) - lt(c.time)) < Math.abs(lt(vTimes[best]) - lt(c.time)) ? k : best,
            0
          )
          m -= driftAt(c.time, uniqID, vStats[group].mean)
        }
        return { dose: c.dose, time: c.time, mean: m, group, st }
      })
      if (treated.length < 4) continue
      const lvls = [...treated.map((t) => t.st), ...vStats]
      const all = rows.map((r) => log2v(r.value)).filter((v): v is number => v != null)
      const curve = fitSurface(
        vTimes.map((t, k) => ({ time: t, mean: vStats[k].mean })),
        treated,
        mean(all),
        {
          ss: lvls.reduce((a, l) => a + l.ss, 0),
          df: lvls.reduce((a, l) => a + l.n - 1, 0),
          nPerLevel: mean(treated.map((t) => t.st.n))
        }
      )
      if (curve) fits.push({ uniqID, cmpd, context: {}, peak: curve.peak, curve })
    }
  }
  return score(fits)
}
