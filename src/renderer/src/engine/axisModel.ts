/**
 * The axis model: how a numeric condition's levels become a curve's x, and what its ratios are
 * taken against (docs/curve_fit_framework.md). A curve-fit matter, not a property of the condition:
 * the fits never branch on the axis's name, only on its model, and dose and time are two presets of
 * it.
 *
 * Two properties:
 *  - scale: 'log' (x = log₁₀ of the level: a dilution series, geometrically sampled time) or
 *    'linear' (x = the level in its own units, counted in steps of its spacing: temperature, pH,
 *    evenly sampled time, or values supplied already logged, such as log₁₀ M). Detected from the
 *    levels' spacing (detectAxisScale) for every axis, dose and time too; the Curve fit shows it and
 *    can override it.
 *  - baseline: 'reference' — one control group (the vehicle, the agent's absence): the curve's
 *    baseline sits one step below the lowest level, and the 4PL's front is fitted towards it as the
 *    control at −∞ (CurveCurator's). 'matched' — the curve's own first point: the control at each
 *    level (interpolated between its levels, the nearest beyond them), so control drift cancels,
 *    and the baseline is the control's level itself (t₀; the lowest temperature of a TPP series —
 *    "ratio to the lowest level"), a real point: the 4PL's front is fixed at it and its midpoint may
 *    not lie before. Each axis has a preset (dose reference, time matched, any other reference); the
 *    Curve fit can set either on any axis.
 *
 * Where the baseline level sits follows from the two: on a linear axis at its own x; on a log axis
 * with a matched baseline at 0 it takes an offset — x = log₁₀(level + offset), the offset the
 * smallest gap between the levels with 0 — so 0 lands one step below the first level (a baseline
 * above 0 needs none). Nothing else is special.
 *
 * Which levels are treated: on a log axis those above 0; on a linear one every level but 0 (the
 * agent's absence, t₀) — so values supplied already logged (all negative) are all treated, and their
 * vehicle is the sample with no value.
 *
 * A linear x is the level divided by the axis's step (the median spacing of its treated levels):
 * the 4PL's slope and midpoint limits are set for log₁₀ dose, where a step is about one unit, so in
 * steps they hold whatever the units (hours, mg/mL, log₁₀ M). A fitted slope on a linear axis is
 * therefore per step.
 */
import type { ConditionKey } from './types'

export type AxisScale = 'log' | 'linear'
export type AxisBaseline = 'reference' | 'matched'

/** A model along one axis: shape-free ('spline' — a natural spline, its df by the levels), the
 *  sigmoid ('4pl'), a straight line ('linear'), or — on a surface — no change along it
 *  ('constant'). */
export type AxisShape = 'spline' | '4pl' | 'linear' | 'constant'
/** One axis's models in a curve fit: the detector's shape, the descriptor's ('none': not
 *  described) and — on a surface, a 4PL — whether its midpoint drifts along the other axis. Absent
 *  fields: the method's (spline / 4PL detector, 4PL descriptor; on a surface the drift its
 *  baseline gives, driftsByDefault). */
export interface AxisFit {
  detect?: AxisShape
  describe?: AxisShape | 'none'
  coupled?: boolean
}

export interface AxisModel {
  scale: AxisScale
  baseline: AxisBaseline
}

/** Whether a surface axis's 4PL midpoint drifts along the other unless set — read off how each
 *  axis's control is set, not which axis comes first. An axis against a reference (a control off
 *  it: the vehicle) drifts along a matched one (the control at each of its levels: time) — the
 *  potency moving with time — and not the reverse; two axes of one kind both drift (neither is the
 *  other's context). */
export const driftsByDefault = (own: AxisBaseline, other: AxisBaseline): boolean =>
  own === 'reference' || own === other

/** Dose: log scale (unless its levels say otherwise), against one reference (the vehicle). */
export const DOSE_MODEL: AxisModel = { scale: 'log', baseline: 'reference' }
/** Time: log(t + offset) (unless its levels say otherwise), against the control at each time. */
export const TIME_MODEL: AxisModel = { scale: 'log', baseline: 'matched' }
/** Any other numeric condition: its own units (unless its levels say otherwise), against one
 *  reference. */
export const DEFAULT_MODEL: AxisModel = { scale: 'linear', baseline: 'reference' }

/** The preset model for a curve over `axis`: dose's, time's, else linear against one reference. */
export const presetModel = (axis: ConditionKey): AxisModel =>
  axis === 'dose' ? DOSE_MODEL : axis === 'time' ? TIME_MODEL : DEFAULT_MODEL

/** The model a curve over `axis` is fitted with: `set` whole if given (tests); else the preset's
 *  baseline, on the scale the Curve fit confirmed (`scale`), else the one the levels' spacing shows
 *  (detectAxisScale), else — it can't tell — linear, for every axis alike. Without levels (only the
 *  baseline asked for) the preset's scale. */
export function axisModelFor(
  axis: ConditionKey,
  set?: AxisModel,
  scale?: AxisScale,
  levels?: readonly number[],
  baseline?: AxisBaseline
): AxisModel {
  if (set) return set
  const pre = presetModel(axis)
  const s = scale ?? (levels ? (detectAxisScale(levels).scale ?? 'linear') : pre.scale)
  const b = baseline ?? pre.baseline
  return s === pre.scale && b === pre.baseline ? pre : { scale: s, baseline: b }
}

