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
  axisModelFor,
  type AxisScale,
  baseLevelOf,
  toX,
  treatedLevel,
  withZero
} from './axisModel'
import { condValue, numValue } from '../compare/compare'
import { NO_PROGRESS, type ProgressTracker } from '../runtime/progress'
import { fSurvival } from './curveFit'
import { baselineText, compareSlices } from '../compare/direct'
import { benjaminiHochberg } from '../stats/stats'
import { type CompareInput, type ConditionKey, numericConds, type StandardRow } from '../types'
import {
  digamma,
  fitPrior,
  fitSplineCurve,
  type Moderation,
  type SplineCurve,
  trigamma,
  trigammaInverse
} from './splineCurve'

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

export const log2v = (v: number | null): number | null => (v != null && v > 0 ? Math.log2(v) : null)
export const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length

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
/** levelStats over every level, whatever the scale (a log axis's 0 included — placed by the map). */
function levelStatsAt(rows: StandardRow[], axis: ConditionKey): Map<number, Level> {
  const by = new Map<number, number[]>()
  for (const r of rows) {
    const lv = numValue(r, axis) ?? 0
    const y = log2v(r.value)
    if (y == null) continue
    const a = by.get(lv)
    if (a) a.push(y)
    else by.set(lv, [y])
  }
  return new Map([...by].map(([k, v]) => [k, stats(v)]))
}
export function stats(v: number[]): Level {
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
export function driftEstimator(
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
      // The baseline picked among the curve's levels (dose 100: levels below it, dose 0 too):
      // every level against the control there — the levels below it points of the curve like the
      // rest (a log axis's 0 placed a step below its lowest), the baseline's 0 a point among them.
      const ctlLevels = new Set(ctl.map((r) => numValue(r, axis) ?? 0))
      const allLevels = [...new Set(rows.map((r) => numValue(r, axis) ?? 0))]
      const pin = ctlLevels.size === 1 ? [...ctlLevels][0] : null
      if (pin != null && allLevels.some((v) => v < pin)) {
        const cv = ctl.map((r) => log2v(r.value)).filter((v): v is number => v != null)
        if (cv.length === 0) continue
        ctlStats = stats(cv)
        const lvAll = levelStatsAt(
          rows.filter((r) => (numValue(r, axis) ?? 0) !== pin),
          axis
        )
        const at = [...lvAll.keys()].sort((p0, p1) => p0 - p1)
        if (at.length < 3) continue
        const pos = at.filter((v) => v > 0 || model.scale === 'linear')
        const mapMid =
          model.scale === 'linear'
            ? runMap
            : withZero(axisMapFor(model, pos.length ? pos : [pin]), [...pos, pin])
        const all = rows.map((r) => log2v(r.value)).filter((v): v is number => v != null)
        const lvs = [...lvAll.values(), ctlStats]
        const curve = fitSplineCurve(
          [toX(mapMid, pin), ...at.map((v) => toX(mapMid, v))],
          [0, ...at.map((v) => lvAll.get(v)!.mean - ctlStats.mean)],
          mean(all),
          {
            ss: lvs.reduce((a, l) => a + l.ss, 0),
            df: lvs.reduce((a, l) => a + l.n - 1, 0),
            nPerLevel: mean([...lvAll.values()].map((l) => l.n))
          },
          input.axisFits?.[axis]?.detect
        )
        if (curve)
          fits.push({
            uniqID,
            cmpd: rep.cmpd,
            comparison: label,
            baseline: baselineText(denSlice, grp, numericConds(input.numericConditions)),
            context,
            peak: curve.peak,
            curve: { ...curve, scale: { ...mapMid, axis } }
          })
        continue
      }
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
export function score(fits: Array<Omit<SplineRow, 'F' | 'df1' | 'df2' | 'p' | 'q'>>): SplineRun {
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
