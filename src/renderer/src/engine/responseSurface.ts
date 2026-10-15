/**
 * Curve fit by the response surface method: the spline detector (splineFit.ts) turned into the app's
 * comparison table. Over one axis (dose or time) one row per curve — gene × compound × context, as
 * the CurveCurator method's rows; over dose × time one row per surface — gene × compound ×
 * context, tested once. Each row carries the standard columns (log2FC = the fitted peak, pP = the
 * moderated F's p, pQ = its q: BH × Storey's π₀ over the run), so the table, the volcano and the
 * threshold's calls work as for any comparison, and its fit in `rs`: the levels, the spline, and —
 * for curves within the describe cutoff — the 4PL description.
 */
import { condValue, finaliseCompare, setCond, type RawStatRow } from './compare'
import {
  applyCurveFdr,
  ccEquivalentF,
  classifyCompareRow,
  curveGroupKey,
  relevanceScore,
  type CcTest,
  type DecoyCurve
} from './curveFit'
import { baselineText, driveSync, selectorMatch, type CompareTableResult } from './direct'
import {
  describeCurve,
  describeSurface,
  fitPrior,
  runSplineFit,
  runSurfaceFit,
  type SplineRow,
  type SplineRun,
  type SurfaceMethod
} from './splineFit'
import { rng } from './sam'
import { benjaminiHochberg, DEFAULT_THRESHOLD, thresholdLabel, type ThresholdConfig } from './stats'
import {
  designKey,
  fitNullTail,
  jointF,
  nullF,
  nullSurfaces,
  nullSurvival,
  type NullTail,
  type SurfaceDesign
} from './surfaceNull'
import { fitJointBatch, jointPredict, type JointBatch, type JointFit } from './surfaceJoint'
import type {
  CompareInput,
  CompareResultRow,
  CondSelector,
  ConditionKey,
  ResponseFit,
  StandardRow
} from './types'

/** The response surface method's default call: q ≤ 5%, no fold-change limit (the detection its
 *  FDR was benchmarked on); a peak fold-change limit can be added in the Statistic settings. */
export const RESPONSE_THRESHOLD: ThresholdConfig = {
  ...DEFAULT_THRESHOLD,
  type: 'linear',
  statType: 'pQ',
  statMin: -Math.log10(0.05),
  fcLow: 0,
  fcHigh: 0
}

/** Curves are described (4PL) up to this q, so a stricter or looser call made later — the
 *  threshold follows without a re-run — still finds its called curves described. */
export const DESCRIBE_Q = 0.25

export interface ResponseInput extends Omit<CompareInput, 'curveAxis'> {
  /** the curve's axis, or 'surface' for one dose × time surface per gene × compound */
  curveAxis: ConditionKey | 'surface'
  /** surfaces: describe slice by slice (default) or by one joint model */
  surfaceDescription?: SurfaceMethod
  /** describe every curve / surface, not just those within DESCRIBE_Q */
  describeAll?: boolean
  /** surfaces: detect with the spline surface (default) or with the 4PL surface — the joint model
   *  vs flat, its adjusted F (see scoreJoint4pl) */
  detector?: 'spline' | '4pl'
}

/** The control's samples stand in a surface run under this compound name, so a control that is
 *  the treatment's own compound at dose 0 (or t₀) can't be mistaken for a treated sample. */
const CONTROL = '\u0000control'

export function runResponseSurface(input: ResponseInput): CompareTableResult {
  return driveSync(responseSurfaceSteps(input), fitJointBatch)
}

/** runResponseSurface as steps: the 4PL surface detector's fits (its surfaces', then its decoys')
 *  handed out as batches (JointBatch) to be fitted wherever the driver likes — in place, or over
 *  the worker pool. The fits are pure, so either way the result is the same. */
