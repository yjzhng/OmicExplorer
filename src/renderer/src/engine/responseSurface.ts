/**
 * Curve fit by the response surface method: the spline detector (splineFit.ts) turned into the app's
 * comparison table. Over one axis (dose or time) one row per curve — gene × compound × context, as
 * the CurveCurator method's rows; over dose × time one row per surface — gene × compound ×
 * context, tested once. Each row carries the standard columns (log2FC = the fitted peak, pP = the
 * moderated F's p, pQ = its q: BH × Storey's π₀ over the run), so the table, the volcano and the
 * threshold's calls work as for any comparison, and its fit in `rs`: the levels, the spline, and —
 * for curves within the describe cutoff — the 4PL description.
 */
import { axisModelFor, baseLevelOf, driftsByDefault, toX, type AxisShape } from './axisModel'
import { NO_PROGRESS, type ProgressTracker } from './progress'
import { condValue, finaliseCompare, numValue, setCond, type RawStatRow } from './compare'
import { condLabel, numericConds } from './types'
import {
  applyCurveFdr,
  ccEquivalentF,
  classifyCompareRow,
  curveGroupKey,
  DESCRIBE_Q,
  relevanceScore,
  type CcTest,
  type DecoyCurve
} from './curveFit'
import { baselineText, driveSync, selectorMatch, type CompareTableResult } from './direct'
import {
  describeCurve,
  describeSurface,
  fitPrior,
  jointSpecOf,
  runSliceShift,
  runSplineFit,
  runSurfaceFit,
  surfaceMaps,
  type SplineRow,
  type SplineRun,
  type SurfaceDescribe,
  type SliceStat,
  type SurfaceMethod,
  type SurfacePlan
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
import {
  fitJointBatch,
  jointAt,
  jointParamCount,
  type JointBatch,
  type JointFit,
  type JointSpec
} from './surfaceJoint'
import type {
  CompareInput,
  CompareResultRow,
  CondSelector,
  ConditionKey,
  ResponseFit,
  StandardRow
} from './types'

/** The response surface method's default call: the hyperbolic boundary on q — P asymptote
 *  q = 5%, FC asymptote |peak log₂FC| = 0.5 (stored s0 = −0.5), b = 1. */
export const RESPONSE_THRESHOLD: ThresholdConfig = {
  ...DEFAULT_THRESHOLD,
  type: 'non-linear',
  statType: 'pQ',
  statMin: -Math.log10(0.05),
  b: 1,
  s0: -0.5,
  fcLow: -0.5,
  fcHigh: 0.5
}

export { DESCRIBE_Q }

export interface ResponseInput extends Omit<CompareInput, 'curveAxis'> {
  /** the curve's axis, or 'surface' for one two-axis surface per gene × compound */
  curveAxis: ConditionKey | 'surface'
  /** surfaces: the two numeric conditions — the first runs from the vehicle (dose), the vehicle is
   *  measured at levels of the second (time). Absent: dose × time. */
  surfacePair?: [ConditionKey, ConditionKey]
  /** surfaces: describe slice by slice (default) or by one joint model */
  surfaceDescription?: SurfaceMethod
  /** surfaces: detect with the spline surface (default) or with the 4PL surface — the joint model
   *  vs flat, its adjusted F (see scoreJoint4pl) */
  detector?: 'spline' | '4pl'
  /** surfaces: what the fit is for — capture the response's shape (default: the surface against
   *  flat, described by the joint model) or test response changes (the curves along the response
   *  axis compared across the other: runSliceShift, described slice by slice) */
  intent?: 'shape' | 'changes'
  /** test response changes: the axis the curves run along, as the user picked it (required) */
  responseAxis?: ConditionKey
  /** test response changes with a 4PL along the response axis: the F's null — the adjusted F
   *  (default) or NPARC's df */
  changesStat?: SliceStat
}

/** The control's samples stand in a surface run under this compound name, so a control that is
 *  the treatment's own compound at dose 0 (or t₀) can't be mistaken for a treated sample. */
const CONTROL = '\u0000control'

export function runResponseSurface(
  input: ResponseInput,
  progress: ProgressTracker = NO_PROGRESS
): CompareTableResult {
  // the joint fits one by one, each counted (progress)
  return driveSync(responseSurfaceSteps(input, progress), (b) =>
    b.map((j) => {
      const f = fitJointBatch([j])[0]
      progress.add(1)
      return f
    })
  )
}

/** runResponseSurface as steps: the 4PL surface detector's fits (its surfaces', then its decoys')
 *  handed out as batches (JointBatch) to be fitted wherever the driver likes — in place, or over
 *  the worker pool. The fits are pure, so either way the result is the same. */
export function* responseSurfaceSteps(
  input: ResponseInput,
  progress: ProgressTracker = NO_PROGRESS
): Generator<JointBatch, CompareTableResult, JointFit[]> {
  const threshold = input.threshold ?? RESPONSE_THRESHOLD
  // (the detector is the surface's own business, not the comparison's)
  const { curveAxis, detector: _detector, ...cmp } = input
  void _detector
  const plan = curveAxis === 'surface' ? surfacePlanOf(input) : null
  const changes = !!plan && input.intent === 'changes'
  // the axis the curves run along is the user's pick — nothing is assumed
  if (changes && (!input.responseAxis || ![plan.a, plan.b].includes(input.responseAxis)))
    throw new Error('Pick the axis the curves run along (Configure curve fit › axis).')
  // a surface is detected by the joint model (non-linear: its adjusted F) when an axis's detector
  // is the 4PL; by the tensor-product spline / line / constant (moderated F) otherwise. Testing
  // response changes: the slices against their shared curve (runSliceShift).
  const nonlinear = !changes && !!plan && planDetect(input, plan).includes('4pl')
  const parts = plan
    ? surfaceParts(
        cmp,
        plan,
        progress,
        nonlinear,
        changes ? input.responseAxis : undefined,
        input.changesStat,
        // the response axis's own shape (the plan's detect holds a 4PL as the spline's columns)
        changes ? planDetect(input, plan)[input.responseAxis === plan.b ? 1 : 0] : undefined
      )
    : [oneAxisPart(cmp, curveAxis as ConditionKey, progress)]
  const cc =
    plan && nonlinear
      ? yield* scoreJoint4pl(
          parts.flatMap((p) => p.run.rows),
          !!input.interpolation,
          surfaceDescribeOf(input, plan, 'detect'),
          progress
        )
      : null
  const raw: RawStatRow[] = []
  const fits: ResponseFit[] = []
  const qs: number[] = []
  const comparisons: string[] = []
  // Describing the surfaces (4PL slices or the joint model, fitOf) is a stage of its own — on a
  // large run it takes as long as the detection did, and would otherwise sit on its last count.
  const describes = (r: SplineRow): boolean => !!input.describeAll || r.q <= DESCRIBE_Q
  const toDescribe = parts.reduce((a, p) => a + p.run.rows.filter(describes).length, 0)
  if (toDescribe) {
    progress.stage(plan ? 'Describing surfaces' : 'Describing curves')
    progress.plan(toDescribe)
  }
  for (const { run, cmpCond, label, context } of parts) {
    for (const r of run.rows) {
      // the 4PL detector's joint fit of this surface (its rows in the same order as these)
      const detected = cc?.[fits.length].fit
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
      const fit = fitOf(r, input, detected, plan)
      if (describes(r)) progress.add(1)
      fits.push(r.baseline ? { ...fit, baseline: r.baseline } : fit)
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

function oneAxisPart(input: CompareInput, axis: ConditionKey, progress: ProgressTracker): Part {
  const run = runSplineFit({ ...input, curveAxis: axis }, progress)
  return { run, cmpCond: run.cmpCond ?? 'cmpd', label: `${condLabel(axis)} curve`, context: {} }
}

/** A surface run's axes: the pair (dose × time unless set), each one's model — its scale as set,
 *  else detected from its levels; its baseline as set, else its preset — and its detector's shape
 *  (as set, else the method's: the 4PL detector's, or the spline). The spline surface's columns
 *  along a 4PL axis are the spline's (the joint model then tests it). */
function surfacePlanOf(input: ResponseInput): SurfacePlan {
  const [a, b] = input.surfacePair ?? ['dose', 'time']
  const model = (c: ConditionKey) => {
    const levels = input.rows.map((r) => numValue(r, c)).filter((v): v is number => v != null)
    return axisModelFor(c, undefined, input.axisScales?.[c], levels, input.axisBaselines?.[c])
  }
  const det = planDetect(input, { a, b } as SurfacePlan)
  const basis = (sh: AxisShape): AxisShape => (sh === '4pl' ? 'spline' : sh)
  // One position: the control pinned on both axes (dose 0 at the lowest temperature) — every
  // other cell is measured against it. Else the second axis's first point over the whole dataset
  // (a pin may filter t₀ out of the runs).
  const position = !!input.den[a]?.length && !!input.den[b]?.length
  const bBase = position
    ? Number(input.den[b]![0])
    : baseLevelOf(input.rows.map((r) => numValue(r, b)))
  return {
    a,
    b,
    models: [model(a), model(b)],
    detect: [basis(det[0]), basis(det[1])],
    bBase,
    ...(position ? { position: true } : null)
  }
}
/** Each surface axis's detector shape, as set, else the method's. */
function planDetect(
  input: ResponseInput,
  plan: Pick<SurfacePlan, 'a' | 'b'>
): [AxisShape, AxisShape] {
  const method: AxisShape = input.detector === '4pl' ? '4pl' : 'spline'
  return [input.axisFits?.[plan.a]?.detect ?? method, input.axisFits?.[plan.b]?.detect ?? method]
}
/** The joint model's shapes for a surface — its detector's ('detect': a spline axis takes the 4PL
 *  in the non-linear model) or its descriptor's — and the couplings (unset: as each axis's baseline
 *  gives, driftsByDefault). */
function surfaceDescribeOf(
  input: ResponseInput,
  plan: Pick<SurfacePlan, 'a' | 'b' | 'models'>,
  which: 'detect' | 'describe'
): SurfaceDescribe {
  const f = (c: ConditionKey) => input.axisFits?.[c]
  const shapes: SurfaceDescribe['shapes'] =
    which === 'detect'
      ? (planDetect(input, plan).map((sh) => (sh === 'spline' ? '4pl' : sh)) as [
          AxisShape,
          AxisShape
        ])
      : [f(plan.a)?.describe ?? '4pl', f(plan.b)?.describe ?? '4pl']
  const [ba, bb] = [plan.models[0].baseline, plan.models[1].baseline]
  return {
    shapes,
    coupled: [
      f(plan.a)?.coupled ?? driftsByDefault(ba, bb),
      f(plan.b)?.coupled ?? driftsByDefault(bb, ba)
    ]
  }
}

/**
 * Two axes (dose × time, or the pair set): one surface per gene × compound. The treatments are the
 * numerator's rows and the control the denominator's, both over every level of the two (their
 * pins on them don't apply — the surface spans them). Any other condition that varies (e.g. cell
 * line) splits the run, one surface per gene × compound × its value; the control is matched to it
 * where it varies too. The control is a compound (the vehicle), or — the denominator pinned to a
 * level of the first axis (dose 0) — each compound's own at that level, at every level of the
 * second: then the first axis's pins stay and each compound is its own run, against its own. A pin
 * of the second axis on the curves is a filter: the surface spans just those levels, on both sides
 * (its baseline is still each level's own — a pin on the control alone is ignored).
 */
function surfaceParts(
  input: CompareInput,
  plan: SurfacePlan,
  progress: ProgressTracker = NO_PROGRESS,
  nonlinear = false,
  /** test response changes, along this axis; absent: the surface */
  changes?: ConditionKey,
  /** …with a 4PL along it: the F's null */
  changesStat?: SliceStat,
  /** …its shape along the response axis */
  responseShape?: AxisShape
): Part[] {
  const { a: A, b: B } = plan
  const active = input.activeConditions
  const zeroRef = (input.den[A]?.length ?? 0) > 0
  // Testing changes compares the vehicle's whole curve (dose 0 at every level of the other axis)
  // with the treated ones', so a picked position only sets where the plot is drawn from: the
  // control is taken at every level, as against the vehicle at each.
  const position = !!plan.position && changes === undefined
  // The surface spans both axes, so their pins don't select rows — except the control's own: its
  // level of the first axis (dose 0), and against one position its level of the second too. The
  // curves keep the first axis's pins only while the control is each level's own (against one
  // position its base level is a cell too).
  const free = (sel: CondSelector, control: boolean): CondSelector => {
    const rest: CondSelector = { ...sel }
    delete rest[A]
    delete rest[B]
    if (control && position && sel[B]) rest[B] = sel[B]
    return zeroRef && sel[A] && (control || !position) ? { ...rest, [A]: sel[A] } : rest
  }
  const kept = input.num[B]?.length ? new Set(input.num[B]!.map(String)) : null
  const inTime = (r: StandardRow): boolean => !kept || kept.has(String(condValue(r, B) ?? ''))
  const numRows = input.rows.filter(
    (r) => inTime(r) && selectorMatch(free(input.num, false), r, active)
  )
  const denRows = input.rows.filter(
    (r) => inTime(r) && selectorMatch(free(input.den, true), r, active)
  )
  const splitOn = active.filter(
    (c) =>
      (c !== 'cmpd' || zeroRef) &&
      c !== A &&
      c !== B &&
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
    ? `${condLabel(A)} ${input.den[A]![0]}`
    : [...new Set(denRows.map((r) => r.cmpd))].join('/') || 'control'
  const out: Part[] = []
  const genes = [...groups.values()].map((g) => new Set(g.map((r) => r.uniqID)).size)
  progress.stage('Fitting spline surfaces')
  progress.plan(genes.reduce((a, n) => a + n, 0))
  // the 4PL detector's fits to come after (re-set exactly once known — scoreJoint4pl): about one
  // surface per gene × compound, twice (its fit and its decoy), and the null's simulations
  if (nonlinear) {
    const surfaces = [...groups.values()].reduce(
      (a, g, i) => a + genes[i] * new Set(g.map((r) => r.cmpd)).size,
      0
    )
    progress.plan(2 * surfaces + NULL_SIMS)
  }
  // The conditions the control varies on, worked out once (per group and control row it was
  // quadratic in the control's rows: minutes on a large dataset, before the first fit).
  const ctlVaries = splitOn.filter(
    (c) => new Set(denRows.map((x) => String(condValue(x, c) ?? ''))).size > 1
  )
  for (const grp of groups.values()) {
    const rep = grp[0]
    // The control at this context where it varies with it; all of it where it doesn't.
    const want = ctlVaries.map((c) => String(condValue(rep, c) ?? ''))
    const ctl = denRows.filter((d) =>
      ctlVaries.every((c, i) => String(condValue(d, c) ?? '') === want[i])
    )
    if (ctl.length === 0) continue
    const cmpds = [...new Set(grp.map((r) => r.cmpd))]
    const runInput = {
      rows: [...grp, ...ctl.map((r) => ({ ...r, cmpd: CONTROL }))],
      num: { cmpd: cmpds },
      den: { cmpd: [CONTROL] }
    }
    const run =
      changes !== undefined
        ? runSliceShift(runInput, plan, changes, progress, changesStat, responseShape)
        : runSurfaceFit(runInput, plan, progress)
    const baseline = baselineText(ctl, grp, numericConds(input.numericConditions))
    for (const r of run.rows) {
      r.comparison = `${r.cmpd} | ${denLabel}`
      r.baseline = baseline
    }
    out.push({
      run,
      cmpCond: 'cmpd',
      label: `${condLabel(A)} × ${condLabel(B)} | ${denLabel}`,
      context: Object.fromEntries(
        splitOn.filter((c) => c !== 'cmpd').map((c) => [c, condValue(rep, c)])
      )
    })
  }
  return out
}

/** What a response change mostly is, by the share of the slices' difference that is consistent
 *  offset: drift (≥ ⅔), a change of shape (≤ ⅓ — a stability change in TPP), or both. Untuned. */
export const shiftKind = (driftShare: number): 'drift' | 'shape' | 'both' =>
  driftShare >= 2 / 3 ? 'drift' : driftShare <= 1 / 3 ? 'shape' : 'both'

/** A row's fit for the table: the levels and the spline (a 4PL surface: its joint 4PL), plus the
 *  description when its q is within DESCRIBE_Q (or every row's, with describeAll). `detected` is
 *  the 4PL surface detector's fit, handed to the description to reuse. */
function fitOf(
  r: SplineRow,
  input: ResponseInput,
  detected?: JointFit,
  plan?: SurfacePlan | null
): ResponseFit {
  const c = r.curve
  const base = { F: r.F, df1: r.df1, df2: r.df2 }
  const describe = !!input.describeAll || r.q <= DESCRIBE_Q
  if (c.surface) {
    const s = c.surface
    const nG = s.vehicle.length
    // How it's described: testing changes, each slice's own curve along the response axis (drawn
    // per level of the compared one); capturing the shape, the joint model — slices when an axis
    // has no shape to build it from (or a run asked for slices: tests, older configs).
    const how0 = plan ? surfaceDescribeOf(input, plan, 'describe') : undefined
    // testing changes: only the curves along the response axis are described (one per level of
    // the other) — the other direction's slices answer no question asked, so none are fitted
    const how: SurfaceDescribe | undefined =
      how0 && c.shift && plan
        ? {
            ...how0,
            shapes:
              c.shift.response === plan.b ? ['none', how0.shapes[1]] : [how0.shapes[0], 'none']
          }
        : how0
    const sliceMethod: SurfaceMethod | undefined = c.shift
      ? c.shift.response === plan?.b
        ? 'doseSlices'
        : 'slices'
      : undefined
    const method = sliceMethod ?? input.surfaceDescription ?? (input.intent ? 'joint' : undefined)
    const desc = describe
      ? (describeSurface(c, undefined, method, !!input.interpolation, detected, how) ??
        (method === 'joint'
          ? describeSurface(c, undefined, 'slices', !!input.interpolation, detected, how)
          : null))
      : null
    return {
      axis: 'surface',
      ...(detected ? { detector: '4pl' as const } : null),
      ...base,
      timeOffset: s.timeOffset,
      ...surfaceAxesOf(s),
      cells: s.treated.map((t, i) => ({
        dose: t.dose,
        time: t.time,
        y: c.y[nG + i] - s.vehicle[t.group].mean,
        fitted: c.fitted[nG + i] - s.vehicle[t.group].mean
      })),
      ...(s.samples?.length
        ? {
            controls: s.samples.map((sm) => {
              const vm = s.vehicle[sm.group].mean
              const reps = sm.v.map((v) => v - vm)
              return {
                dose: sm.dose,
                time: sm.time,
                y: reps.reduce((a, v) => a + v, 0) / reps.length,
                reps,
                ...(sm.vehicle ? { vehicle: true as const } : null)
              }
            })
          }
        : null),
      ...(c.shift ? { shift: { ...c.shift, kind: shiftKind(c.shift.driftShare) } } : null),
      ...(desc ? { surface: desc } : null)
    }
  }
  const axis = c.scale?.axis ?? (input.curveAxis as ConditionKey)
  const desc = describe
    ? describeCurve(c, undefined, !!input.interpolation, input.axisFits?.[axis]?.describe)
    : null
  return {
    axis,
    ...base,
    x: c.x,
    y: c.y,
    fitted: c.fitted,
    ...(c.line ? { line: c.line } : null),
    ...(c.scale?.offset ? { timeOffset: c.scale.offset } : null),
    ...(c.scale?.scale === 'linear' ? { scale: 'linear' as const, step: c.scale.step } : null),
    ...(desc ? { desc } : null)
  }
}

/** A surface's axes for its stored fit — the pair and how each one's levels map to x — unless
 *  they're dose × time on log axes against the vehicle at each time (every surface fitted before
 *  any pair could be, read as that). */
function surfaceAxesOf(
  s: NonNullable<SplineRow['curve']['surface']>
): Pick<ResponseFit, 'pair' | 'maps'> | null {
  const ax = s.axes
  if (!ax) return null
  const [ma, mb] = surfaceMaps(s)
  const legacy =
    !s.position &&
    ax[0].axis === 'dose' &&
    ax[1].axis === 'time' &&
    ma.scale === 'log' &&
    ma.baseline === 'reference' &&
    ma.offset === 0 &&
    mb.scale === 'log' &&
    mb.baseline === 'matched' &&
    ax[0].detect === 'spline' &&
    ax[1].detect === 'spline'
  if (legacy) return null
  const stored = (m: typeof ma, base: number) => ({
    ...(m.scale === 'linear' ? { scale: 'linear' as const, step: m.step } : null),
    ...(m.offset ? { timeOffset: m.offset } : null),
    ...(m.zeroX != null ? { zeroX: m.zeroX } : null),
    baseline: m.baseline,
    base
  })
  return {
    pair: [ax[0].axis, ax[1].axis],
    maps: [stored(ma, ax[0].base), stored(mb, ax[1].base)]
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
  'q_decoy',
  'change',
  'drift',
  'shape',
  'mid_shift',
  'plateau_shift'
] as const

/** A surface tested for response changes: what kind of change (drift, shape or both), its sizes
 *  (log₂), and — where the slices are described by the 4PL — how a slice's curve moved from the base
 *  slice's: the largest shift of its midpoint (response axis units: ΔTm in TPP) and of its far
 *  plateau (log₂: in TPP, more — or less — protein left soluble at the top temperatures, which is
 *  how a stabilisation often shows rather than as a midpoint shift). */
function shiftMetrics(
  rs: ResponseFit
): Partial<Record<'change' | 'drift' | 'shape' | 'mid_shift' | 'plateau_shift', number | string>> {
  const sh = rs.shift
  if (!sh) return {}
  const d = rs.surface
  // the slices along the response axis: per level of the compared one
  const slices = d ? (sh.response === rs.pair?.[1] ? d.byDose : d.byTime) : []
  const ok = slices.filter((s) => Number.isFinite(s.mid)).sort((a, b) => a.at - b.at)
  // the largest change of a parameter from the base slice's, signed
  const largest = (of: (s: (typeof ok)[number]) => number): number => {
    let v = NaN
    for (const s of ok.slice(1)) {
      const dv = of(s) - of(ok[0])
      if (Number.isFinite(dv) && !(Math.abs(dv) <= Math.abs(v))) v = dv
    }
    return v
  }
  const label = { drift: 'drift', shape: 'shape change', both: 'drift + shape' }[sh.kind]
  return {
    change: label,
    drift: sh.drift,
    shape: sh.shape,
    mid_shift: largest((s) => s.mid),
    plateau_shift: largest((s) => s.back)
  }
}

/**
 * A response surface method row's metrics for tables and exports: its moderated F, and for a
 * described one-axis curve its 4PL — potency (EC50 in the axis's units; on a log axis also pEC50 =
 * −log₁₀ of it, in molar given a molar unit's scale — on a linear one EC50 only), slope, plateaus (log₂ vs the control), R² and how much of the
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
  if (!d) return { F: rs.F, ...ccCols, ...shiftMetrics(rs) }
  // On a log axis the potency is pEC50 (molar where the unit is), on a linear one EC50 in its units.
  // a line has no potency: its slope (per step on a linear axis, per log₁₀ unit on a log one) and
  // its change at the last level
  if (d.model === 'linear')
    return {
      slope: d.slope,
      back: d.back,
      R2: d.r2,
      shape_ratio: d.shapeRatio,
      shape_QC: d.lowShape ? 'low' : 'ok',
      F: rs.F,
      ...ccCols
    }
  return {
    ...(rs.scale === 'linear' ? null : { pEC50: d.mid > 0 ? -Math.log10(d.mid * doseScale) : NaN }),
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
  interpolation = false,
  how?: SurfaceDescribe,
  progress: ProgressTracker = NO_PROGRESS
): Generator<
  JointBatch,
  Array<{ cc: CcTest; decoy: DecoyCurve | null; fit: JointFit }>,
  JointFit[]
> {
  // each surface's cells on its own axes (dose × time: log₁₀ dose, log₁₀(t + offset)) and its model
  const specs: JointSpec[] = rows.map((r) => jointSpecOf(r.curve.surface!, how)!)
  const ks = specs.map(jointParamCount)
  const cellsOf = rows.map((r) => {
    const c = r.curve
    const s = c.surface!
    const [ma, mb] = surfaceMaps(s)
    const nG = s.vehicle.length
    return s.treated.map((t, i) => ({
      xa: toX(ma, t.dose),
      xb: toX(mb, t.time),
      e: c.y[nG + i] - s.vehicle[t.group].mean
    }))
  })
  // CurveCurator's interpolation, when on, in every fit alike — the surfaces', their simulated
  // nulls' and their decoys' — so the null still matches how the real surfaces are fitted
  // what's left, exactly: each surface's fit, the null's simulations (one set per common design,
  // up to NULL_DESIGNS) and each surface's decoy
  const nDesigns = new Set(
    rows.map((r, i) =>
      designKey({
        treated: cellsOf[i].map((c, k) => ({
          xa: c.xa,
          xb: c.xb,
          group: r.curve.surface!.treated[k].group
        })),
        nGroups: r.curve.surface!.vehicle.length,
        spec: specs[i]
      })
    )
  ).size
  progress.remaining(2 * cellsOf.length + Math.min(nDesigns, NULL_DESIGNS) * NULL_SIMS)
  progress.stage('Fitting 4PL surfaces')
  const fitted: JointFit[] = yield cellsOf.map((cells, i) => ({
    cells,
    spec: specs[i],
    interpolation
  }))
  const raws = cellsOf.map((cells, i) => {
    const rss0 = cells.reduce((a, x) => a + x.e * x.e, 0)
    const rss1 = Math.min(rss0, fitted[i].rss)
    const d = cells.length - ks[i]
    return { rss0, rss1, n: cells.length, s2: d > 0 ? rss1 / d : 0, d }
  })
  const prior = fitPrior(
    raws.flatMap((f, i) =>
      f.d > 0 ? [{ s2: f.s2, d: f.d, abundance: rows[i].curve.abundance }] : []
    )
  )
  const stats = raws.map((f, i) =>
    jointF(f.rss0, f.rss1, f.n, prior.d0, prior.s0sq(rows[i].curve.abundance), ks[i])
  )
  // the designs, most common first; the null simulated for the first few
  const designs = new Map<string, { d: SurfaceDesign; idx: number[] }>()
  rows.forEach((r, i) => {
    const s = r.curve.surface!
    const d: SurfaceDesign = {
      treated: cellsOf[i].map((c, k) => ({ xa: c.xa, xb: c.xb, group: s.treated[k].group })),
      nGroups: s.vehicle.length,
      spec: specs[i]
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
  progress.stage('Simulating the null')
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
    cellsOf[i].forEach((t, k) => {
      const v = jointAt(fitted[i].params, fitted[i].ubar, t.xa, t.xb)
      curveFitted[nG + k] = s.vehicle[s.treated[k].group].mean + v
      if (Math.abs(v) > Math.abs(peak)) peak = v
    })
    r.curve = { ...r.curve, fitted: curveFitted }
    r.peak = peak
    r.F = stats[i].F
    r.df1 = ks[i]
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
      cells: cellsOf[i].map((t, k) => ({
        xa: t.xa,
        xb: t.xb,
        e: sd * normal() - veh[s.treated[k].group]
      })),
      spec: specs[i],
      interpolation
    }
  })
  progress.stage('Fitting decoy surfaces')
  const decoyFits: JointFit[] = yield decoyCells
  // Each on CurveCurator's scale: the F a curve of n points (cells + the vehicle) would need for
  // the same adjusted p, its fold change the fitted peak.
  return rows.map((r, i) => {
    const n = raws[i].n + 1
    const cc: CcTest = { f: ccEquivalentF(p[i], n), n }
    if (!(raws[i].d > 0)) return { cc, decoy: null, fit: fitted[i] }
    const dc = decoyCells[i]
    const rss0 = dc.cells.reduce((a, x) => a + x.e * x.e, 0)
    const dF = jointF(
      rss0,
      decoyFits[i].rss,
      dc.cells.length,
      prior.d0,
      prior.s0sq(r.curve.abundance),
      ks[i]
    ).F
    let peak = 0
    for (const c of dc.cells) {
      const v = jointAt(decoyFits[i].params, decoyFits[i].ubar, c.xa, c.xb)
      if (Math.abs(v) > Math.abs(peak)) peak = v
    }
    return {
      cc,
      decoy: { f: ccEquivalentF(nullSurvival(dF, tailOf[i]), n), log2FC: peak, n },
      fit: fitted[i]
    }
  })
}