/** A matched baseline's level: the lowest axis value its control samples sit at (no value counts
 *  as 0) — t₀, or the lowest temperature. */
export function baseLevelOf(values: ReadonlyArray<number | null>): number {
  let b = Infinity
  for (const v of values) b = Math.min(b, v ?? 0)
  return Number.isFinite(b) ? b : 0
}

/** What detectAxisScale saw: the scale (null: can't tell) and why, for the Curve fit to show. */
export interface ScaleGuess {
  scale: AxisScale | null
  why: string
}

const cv = (a: number[]): number => {
  const m = a.reduce((s, v) => s + v, 0) / a.length
  const sd = Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)
  return m !== 0 ? sd / Math.abs(m) : Infinity
}

/**
 * A numeric condition's scale, read off how its levels are spaced (its distinct values; 0 — the
 * vehicle, t₀ — ignored): even ratios (0.1, 1, 10, 100; 1, 2, 4, 8) are a log series, even
 * differences (24, 48, 72; −10, −9, −8) a linear one. Compared by the coefficient of variation of
 * the successive log-ratios and of the successive differences; the smaller wins when it is under
 * half the other. Any negative level is linear (no log there: already logged, or signed). Null when
 * it can't tell: fewer than 3 levels besides 0, or neither spacing clearly the more even — the fit
 * then takes linear (axisModelFor), whatever the axis. Not a
 * test of the values' distribution — the levels are a handful of design points.
 */
export function detectAxisScale(levels: readonly number[]): ScaleGuess {
  const vs = [...new Set(levels.filter((v) => Number.isFinite(v) && v !== 0))].sort((a, b) => a - b)
  if (vs.some((v) => v < 0)) return { scale: 'linear', why: 'negative values: no log scale there' }
  if (vs.length < 3) return { scale: null, why: 'too few levels to tell from their spacing' }
  const logSteps = vs.slice(1).map((v, i) => Math.log10(v / vs[i]))
  const diffs = vs.slice(1).map((v, i) => v - vs[i])
  const cLog = cv(logSteps)
  const cLin = cv(diffs)
  if (cLog <= cLin / 2) return { scale: 'log', why: 'evenly spaced as ratios' }
  if (cLin <= cLog / 2) return { scale: 'linear', why: 'evenly spaced as differences' }
  return { scale: null, why: 'neither evenly spaced as ratios nor as differences' }
}

/** Whether a level is a treated one on this scale: above 0 on a log axis, anything but 0 on a
 *  linear one (null — no value — never). */
export const treatedLevel = (scale: AxisScale, v: number | null): v is number =>
  v != null && (scale === 'log' ? v > 0 : v !== 0)

/** How x maps to and from a curve's axis units: its model; for a log axis with a matched baseline
 *  the offset that places 0 (else 0); for a linear axis the step x counts in (else 1). */
export interface AxisMap extends AxisModel {
  offset: number
  step: number
  /** a log axis's place for a level at or below 0 that is a data point itself — a surface's
   *  baseline level against one position (dose 0 at a higher temperature carries the vehicle's
   *  melt): a median step below the lowest level. Absent: such a level has no place (−∞). */
  zeroX?: number
}

/** The axis map for a curve's treated levels: the offset is the smallest gap between the levels
 *  with 0, and only a log axis with a matched baseline at 0 (`base`, its level) or below takes one;
 *  a linear axis's step is the median spacing of its levels. */
export function axisMapFor(model: AxisModel, levels: readonly number[], base = 0): AxisMap {
  if (model.scale === 'linear') {
    const vs = [...new Set(levels)].sort((a, b) => a - b)
    const d = vs
      .slice(1)
      .map((v, i) => v - vs[i])
      .sort((a, b) => a - b)
    return { ...model, offset: 0, step: d.length ? d[d.length >> 1] : 1 }
  }
  if (model.baseline !== 'matched' || base > 0) return { ...model, offset: 0, step: 1 }
  const gaps = [0, ...levels].map((t, i, a) => (i ? t - a[i - 1] : Infinity)).filter((g) => g > 0)
  return { ...model, offset: Math.min(...gaps), step: 1 }
}

/** A level's position on the curve's x. */
export function toX(
  m: Pick<AxisMap, 'scale' | 'offset' | 'step' | 'zeroX'>,
  level: number
): number {
  if (m.scale !== 'log') return level / m.step
  return m.zeroX != null && !(level + m.offset > 0) ? m.zeroX : Math.log10(level + m.offset)
}

/** A position on x back in the axis's units. */
export function fromX(m: Pick<AxisMap, 'scale' | 'offset' | 'step'>, x: number): number {
  return m.scale === 'log' ? 10 ** x - m.offset : x * m.step
}

/** How a stored fit (a result row's `rs`, or its 4PL `curve`) maps x back to its axis's units:
 *  absent fields are a log axis without offset, as every fit made before scales were kept. */
export interface StoredScale {
  scale?: 'linear'
  step?: number
  timeOffset?: number
}
export const storedMap = (f: StoredScale): Pick<AxisMap, 'scale' | 'offset' | 'step'> =>
  f.scale === 'linear'
    ? { scale: 'linear', offset: 0, step: f.step ?? 1 }
    : { scale: 'log', offset: f.timeOffset ?? 0, step: 1 }
/** A stored fit's x in its axis's units. */
export const xUnits = (f: StoredScale, x: number): number => fromX(storedMap(f), x)