export function* responseSurfaceSteps(
  input: ResponseInput
): Generator<JointBatch, CompareTableResult, JointFit[]> {
  const threshold = input.threshold ?? RESPONSE_THRESHOLD
  const { curveAxis, detector, ...cmp } = input
  const parts = curveAxis === 'surface' ? surfaceParts(cmp) : [oneAxisPart(cmp, curveAxis)]
  const cc =
    curveAxis === 'surface' && detector === '4pl'
      ? yield* scoreJoint4pl(
          parts.flatMap((p) => p.run.rows),
          !!input.interpolation
        )
      : null
  const raw: RawStatRow[] = []
  const fits: ResponseFit[] = []
  const qs: number[] = []
  const comparisons: string[] = []
  for (const { run, cmpCond, label, context } of parts) {
    for (const r of run.rows) {
      const comparison = r.comparison ?? label
      if (!comparisons.includes(comparison)) comparisons.push(comparison)
      const row: RawStatRow = {
        uniqID: r.uniqID,
        cmpd: r.cmpd,
        cmp_cond: cmpCond,
        comparison,
        mean1: NaN,
        mean2: NaN,
        sd1: NaN,
        sd2: NaN,
        log2FC: r.peak,
        pVal: r.p
      }
      for (const [c, v] of Object.entries({ ...context, ...r.context }))
        setCond(row, c as ConditionKey, v)
      raw.push(row)
      fits.push(r.baseline ? { ...fitOf(r, input), baseline: r.baseline } : fitOf(r, input))
      qs.push(r.q)
    }
  }
  const label = thresholdLabel(threshold)
  const finals: CompareResultRow[] = finaliseCompare(raw, threshold).map((r, i) => {
    // q is the run's own (BH × π₀ over every curve), not finaliseCompare's per-comparison BH.
    const pQ = qs[i] > 0 ? -Math.log10(qs[i]) : Number.isFinite(qs[i]) ? 300 : null
    return { ...r, pQ, rs: cc ? { ...fits[i], cc: cc[i].cc } : fits[i] }
  })
  if (!cc) {
    const rows = finals.map((r) => ({ ...r, ...classifyCompareRow(r, threshold), thrsh: label }))
    return { rows, comparisons, threshold }
  }
  // 4PL surfaces: CurveCurator's relevance score and target–decoy FDR, as for 4PL curves — the
  // decoy surfaces filed by comparison group, and the q's re-derived before the calls (by FDR the
  // calls read them).
  const decoys: Record<string, DecoyCurve[]> = {}
  finals.forEach((r, i) => {
    const d = cc[i].decoy
    if (!d) return
    const k = curveGroupKey(r)
    ;(decoys[k] ??= []).push(d)
  })
  const withQ = applyCurveFdr(finals, decoys, threshold)
  const rows = withQ.rows.map((r) => ({ ...r, ...classifyCompareRow(r, threshold), thrsh: label }))
  return {
    rows,
    comparisons,
    threshold,
    decoys,
    ...(withQ.fdr != null ? { curveFdr: withQ.fdr } : null),
    ...(withQ.alphas ? { ccAlpha: withQ.alphas } : null)
  }
}

/** One run's rows, with what every row of it shares: the compared condition, a fallback label,
 *  and context values (surfaces: the conditions the run was split on). */
interface Part {
  run: SplineRun
  cmpCond: string
  label: string
  context: Record<string, string | number | null>
}

function oneAxisPart(input: CompareInput, axis: ConditionKey): Part {
  const run = runSplineFit({ ...input, curveAxis: axis })
  return { run, cmpCond: run.cmpCond ?? 'cmpd', label: `${axis} curve`, context: {} }
}

/**
 * Dose × time: one surface per gene × compound. The treatments are the numerator's rows and the
 * control the denominator's, both over every dose and time (their dose / time pins don't apply —
 * the surface spans them). Any other condition that varies (e.g. cell line) splits the run, one
 * surface per gene × compound × its value; the control is matched to it where it varies too.
 * The control is a compound (the vehicle), or — the denominator pinned to dose 0 — each compound's
 * own dose 0 at every time: then the dose pins stay and each compound is its own run, against its
 * own dose 0. A time pin on the curves is a filter: the surface spans just those times, on both sides
 * (its baseline is still each time's own — a time pin on the control alone is ignored).
 */
