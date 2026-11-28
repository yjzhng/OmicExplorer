/**
 * Response changes: curves along one axis compared across the other (the 'changes' intent of a
 * two-axis Curve fit), by spline or by a 4PL along the response axis.
 */
import {
  type AxisMap,
  axisMapFor,
  type AxisModel,
  type AxisShape,
  baseLevelOf,
  toX,
  treatedLevel,
  withZero
} from './axisModel'
import { numValue } from '../compare/compare'
import { NO_PROGRESS, type ProgressTracker } from '../runtime/progress'
import { fitLogistic, fSurvival, logistic, Y_LIMITS_LOG2 } from './curveFit'
import { rng } from '../compare/sam'
import { benjaminiHochberg, gammaln } from '../stats/stats'
import { fitNullTail, nullSurvival } from './surfaceNull'
import type { CompareInput, ConditionKey, StandardRow } from '../types'
import { surfaceFrame, type SurfaceFrame, type SurfacePlan } from './splineSurface'
import { log2v, mean, score, type SplineRow, type SplineRun } from './splineFit'
import { axisBasis, lstsq, type SplineCurve } from './splineCurve'

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
 * effect) is the largest departure from the shared fit; `shift` says what kind it is. The baseline
 * (plan.position) is the surface fit's: against one position — the vehicle's lowest level on both
 * axes, the melt shown as response — or against the vehicle at each level of the second axis (dose
 * 0 at every time), whose offset along that axis is then no change (the null's, see `offsets`);
 * laid out against it for drawing as every surface is.
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
  // The baseline (surfaceFrame — as the surface fit's): each cell against the control at its own
  // levels with the pinned ones set to their pins. Where the compared axis is left free, each slice
  // has its own control, so what the controls do across the slices is no response: each slice's
  // own offset is the null's, not a change (`offsets`). (The compared axis pinned: the reference
  // varies along the response axis only, which the null's level per response level holds.)
  const frame = surfaceFrame(plan.pins, vehRows.map(aOf))
  if (!frame) return score([])
  // the compared axis's control level: its pin, else where the control sits lowest on it
  const ctlLevel = rk === 0 ? (frame.pinB ?? bBase) : (frame.pinA ?? aBase)
  const offsets = rk === 0 ? frame.pinB == null : frame.pinA == null
  const fr: SurfaceFrame = frame
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
        const f = sliceFits4pl(all, rOf, cOf, rMap, offsets)
        if (f) {
          pending4.push({ f, uniqID, cmpd, all, rOf, cOf, baseSlice })
          continue
        }
        continue
      }
      // the alternative's columns: each non-base slice's own deviation along the response axis —
      // without its intercept where the slices' offsets are the null's (offsets)
      const dev: Array<{ idx: number[]; basis: number[][] }> = []
      let nDev = 0
      for (const sl of slices.slice(1)) {
        const idx = all.flatMap((c, i) => (cOf(c) === sl ? [i] : []))
        if (idx.length < 2) continue
        const xs = idx.map((i) => toX(rMap, rOf(all[i])))
        let basis = axisBasis(shapeR, xs)
        // too few points for the shape: just its offset
        if (!basis || basis[0].length >= xs.length) basis = xs.map(() => [1])
        if (offsets) basis = basis.map((r) => r.slice(1))
        if (!basis[0].length) continue
        dev.push({ idx, basis })
        nDev += basis[0].length
      }
      // the null: a level per response level, shared by every slice — plus, against the control at
      // each level of the compared axis, each non-base slice's own offset
      const offSlices = offsets ? slices.slice(1) : []
      const nR = rLevels.length
      const n = all.length
      const p0 = nR + offSlices.length
      const p1 = p0 + nDev
      if (!nDev || n - p1 < 1) continue
      const y = all.map((c) => mean(c.v))
      const X0: number[][] = all.map((c) => [
        ...rLevels.map((l) => (rOf(c) === l ? 1 : 0)),
        ...offSlices.map((s) => (cOf(c) === s ? 1 : 0))
      ])
      const X1 = X0.map((row) => [...row, ...new Array<number>(nDev).fill(0)])
      let col = p0
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
        df: p1 - p0,
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
   *  change it is, and the layout it's drawn by — a surface against the baseline. */
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
    // Laid out against the baseline as every surface (surfaceFrame): the control groups — the
    // cells at a reference — and every other cell against its own (the nearest along the free
    // axis without one measured; with no reference cell at all, the first cell's)
    const groupKey = new Map<string, number>()
    all.forEach((c, i) => {
      if (fr.isRef(c.a, c.b) && !groupKey.has(fr.refKey(c.a, c.b)))
        groupKey.set(fr.refKey(c.a, c.b), i)
    })
    const groups = groupKey.size
      ? [...groupKey.values()].sort((i, j) => all[i].b - all[j].b || all[i].a - all[j].a)
      : [0]
    const near = (k: ConditionKey, v: number): number =>
      (k === A ? mA : mB).scale === 'log' ? Math.log10(Math.max(v, 0) + 1) : v
    const groupOf = (i: number): number => {
      const c = all[i]
      const own = groupKey.get(fr.refKey(c.a, c.b))
      if (own != null) return groups.indexOf(own)
      const dist = (j: number): number =>
        Math.abs(near(A, all[j].a) - near(A, c.a)) + Math.abs(near(B, all[j].b) - near(B, c.b))
      return groups.reduce((best, j, g) => (dist(j) < dist(groups[best]) ? g : best), 0)
    }
    const inGroups = new Set(groups)
    // each cell's fitted value against its control's fitted value: the model's own control at 0
    const frameOf = (i: number): number => f1[i] - f1[groups[groupOf(i)]]
    // what kind: each slice against the base slice (fitted, against the baseline), split into its
    // consistent offset and the rest
    const baseAt = new Map<number, number>()
    all.forEach((c, i) => {
      if (cOf(c) === baseSlice) baseAt.set(rOf(c), frameOf(i))
    })
    let drift = 0
    let shapeDev = 0
    let ssDrift = 0
    let ssShape = 0
    for (const sl of slices.slice(1)) {
      const d = all.flatMap((c, i) =>
        cOf(c) === sl && baseAt.has(rOf(c)) ? [frameOf(i) - baseAt.get(rOf(c))!] : []
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
    const order = all.map((_, i) => i).filter((i) => !inGroups.has(i))
    // (a cell's stored fit is read against its control group's measured mean — so stored as its
    // frame value over that mean, the model's control reads 0)
    const curve: SplineCurve = {
      x: [],
      y: [...groups.map((g) => y[g]), ...order.map((i) => y[i])],
      fitted: [...groups.map((g) => y[g]), ...order.map((i) => y[groups[groupOf(i)]] + frameOf(i))],
      ...test,
      peak,
      abundance: mean(all.flatMap((c) => c.v)),
      repSS,
      repDf,
      nPerLevel: mean(all.map((c) => c.v.length)),
      surface: {
        vehicle: groups.map((g) => ({ dose: all[g].a, time: all[g].b, mean: y[g] })),
        treated: order.map((i) => ({ dose: all[i].a, time: all[i].b, group: groupOf(i) })),
        timeOffset: bMap.offset,
        axes: [
          { axis: A, map: aMap, detect: plan.detect[0], base: fr.pinA ?? aBase },
          { axis: B, map: bMap, detect: plan.detect[1], base: fr.pinB ?? bBase }
        ],
        pins: fr.pins,
        ...(fr.pinA != null && fr.pinB != null ? { position: true } : null),
        samples: groups.map((g, k) => ({
          dose: all[g].a,
          time: all[g].b,
          group: k,
          v: all[g].v,
          vehicle: true as const
        }))
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
  /** each slice's own offset is the null's (against the control at each level of the compared
   *  axis — see runSliceShift's `offsets`): the null is the shared 4PL plus them */
  offsets?: boolean
}

/** A 4PL along the response axis on log₂ level means: one shared by every slice (null; with
 *  `offsets`, plus each slice's own offset) vs each slice its own (alternative). A slice with fewer
 *  than 5 levels can't take its own 4PL: left out of both. Null when fewer than 2 slices remain, or
 *  no df is left over. */
function sliceFits4pl<C>(
  all: C[],
  rOf: (c: C) => number,
  cOf: (c: C) => number,
  rMap: AxisMap,
  offsets = false
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
  const d1 = (offsets ? 3 : 4) * (kept.length - 1)
  const d2 = n - 4 * kept.length
  if (d2 < 1) return null
  const xs = idx.map((i) => toX(rMap, rOf(all[i])))
  const slice = kept.flatMap(([, i], k) => i.map(() => k))
  // centred on the gene's own mean: the 4PL's plateaus are bounded (Y_LIMITS_LOG2), raw log₂
  // intensities (~20–30) lie beyond them — and a shift changes neither RSS
  const raw = idx.map((i) => mean((all[i] as unknown as { v: number[] }).v))
  const centre = mean(raw)
  const y = raw.map((v) => v - centre)
  return {
    ...fitSlices(xs, y, slice, kept.length, offsets),
    y,
    d1,
    d2,
    xs,
    slice,
    idx,
    ...(offsets ? { offsets } : null)
  }
}

/** Backfitting rounds for the shared 4PL with each slice's own offset. */
const OFFSET_ROUNDS = 4

/** The shared and the per-slice 4PLs through (xs, y), slices numbered 0..k−1 — the shared one with
 *  each slice's own offset (slice 0's 0) where `offsets`, by backfitting. */
function fitSlices(
  xs: number[],
  y: number[],
  slice: number[],
  k: number,
  offsets = false
): Pick<SliceFits, 'f0' | 'f1' | 'rss0' | 'rss1'> {
  // (the fitter's starting guesses read the points in ascending x)
  const fit = (ix: number[], to: readonly number[] = y): number[] => {
    const order = [...ix].sort((a, b) => xs[a] - xs[b])
    const x = order.map((i) => xs[i])
    const p = fitLogistic(
      x,
      order.map((i) => to[i]),
      x,
      { yLimits: Y_LIMITS_LOG2 }
    )
    const at = new Map(order.map((i) => [i, logistic(xs[i], p)]))
    return ix.map((i) => at.get(i)!)
  }
  const all = xs.map((_, i) => i)
  let f0 = fit(all)
  if (offsets) {
    // the shared 4PL on the values less each slice's offset, then each offset the slice's mean
    // residual from it — a few rounds
    const off = new Array<number>(k).fill(0)
    for (let round = 0; round < OFFSET_ROUNDS; round++) {
      off.forEach((o, sl) => {
        if (sl === 0) return
        const ix = all.filter((i) => slice[i] === sl)
        off[sl] = ix.length ? mean(ix.map((i) => y[i] - f0[i])) : 0
      })
      f0 = fit(
        all,
        y.map((v, i) => v - off[slice[i]])
      )
    }
    f0 = f0.map((v, i) => v + off[slice[i]])
  }
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
        const sim = fitSlices(g.xs, ySim, g.slice, Math.max(...g.slice) + 1, g.offsets)
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
