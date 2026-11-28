/**
 * A Compare's (and a Curve fit's) settings: its analysis, threshold, curve method and effect
 * names, and the upgrades of older saved configs.
 */
import {
  type AxisBaseline,
  type AxisFit,
  axisModelFor,
  type AxisScale,
  type ConditionKey,
  type CondSelector,
  crossPairs,
  isNumericCond,
  numericConds,
  type NumericConds,
  type Pair,
  type ThresholdConfig,
  VALID_CONDITIONS
} from '../../engine'
import type { DoseUnit } from './units'

export interface CompareConfig {
  /** which comparison analysis to run. On a Compare tile, the goal the Compare window picks:
   *  'compare' — the t-test, the explicit numerator / denominator model (a t-test per test group)
   *  — or 'anova' — the compared conditions as the factors of one ANOVA (any
   *  number; one is a one-way ANOVA). A saved 'two_way_anova' reads as 'anova' (see
   *  normalizeCompareConfig). A Curve fit tile is always
   *  'curve_fit' — the same config with `num` as the treatments (one curve per numerator group)
   *  and `den` as the control, the curve's baseline. A Compare saved in curve-fit mode opens as a
   *  Curve fit tile (see migrateCurveCompare). */
  analysis: 'compare' | 'anova' | 'curve_fit'
  method: 'ttest'
  /** t-test on data with batches (defined in Clean data, or the Merge inputs above): each batch
   *  its own comparison — the batch matched like-for-like — rather than one blocked on them, so a
   *  Contrast can pair one batch's fold change against another's (absent = off) */
  splitBatch?: boolean
  /** curve_fit only: the numeric condition the curve runs over (absent = dose) */
  curveAxis?: ConditionKey
  /** curve_fit: an axis's scale as the user set it in the Curve fit window, per condition; absent =
   *  the one its levels' spacing shows (engine detectAxisScale), else its preset's. Set only where
   *  the user overrode the detection, so the rest keeps following the data. Both methods follow it
   *  (one-axis curves; a surface is log on both axes). An ANOVA's slopes read it too (set in the
   *  Compare window). */
  axisScale?: Partial<Record<ConditionKey, AxisScale>>
  /** anova: the compared numeric conditions taken as factors (one level each); every other
   *  compared numeric condition is a slope — the default */
  asFactor?: ConditionKey[]
  /** curve_fit: what an axis's baseline is to its curves, as the user set it in the Curve fit
   *  window, per condition — 'reference' (a control off the curve: the vehicle) or 'matched' (its
   *  own first point: t₀, the lowest temperature — ratio to the lowest level). Absent = the axis's
   *  preset (dose reference, time matched, any other reference); set only where the user picked the
   *  other. Both methods follow it (one-axis curves; a surface keeps the presets'). */
  axisBaseline?: Partial<Record<ConditionKey, AxisBaseline>>
  /** curve_fit: each axis's models as the user set them (a custom method) — the detector's shape,
   *  the descriptor's and on a surface the coupling (engine AxisFit; graph/models/axisFits.ts resolves
   *  them). Absent: the method preset's (`detection`'s detector everywhere, the 4PL descriptor; on
   *  a surface each axis's drift as its baseline gives — a reference axis drifts along a matched
   *  one, two of a kind both drift: engine driftsByDefault). `detection` is kept as what they amount
   *  to (detectionOf). */
  axisFits?: Partial<Record<ConditionKey, AxisFit>>
  /** curve_fit, surfaces: the two numeric conditions — the first runs from the baseline (dose), the
   *  baseline matched at each level of the second (time). Absent: dose × time. */
  surfacePair?: [ConditionKey, ConditionKey]
  /** curve_fit only: the detection model — '4pl' (absent): the CurveCurator method; 'spline': the
   *  response surface method (spline detection, moderated F, 4PL description) */
  detection?: '4pl' | 'spline'
  /** curve_fit: 'custom' when the detector and descriptor were picked by hand rather than by a
   *  method preset; unset = the preset `detection` implies (spline → Hybrid, 4PL → 4PL). See
   *  curveMethodOf. UI only — the run reads the models themselves. */
  curveMethod?: 'custom'
  /** curve_fit by the response surface method: the model every plot below shows — the detector
   *  (spline: its peak, its line) or the descriptor (unset — the description's peak and curve, NA
   *  where undescribed). Display-only: no re-run. See engine/curves/modelView.ts. */
  modelView?: import('../../engine').ModelView
  /** curve_fit, the CurveCurator method (4PL over one axis): its interpolation — the fit also sees
   *  points between the doses, read off straight lines between the measured ratios; the test stays
   *  on the real points. Off (unset) by default, as CurveCurator's own. */
  interpolation?: boolean
  /** curve_fit, spline only: one dose × time surface per gene × compound instead of curves over
   *  `curveAxis` */
  surface?: boolean
  /** curve_fit, surfaces only (legacy — now surfaceIntent decides): describe slice by slice —
   *  drawn per time (absent / 'slices') or per dose ('doseSlices') — or by one joint model
   *  ('joint'). No longer written; a run with surfaceIntent ignores it. */
  surfaceDescription?: 'slices' | 'doseSlices' | 'joint'
  /** curve_fit, surfaces only: what the fit is for — capture the response's shape (absent /
   *  'shape': the surface against flat, the joint description) or test response changes
   *  ('changes': curves along the response axis compared across the other — engine runSliceShift) */
  surfaceIntent?: 'shape' | 'changes'
  /** curve_fit, testing response changes: the axis the curves run along (the other is compared
   *  across) — the user's pick; absent: not picked yet, the run asks for it */
  responseAxis?: ConditionKey
  /** curve_fit, testing response changes with a 4PL along the response axis: the F's null —
   *  the adjusted F (absent / 'adjusted': simulated) or NPARC's df estimated across the genes
   *  ('nparc' — degenerate on log₂ single-replicate data such as the TPP example; parked) */
  changesStat?: 'nparc' | 'adjusted'
  /** curve_fit: describe (4PL — EC50, top) every gene (true), or the responders only (false:
   *  q ≤ DESCRIBE_Q). Unset = every gene under the 4PL detector over one axis (its 4PL is its
   *  test), responders otherwise — see describesAll. Every gene is slower with a separate
   *  descriptor, and a flat curve's EC50 means little — but every gene then has one, e.g. to
   *  contrast pEC50 between two conditions. */
  describeAll?: boolean
  /** curve_fit only: the control is a background treatment (e.g. drug B alone, for drug A
   *  titrated on top of it) rather than the vehicle — confirmed by the user, since a curve's
   *  control is its starting point (see controlIsBaseline) */
  controlBackground?: boolean
  /** Legacy: the dose unit a curve fit used to carry itself. The unit now lives on the Load tile
   *  (LoadConfig.units); this is only read as a fallback for a workflow saved before. */
  doseUnit?: DoseUnit
  /** Unused: a Compare now tests on Clean data's log-transform scale (logged or not). Kept so
   *  older saved workflows still type-check. */
  transform?: boolean
  /** explicit comparison (analysis === 'compare'): the two sides' cond-value selections and
   *  which non-axis conditions must be matched like-for-like (others are pooled). */
  num: CondSelector
  den: CondSelector
  match: ConditionKey[]
  /** explicit comparison, as the Compare dialog states it: the compared conditions (several allowed)
   *  and the context conditions merged into one group on both sides. Absent (configs saved before)
   *  = inferred from the pins, and nothing pooled. */
  compared?: ConditionKey[]
  pool?: ConditionKey[]
  /** Legacy (a 2-way ANOVA saved before the compared conditions named its factors): the two factors
   *  and their numerator/denominator levels — read into num / den / compared on load */
  condition: ConditionKey
  pairNum: string
  pairDen: string
  condition2: ConditionKey
  pair2Num: string
  pair2Den: string
  threshold: ThresholdConfig
  /** display names for the effect classes (legends, tables); absent = "down" / "up" / "none".
   *  Display-only — never stales the result (see setCompareEffectLabels). */
  effectLabels?: EffectLabels
}