function surfaceParts(input: CompareInput): Part[] {
  const active = input.activeConditions
  const zeroRef = (input.den.dose?.length ?? 0) > 0
  const free = (sel: CondSelector): CondSelector => {
    const { dose: d, time: _t, ...rest } = sel
    void _t
    return zeroRef && d ? { ...rest, dose: d } : rest
  }
  const kept = input.num.time?.length ? new Set(input.num.time.map(String)) : null
  const inTime = (r: StandardRow): boolean => !kept || kept.has(String(condValue(r, 'time') ?? ''))
  const numRows = input.rows.filter((r) => inTime(r) && selectorMatch(free(input.num), r, active))
  const denRows = input.rows.filter((r) => inTime(r) && selectorMatch(free(input.den), r, active))
  const splitOn = active.filter(
    (c) =>
      (c !== 'cmpd' || zeroRef) &&
      c !== 'dose' &&
      c !== 'time' &&
      new Set(numRows.map((r) => String(condValue(r, c) ?? ''))).size > 1
  )
  const keyOf = (r: StandardRow): string =>
    splitOn.map((c) => String(condValue(r, c) ?? '')).join('\u0001')
  const groups = new Map<string, StandardRow[]>()
  for (const r of numRows) {
    const k = keyOf(r)
    const g = groups.get(k)
    if (g) g.push(r)
    else groups.set(k, [r])
  }
  const denLabel = zeroRef
    ? 'dose 0'
    : [...new Set(denRows.map((r) => r.cmpd))].join('/') || 'control'
  const out: Part[] = []
  for (const grp of groups.values()) {
    const rep = grp[0]
    // The control at this context where it varies with it; all of it where it doesn't.
    const ctl = denRows.filter((d) =>
      splitOn.every((c) => {
        const vals = new Set(denRows.map((x) => String(condValue(x, c) ?? '')))
        return vals.size <= 1 || String(condValue(d, c) ?? '') === String(condValue(rep, c) ?? '')
      })
    )
    if (ctl.length === 0) continue
    const cmpds = [...new Set(grp.map((r) => r.cmpd))]
    const run = runSurfaceFit({
      rows: [...grp, ...ctl.map((r) => ({ ...r, cmpd: CONTROL }))],
      num: { cmpd: cmpds },
      den: { cmpd: [CONTROL] }
    })
    const baseline = baselineText(ctl, grp)
    for (const r of run.rows) {
      r.comparison = `${r.cmpd} | ${denLabel}`
      r.baseline = baseline
    }
    out.push({
      run,
      cmpCond: 'cmpd',
      label: `dose × time | ${denLabel}`,
      context: Object.fromEntries(
        splitOn.filter((c) => c !== 'cmpd').map((c) => [c, condValue(rep, c)])
      )
    })
  }
  return out
}

/** A row's fit for the table: the levels and the spline, plus the description when its q is
 *  within DESCRIBE_Q. */
function fitOf(r: SplineRow, input: ResponseInput): ResponseFit {
  const c = r.curve
  const base = { F: r.F, df1: r.df1, df2: r.df2 }
  const describe = !!input.describeAll || r.q <= DESCRIBE_Q
  if (c.surface) {
    const s = c.surface
    const nG = s.vehicle.length
    const desc = describe
      ? describeSurface(c, undefined, input.surfaceDescription, !!input.interpolation)
      : null
    return {
      axis: 'surface',
      ...(input.detector === '4pl' && input.curveAxis === 'surface'
        ? { detector: '4pl' as const }
        : null),
      ...base,
      timeOffset: s.timeOffset,
      cells: s.treated.map((t, i) => ({
        dose: t.dose,
        time: t.time,
        y: c.y[nG + i] - s.vehicle[t.group].mean,
        fitted: c.fitted[nG + i] - s.vehicle[t.group].mean
      })),
      ...(desc ? { surface: desc } : null)
    }
  }
  const desc = describe ? describeCurve(c, undefined, !!input.interpolation) : null
  return {
    axis: c.scale?.axis ?? (input.curveAxis as ConditionKey),
    ...base,
    x: c.x,
    y: c.y,
    fitted: c.fitted,
    ...(c.line ? { line: c.line } : null),
    ...(c.scale?.axis === 'time' ? { timeOffset: c.scale.offset } : null),
    ...(desc ? { desc } : null)
  }
}

/** The keys responseMetrics returns, in table order. */
export const RESPONSE_METRICS = [
  'pEC50',
  'EC50',
  'slope',
  'front',
  'back',
  'R2',
  'shape_ratio',
  'shape_QC',
  'F',
  'relevance',
  'q_decoy'
] as const

/**
 * A response surface method row's metrics for tables and exports: its moderated F, and for a
 * described one-axis curve its 4PL — potency (EC50 in the axis's units; pEC50 = −log₁₀ of it in
 * molar, given the unit's scale), slope, plateaus (log₂ vs the control), R² and how much of the
 * spline's fit it explains (shape ratio; shape_QC "low" when below the cut-off). A surface's
 * description is per time slice, so it has the F only. A 4PL surface adds, under CurveCurator's
 * threshold, its relevance score and target–decoy q (as curveMetrics for a 4PL curve).
 */
