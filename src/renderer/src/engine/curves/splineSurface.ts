/**
 * The spline detector over a dose × time surface (see splineFit.ts): a tensor-product natural
 * spline on the treated cells against a vehicle-only null, and the run over a comparison.
 */
import {
  axisMapFor,
  type AxisModel,
  type AxisShape,
  baseLevelOf,
  DOSE_MODEL,
  TIME_MODEL,
  toX,
  withZero
} from './axisModel'
import { numValue } from '../compare/compare'
import { NO_PROGRESS, type ProgressTracker } from '../runtime/progress'
import type { CompareInput, ConditionKey, StandardRow } from '../types'
import {
  axisBasis,
  lstsq,
  type SplineCurve,
  splineDf,
  type SurfaceAxis,
  type SurfaceSample
} from './splineCurve'
import {
  driftEstimator,
  log2v,
  mean,
  score,
  type SplineRow,
  type SplineRun,
  stats
} from './splineFit'

// ── dose × time surface ──────────────────────────────────────────────────────────────────────

/**
 * Fit one dose × time surface. Rows are level means: the vehicle at each of its times, and every
 * treated (dose, time). The null gives each vehicle time its own level, shared by the treated
 * points at that time (no treatment effect, drift allowed); the alternative adds a tensor-product
 * natural spline over (log dose, log time) on the treated points. Treated times with no vehicle are
 * attached to the nearest vehicle time, their means shifted by the estimated drift (driftEstimator).
 */
export function fitSurface(
  vehicle: Array<{ dose?: number; time: number; mean: number }>,
  treated: Array<{ dose: number; time: number; mean: number; group: number }>,
  abundance: number,
  rep: { ss: number; df: number; nPerLevel: number },
  axes?: [SurfaceAxis, SurfaceAxis],
  pins?: SurfacePins
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
      ...(pins ? { pins } : null),
      ...(pins?.a != null && pins.b != null ? { position: true } : null)
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
  /** the baseline's pins (surfacePinsOf — the Baseline picked on the Curve fit's grid): each
   *  axis's pinned level, or null — every level of it its own (see surfaceFrame) */
  pins?: SurfacePins
}

/** A surface's baseline as picked: the level each axis is pinned to, null where it isn't. */
export interface SurfacePins {
  a: number | null
  b: number | null
}

/** What each cell of a surface is against: the control at its own levels with the pinned ones set
 *  to their pins — dose 0 pinned, each time's dose 0; dose 100, each time's dose 100; time 360,
 *  each dose's value at 360; both, one position. A cell at the reference itself is the control's,
 *  not a cell. An axis the pick leaves free whose control sits at one level of it (a vehicle
 *  compound, at dose 0) is pinned there. Null with no pin at all. */