/** CurveCurator's default significance: α = 0.05, |curve log₂FC| ≥ 0.5 (as every curve fit's
 *  default fold-change limit), on raw p. */
export const CURVECURATOR_THRESHOLD: Partial<ThresholdConfig> = {
  type: 'curvecurator',
  statType: 'pP',
  statMin: -Math.log10(0.05),
  fcHigh: 0.5,
  fcLow: -0.5
}

/** The response surface method's default call (as the engine's RESPONSE_THRESHOLD): the
 *  hyperbolic boundary on q, P asymptote q = 5%, FC asymptote |log₂FC| = 0.5. */
export const RESPONSE_THRESHOLD_DEFAULT: Partial<ThresholdConfig> = {
  type: 'non-linear',
  statType: 'pQ',
  statMin: -Math.log10(0.05),
  b: 1,
  s0: -0.5,
  fcHigh: 0.5,
  fcLow: -0.5
}

/** The threshold a Curve fit should carry for its detection model `to` (and, `surface`, over
 *  dose × time) — or null when it can stay. The CurveCurator method's curves start on its
 *  relevance score; the response surface method, and any dose × time surface, start on q (a 4PL
 *  surface can then switch to the relevance score, its decoys surfaces). */
/** A Curve fit's method: a preset of its detector and descriptor (Hybrid: spline + 4PL; 4PL: 4PL +
 *  4PL), or 'custom' when they were picked by hand. */