export function responseMetrics(
  r: CompareResultRow,
  doseScale = 1,
  t?: ThresholdConfig
): Partial<Record<(typeof RESPONSE_METRICS)[number], number | string>> {
  const rs = r.rs
  if (!rs) return {}
  const cc = rs.cc
  let relevance: number | undefined
  if (cc && t?.type === 'curvecurator' && r.log2FC != null && Number.isFinite(r.log2FC)) {
    const a = t.ccCallBy === 'fdr' ? cc.ccAlpha : 10 ** -t.statMin
    const lim = r.log2FC < 0 ? -t.fcLow : t.fcHigh
    if (a != null) relevance = relevanceScore(r.log2FC, cc.f, cc.n, lim, a)
  }
  const ccCols = cc ? { relevance, q_decoy: cc.q } : null
  const d = rs.desc
  if (!d) return { F: rs.F, ...ccCols }
  return {
    pEC50: d.mid > 0 ? -Math.log10(d.mid * doseScale) : NaN,
    EC50: d.mid,
    slope: d.slope,
    front: d.front,
    back: d.back,
    R2: d.r2,
    shape_ratio: d.shapeRatio,
    shape_QC: d.lowShape ? 'low' : 'ok',
    F: rs.F,
    ...ccCols
  }
}

/** The 4PL surface's null: simulated surfaces per design (surfaceNull.ts), for the most common
 *  designs (a design = which cells a surface has — missing values make others); a rarer design
 *  takes the simulated one nearest in cell count (the null depends on the design mostly through
 *  that). 4000 per design pin the tail's fit (benchmarked: p < 0.1% realised 0.10–0.12%). */
const NULL_SIMS = 4000
const NULL_DESIGNS = 4

/**
 * The 4PL surface detector ("CurveCurator in 2-D"), in place of the spline surface's test, on the
 * same surfaces (runSurfaceFit's layout: each treated cell's log₂ effect vs its time's vehicle).
 * Each surface's joint model (surfaceJoint.ts — a dose 4PL whose top and midpoint change with time,
 * 6 parameters) is tested against flat (every effect 0): F = ((RSS₀ − RSS₁)/6) / s², s² the
 * residual variance of the cell effects (which carries condition-level variation that replicate
 * scatter misses), moderated toward an abundance trend across surfaces. The model is non-linear and
 * its parameters are undefined under flat, so F has no textbook null: its p is the adjusted F's —
 * F's tail among flat surfaces simulated on the run's own designs and scored the same way
 * (surfaceNull.ts; fixed seeds, so a re-run gives the same p) — and q is BH over the run. The
 * fitted cells and the peak become the 4PL's.
 *
 * Benchmarked (bench/surface4pl.ts, surface4pl_adjF.ts) against the spline surface: ~28% fewer
 * responders found (a third of the non-monotonic ones), about equal on sigmoid surfaces, far more
 * compute — offered as a choice, not the default. Its FDR holds where the effects carry no pattern
 * shared by every gene (a normalisation artifact inflates it, as it would any per-gene test); with
 * a vehicle at t₀ only it is conservative.
 */