export interface SurfaceFrame {
  pinA: number | null
  pinB: number | null
  pins: SurfacePins
  isRef: (a: number, b: number) => boolean
  refKey: (a: number, b: number) => string
}
export function surfaceFrame(
  pins: SurfacePins | undefined,
  /** the control's levels on the first axis */
  controlA: readonly number[]
): SurfaceFrame | null {
  const one = (vs: readonly number[]): number | null => {
    const u = new Set(vs)
    return u.size === 1 ? [...u][0] : null
  }
  const pinA = pins?.a ?? one(controlA)
  const pinB = pins?.b ?? null
  if (pinA == null && pinB == null) return null
  return {
    pinA,
    pinB,
    pins: { a: pinA, b: pinB },
    isRef: (a, b) => (pinA == null || a === pinA) && (pinB == null || b === pinB),
    refKey: (a, b) => `${pinA ?? a}|${pinB ?? b}`
  }
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
  // the vehicle sits at (the second axis's log offset)
  const bOf = (r: StandardRow): number => numValue(r, B) ?? 0
  const aOf = (r: StandardRow): number => numValue(r, A) ?? 0
  const vehRows = input.rows.filter((r) => denC.has(r.cmpd))
  const bBase = plan?.bBase ?? baseLevelOf(vehRows.map((r) => numValue(r, B)))
  // The baseline: each cell against the control at its own levels with the pinned ones set to
  // their pins (surfaceFrame) — dose 100 pinned, every dose against dose 100 at its time.
  const frame = surfaceFrame(plan?.pins, vehRows.map(aOf))
  if (!frame) return score([])
  const { isRef, refKey } = frame
  // a linear axis counts in one step for the whole run (its levels' spacing)
  const runLevels = (k: ConditionKey): number[] =>
    [
      ...new Set(
        input.rows
          .filter((r) => numC.has(r.cmpd))
          .map((r) => numValue(r, k))
          .filter((v): v is number => v != null && (mapsLinear(k) || v > 0))
      )
    ].sort((x, y) => x - y)
  const mapsLinear = (k: ConditionKey): boolean => (k === A ? mA : mB).scale === 'linear'
  const aLevels = runLevels(A)
  // a log axis's level at 0 that is a cell (dose 0 against a pin elsewhere) placed a step below
  const aMapRun = withZero(axisMapFor(mA, aLevels), aLevels)
  const bLevelsRun = runLevels(B)
  // which control level is nearest a level without one: by log (t + 1) on a log axis
  const near = (t: number): number => (mB.scale === 'log' ? Math.log10(t + 1) : t)
  const fits: Array<Omit<SplineRow, 'F' | 'df1' | 'df2' | 'p' | 'q'>> = []
  for (const [uniqID, { veh, trt }] of byGene) {
    progress.add(1)
    // the control's groups: one per reference (its levels on the unpinned axes)
    const vBy = new Map<string, { dose: number; time: number; v: number[] }>()
    // the control's samples off the reference (one position's dose 0 at a later time): cells,
    // each compound's where it has none of its own there
    const vehCells = new Map<string, { dose: number; time: number; v: number[] }>()
    for (const r of veh) {
      const v = log2v(r.value)
      if (v == null) continue
      const d = aOf(r)
      const t = bOf(r)
      if (!isRef(d, t)) {
        const c = vehCells.get(`${d}|${t}`)
        if (c) c.v.push(v)
        else vehCells.set(`${d}|${t}`, { dose: d, time: t, v: [v] })
        continue
      }
      const k = refKey(d, t)
      const g = vBy.get(k)
      if (g) g.v.push(v)
      else vBy.set(k, { dose: frame.pinA ?? d, time: frame.pinB ?? t, v: [v] })
    }
    if (vBy.size === 0) continue
    const groups = [...vBy.entries()].sort((x, y) => x[1].time - y[1].time || x[1].dose - y[1].dose)
    const gIdx = new Map(groups.map(([k], i) => [k, i]))
    const vStats = groups.map(([, g]) => stats(g.v))
    // the control's replicates, for drawing (the surface's samples)
    const vehSamples: SurfaceSample[] = groups.map(([, g], k) => ({
      dose: g.dose,
      time: g.time,
      group: k,
      v: g.v,
      vehicle: true
    }))
    for (const [cmpd, rows] of trt) {
      const cells = new Map<string, { dose: number; time: number; v: number[] }>()
      // treated samples at the reference itself: not cells, kept to draw (the surface's samples)
      const atBase = new Map<string, { dose: number; time: number; v: number[] }>()
      for (const r of rows) {
        const v = log2v(r.value)
        if (v == null) continue
        const d = aOf(r)
        const t = bOf(r)
        const into = isRef(d, t) ? atBase : cells
        const k = `${d}|${t}`
        const c = into.get(k)
        if (c) c.v.push(v)
        else into.set(k, { dose: d, time: t, v: [v] })
      }
      for (const [k, c] of vehCells) if (!cells.has(k)) cells.set(k, c)
      const treated = [...cells.values()].flatMap((c) => {
        const st = stats(c.v)
        let group = gIdx.get(refKey(c.dose, c.time)) ?? -1
        let m = st.mean
        if (group < 0) {
          // no control at this cell's reference: against each level of the second axis, the
          // nearest level's, shifted by the estimated drift; else none — left out
          if (frame.pinB != null) return []
          const same = groups.flatMap(([, g], k) => (g.dose === (frame.pinA ?? c.dose) ? [k] : []))
          if (!same.length) return []
          group = same.reduce((best, k) =>
            Math.abs(near(groups[k][1].time) - near(c.time)) <
            Math.abs(near(groups[best][1].time) - near(c.time))
              ? k
              : best
          )
          m -= driftAt(c.time, uniqID, vStats[group].mean)
        }
        return [{ dose: c.dose, time: c.time, mean: m, group, st }]
      })
      if (treated.length < 4) continue
      const lvls = [...treated.map((t) => t.st), ...vStats]
      const all = rows.map((r) => log2v(r.value)).filter((v): v is number => v != null)
      // the second axis's map: a log one with its base at 0 takes this surface's own offset (as
      // it always has); a linear one the run's step
      const bTimes = [...new Set(treated.map((t) => t.time))].sort((x, y) => x - y)
      const bMap0 =
        mB.scale === 'linear' ? axisMapFor(mB, bLevelsRun) : axisMapFor(mB, bTimes, bBase)
      const bMap = withZero(bMap0, bTimes)
      const curve = fitSurface(
        groups.map(([, g], k) => ({ dose: g.dose, time: g.time, mean: vStats[k].mean })),
        treated,
        mean(all),
        {
          ss: lvls.reduce((a, l) => a + l.ss, 0),
          df: lvls.reduce((a, l) => a + l.n - 1, 0),
          nPerLevel: mean(treated.map((t) => t.st.n))
        },
        plan
          ? [
              { axis: A, map: aMapRun, detect: plan.detect[0], base: frame.pinA ?? aLevels[0] },
              { axis: B, map: bMap, detect: plan.detect[1], base: frame.pinB ?? bBase }
            ]
          : undefined,
        frame.pins
      )
      if (curve) {
        curve.surface!.samples = [
          ...vehSamples,
          ...[...atBase.values()].flatMap((c) => {
            const g = gIdx.get(refKey(c.dose, c.time))
            return g == null ? [] : [{ ...c, group: g }]
          })
        ]
        fits.push({ uniqID, cmpd, context: {}, peak: curve.peak, curve })
      }
    }
  }
  return score(fits)
}