export type CurveMethod = 'hybrid' | '4pl' | 'custom'
export function curveMethodOf(c: Pick<CompareConfig, 'curveMethod' | 'detection'>): CurveMethod {
  return c.curveMethod === 'custom' ? 'custom' : c.detection === 'spline' ? 'hybrid' : '4pl'
}

/** The model a Curve fit's plots show (CompareConfig.modelView): the descriptor unless set. */
export const modelViewOf = (
  c: Pick<CompareConfig, 'modelView'> | undefined
): import('../../engine').ModelView => c?.modelView ?? 'descriptor'

/** Whether a Curve fit describes every gene (else its responders only): its setting, else every
 *  gene under the 4PL detector over one axis — its 4PL is its test, so already fitted — and the
 *  responders otherwise. `surface` = the run is a dose × time surface. */
export function describesAll(
  c: Pick<CompareConfig, 'describeAll' | 'detection'>,
  surface: boolean
): boolean {
  return c.describeAll ?? (c.detection !== 'spline' && !surface)
}

export function thresholdForDetection(
  to: NonNullable<CompareConfig['detection']>,
  t: ThresholdConfig,
  surface = false
): ThresholdConfig | null {
  if (to === 'spline' || surface)
    return t.type === 'curvecurator' ? { ...t, ...RESPONSE_THRESHOLD_DEFAULT } : null
  return t.type === 'curvecurator' ? null : { ...t, ...CURVECURATOR_THRESHOLD }
}

/** The threshold a Compare should carry after switching its analysis from `from` to `to` — or null
 *  when it can stay. A curve fit starts on CurveCurator's relevance score (its own defaults); a
 *  method the new analysis can't run (CurveCurator outside a curve fit, SAM outside a t-test)
 *  falls back to the p-value route's hyperbolic boundary, FDR-controlled. */
export function thresholdForAnalysis(
  from: CompareConfig['analysis'],
  to: CompareConfig['analysis'],
  t: ThresholdConfig
): ThresholdConfig | null {
  if (to === 'curve_fit' && from !== 'curve_fit') return { ...t, ...CURVECURATOR_THRESHOLD }
  const unsupported =
    (t.type === 'curvecurator' && to !== 'curve_fit') || (t.type === 'sam_fdr' && to !== 'compare')
  return unsupported ? { ...t, type: 'non-linear', statType: 'pQ' } : null
}

export interface EffectLabels {
  down: string
  up: string
  /** the genes called neither (not significant) */
  none: string
}

export const DEFAULT_EFFECT_LABELS: EffectLabels = { down: 'down', up: 'up', none: 'none' }
/** A Compare's effect names with defaults filled in (blank entries fall back too). */
export const effectLabelsOf = (
  c: Pick<CompareConfig, 'effectLabels'> | undefined
): EffectLabels => ({
  down: c?.effectLabels?.down?.trim() || DEFAULT_EFFECT_LABELS.down,
  up: c?.effectLabels?.up?.trim() || DEFAULT_EFFECT_LABELS.up,
  none: c?.effectLabels?.none?.trim() || DEFAULT_EFFECT_LABELS.none
})

/** Migrate any stored Compare config (incl. legacy veh_norm/direct) to the explicit model.
 *  Pure — safe to call on every read; returns the input unchanged when already migrated. */
export function normalizeCompareConfig(c: CompareConfig): CompareConfig {
  const n = normalizeAnalysis(c)
  // Threshold: configs saved before the asymmetric switch existed could hold hand-typed unequal
  // FC cutoffs. Flag those asymmetric so the switch reflects (and the store preserves) them,
  // instead of silently mirroring the down cutoff off the up one.
  const t = n.threshold
  if (t && t.asymmetric === undefined) {
    const unequal =
      t.type === 'non-linear' ? t.s0Down != null && t.s0Down !== t.s0 : t.fcLow !== -t.fcHigh
    if (unequal) return { ...n, threshold: { ...t, asymmetric: true } }
  }
  return n
}