function* scoreJoint4pl(
  rows: SplineRow[],
  interpolation = false
): Generator<JointBatch, Array<{ cc: CcTest; decoy: DecoyCurve | null }>, JointFit[]> {
  const cellsOf = rows.map((r) => {
    const c = r.curve
    const s = c.surface!
    const nG = s.vehicle.length
    return s.treated.map((t, i) => ({
      dose: t.dose,
      time: t.time,
      e: c.y[nG + i] - s.vehicle[t.group].mean
    }))
  })
  // CurveCurator's interpolation, when on, in every fit alike — the surfaces', their simulated
  // nulls' and their decoys' — so the null still matches how the real surfaces are fitted
  const fitted: JointFit[] = yield cellsOf.map((cells, i) => ({
    cells,
    timeOffset: rows[i].curve.surface!.timeOffset,
    interpolation
  }))
  const raws = cellsOf.map((cells, i) => {
    const rss0 = cells.reduce((a, x) => a + x.e * x.e, 0)
    const rss1 = Math.min(rss0, fitted[i].rss)
    const d = cells.length - 6
    return { rss0, rss1, n: cells.length, s2: d > 0 ? rss1 / d : 0, d }
  })
  const prior = fitPrior(
    raws.flatMap((f, i) =>
      f.d > 0 ? [{ s2: f.s2, d: f.d, abundance: rows[i].curve.abundance }] : []
    )
  )
  const stats = raws.map((f, i) =>
    jointF(f.rss0, f.rss1, f.n, prior.d0, prior.s0sq(rows[i].curve.abundance))
  )
  // the designs, most common first; the null simulated for the first few
  const designs = new Map<string, { d: SurfaceDesign; idx: number[] }>()
  rows.forEach((r, i) => {
    const s = r.curve.surface!
    const d: SurfaceDesign = {
      treated: s.treated,
      nGroups: s.vehicle.length,
      timeOffset: s.timeOffset
    }
    const k = designKey(d)
    const g = designs.get(k)
    if (g) g.idx.push(i)
    else designs.set(k, { d, idx: [i] })
  })
  const ranked = [...designs.values()].sort((a, b) => b.idx.length - a.idx.length)
  const simulated = ranked.slice(0, NULL_DESIGNS)
  const batches = simulated.map((g, k) =>
    nullSurfaces(g.d, NULL_SIMS, 20261010 + k).map((b) => ({ ...b, interpolation }))
  )
  const simFits: JointFit[] = yield batches.flat()
  const nulls = batches.map((b, k) => ({
    n: simulated[k].d.treated.length,
    tail: fitNullTail(
      nullF(b, simFits.slice(k * NULL_SIMS, (k + 1) * NULL_SIMS), prior.d0, 20261010 + k)
    )
  }))
  const p = new Array<number>(rows.length).fill(1)
  const tailOf: NullTail[] = new Array(rows.length)
  ranked.forEach((g, k) => {
    const n = g.d.treated.length
    const tail =
      k < nulls.length
        ? nulls[k].tail
        : nulls.reduce((a, b) => (Math.abs(b.n - n) < Math.abs(a.n - n) ? b : a)).tail
    for (const i of g.idx) {
      tailOf[i] = tail
      p[i] = raws[i].d > 0 ? nullSurvival(stats[i].F, tail) : 1
    }
  })
  const q = benjaminiHochberg(p)
  rows.forEach((r, i) => {
    // the row's test and fit become the 4PL's
    const s = r.curve.surface!
    const nG = s.vehicle.length
    const curveFitted = [...r.curve.fitted]
    let peak = 0
    s.treated.forEach((t, k) => {
      const v = jointPredict(fitted[i].params, fitted[i].ubar, t.dose, t.time, s.timeOffset)
      curveFitted[nG + k] = s.vehicle[t.group].mean + v
      if (Math.abs(v) > Math.abs(peak)) peak = v
    })
    r.curve = { ...r.curve, fitted: curveFitted }
    r.peak = peak
    r.F = stats[i].F
    r.df1 = 6
    r.df2 = stats[i].df2
    r.p = p[i]
    r.q = q[i]
  })
  // CurveCurator's decoys, one per surface: its cells flat plus noise at its moderated variance —
  // an effect is a cell mean minus its time's vehicle mean, so each cell's own noise plus its
  // vehicle's, shared by every dose at that time, the variance split evenly between the two — then
  // fitted and scored as the real surfaces (a fixed seed, so a re-run gives the same decoys).
  const R = rng(20261010)
  const normal = (): number => Math.sqrt(-2 * Math.log(1 - R())) * Math.cos(2 * Math.PI * R())
  const decoyCells: JointBatch = rows.map((r, i) => {
    const s = r.curve.surface!
    const s0 = prior.s0sq(r.curve.abundance)
    const f = raws[i]
    const post =
      prior.d0 === Infinity
        ? s0
        : prior.d0 > 0 && Number.isFinite(s0)
          ? (prior.d0 * s0 + f.d * f.s2) / (prior.d0 + f.d)
          : f.s2
    const sd = Math.sqrt(Math.max(post, 0) / 2)
    const veh = s.vehicle.map(() => sd * normal())
    return {
      cells: s.treated.map((t) => ({
        dose: t.dose,
        time: t.time,
        e: sd * normal() - veh[t.group]
      })),
      timeOffset: s.timeOffset,
      interpolation
    }
  })
  const decoyFits: JointFit[] = yield decoyCells
  // Each on CurveCurator's scale: the F a curve of n points (cells + the vehicle) would need for
  // the same adjusted p, its fold change the fitted peak.
  return rows.map((r, i) => {
    const n = raws[i].n + 1
    const cc: CcTest = { f: ccEquivalentF(p[i], n), n }
    if (!(raws[i].d > 0)) return { cc, decoy: null }
    const dc = decoyCells[i]
    const rss0 = dc.cells.reduce((a, x) => a + x.e * x.e, 0)
    const dF = jointF(
      rss0,
      decoyFits[i].rss,
      dc.cells.length,
      prior.d0,
      prior.s0sq(r.curve.abundance)
    ).F
    let peak = 0
    for (const c of dc.cells) {
      const v = jointPredict(decoyFits[i].params, decoyFits[i].ubar, c.dose, c.time, dc.timeOffset)
      if (Math.abs(v) > Math.abs(peak)) peak = v
    }
    return { cc, decoy: { f: ccEquivalentF(nullSurvival(dF, tailOf[i]), n), log2FC: peak, n } }
  })
}