function normalizeAnalysis(c: CompareConfig): CompareConfig {
  const analysis = c.analysis as string
  // Legacy veh_norm: treatment vs vehicle compound, vehicle matched on everything but dose.
  if (analysis === 'veh_norm') {
    return {
      ...c,
      analysis: 'compare',
      num: c.pairNum ? { cmpd: [c.pairNum] } : {},
      den: c.pairDen ? { cmpd: [c.pairDen] } : {},
      match: VALID_CONDITIONS.filter((k) => k !== 'cmpd' && k !== 'dose')
    }
  }
  // Legacy direct: two levels of one condition, matched like-for-like on every other condition.
  if (analysis === 'direct') {
    const cond = c.condition
    return {
      ...c,
      analysis: 'compare',
      num: c.pairNum ? { [cond]: [c.pairNum] } : {},
      den: c.pairDen ? { [cond]: [c.pairDen] } : {},
      match: VALID_CONDITIONS.filter((k) => k !== cond)
    }
  }
  // Legacy 2-way ANOVA → the ANOVA, its two factors the compared conditions; one saved with the
  // factor fields only has them mirrored into num/den selectors.
  if (analysis === 'two_way_anova') {
    const legacy =
      !(c.num && Object.keys(c.num).length) && c.pairNum && c.pairDen && c.pair2Num && c.pair2Den
    return {
      ...c,
      analysis: 'anova',
      num: legacy ? { [c.condition]: [c.pairNum], [c.condition2]: [c.pair2Num] } : (c.num ?? {}),
      den: legacy ? { [c.condition]: [c.pairDen], [c.condition2]: [c.pair2Den] } : (c.den ?? {}),
      match: c.match ?? [],
      compared: c.compared?.length ? c.compared : [c.condition, c.condition2].filter(Boolean),
      // it ran its numeric conditions as factors: keep them so (a slope is the ANOVA's default)
      asFactor: c.asFactor ?? (c.compared?.length ? c.compared : [c.condition, c.condition2])
    }
  }
  // Already explicit: return unchanged when the new fields exist, else backfill.
  if (c.num && c.den && c.match) return c
  return { ...c, num: c.num ?? {}, den: c.den ?? {}, match: c.match ?? [] }
}

/** Whether a Compare tile's comparison is fully defined (numerator + denominator pinned; for an
 *  ANOVA, a test level and a control for each factor). Drives the tile's ready/blocked state. */
export function isCompareConfigured(config: CompareConfig): boolean {
  const cfg = normalizeCompareConfig(config)
  const pinned = (s: CondSelector): boolean =>
    Object.values(s).some((v) => v != null && v.length > 0)
  if (cfg.analysis === 'compare' || cfg.analysis === 'curve_fit')
    return pinned(cfg.num) && pinned(cfg.den)
  return anovaFactorsOf(cfg, numericConds()).length > 0
}

/** An ANOVA's factors: each compared condition with its test × control level pairs — a numeric
 *  one (`numeric`, the dataset's schema) a slope unless taken as a factor (`asFactor`), on its
 *  scale (slopeScaleOf). None when one has no pair (nothing picked on a side). */
export function anovaFactorsOf(
  cfg: Pick<CompareConfig, 'compared' | 'num' | 'den' | 'asFactor' | 'axisScale'>,
  numeric: NumericConds
): Array<{ condition: ConditionKey; pairs: Pair[]; slope?: AxisScale }> {
  const factors = (cfg.compared ?? []).map((c) => {
    const pairs = crossPairs(cfg.num[c] ?? [], cfg.den[c] ?? [])
    return isNumericCond(c, numeric) && !cfg.asFactor?.includes(c)
      ? { condition: c, pairs, slope: slopeScaleOf(cfg, c) }
      : { condition: c, pairs }
  })
  return factors.length && factors.every((f) => f.pairs.length) ? factors : []
}

/** A slope's axis scale: as the user set it (`axisScale`), else what its picked levels' spacing
 *  shows — linear when it can't tell — as the Curve fit decides it. */
export function slopeScaleOf(
  cfg: Pick<CompareConfig, 'num' | 'den' | 'axisScale'>,
  c: ConditionKey
): AxisScale {
  const levels = [...(cfg.num[c] ?? []), ...(cfg.den[c] ?? [])].map(Number)
  return axisModelFor(c, undefined, cfg.axisScale?.[c], levels).scale
}
