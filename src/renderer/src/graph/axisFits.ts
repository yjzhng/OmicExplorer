/**
 * A Curve fit's models per axis (docs/curve_fit_framework.md §4): each axis it runs over —
 * the one of a curve, the two of a surface — has its detector's shape, its descriptor's shape and,
 * on a surface, whether a 4PL's midpoint drifts along the other axis. Stored as overrides of the
 * method preset (CompareConfig.axisFits); this module resolves them, says which choices the engine
 * can run (with the reason when not), and what method the choices amount to. Shared by the tile
 * panel and the Configure window.
 *
 * What runs:
 *  - a curve: a 4PL detector is CurveCurator's method (its fit is its description); a spline or a
 *    line is detected by the moderated F and described by its descriptor (4PL, line, or none);
 *  - a surface: every axis linear-in-parameters (spline / line / constant) — the tensor-product
 *    detector, moderated F; any axis 4PL — the joint model (every axis a shape: 4PL, line or
 *    constant; a spline can't enter it), its adjusted F. Described slice by slice (each axis's
 *    slices by its descriptor) or by the joint model of the descriptors.
 */
import {
  condLabel,
  driftsByDefault,
  presetModel,
  type AxisBaseline,
  type AxisFit,
  type AxisShape,
  type ConditionKey
} from '../engine'
import type { CompareConfig } from './types'

export type Describe = AxisShape | 'none'

/** The axes' baseline kinds as set (CompareConfig.axisBaseline), each axis's preset where unset. */
export type Baselines = Partial<Record<ConditionKey, AxisBaseline>> | undefined

/** The axis `axes[index]`'s models in effect: its overrides, else the method's (the 4PL detector's
 *  or the spline's; the 4PL descriptor; on a surface the drift its baseline gives against the other
 *  axis's — driftsByDefault — whichever comes first). */
export function fitOf(
  fits: CompareConfig['axisFits'],
  axes: readonly ConditionKey[],
  index: number,
  detection: '4pl' | 'spline',
  baselines?: Baselines
): Required<AxisFit> {
  const axis = axes[index]
  const f = fits?.[axis]
  const base = (a: ConditionKey): AxisBaseline => baselines?.[a] ?? presetModel(a).baseline
  const other = axes.length === 2 ? axes[1 - index] : undefined
  return {
    detect: f?.detect ?? (detection === '4pl' ? '4pl' : 'spline'),
    describe: f?.describe ?? '4pl',
    coupled: f?.coupled ?? (other != null && driftsByDefault(base(axis), base(other)))
  }
}

/** The method the axes' detectors amount to: '4pl' when any is the 4PL (CurveCurator's method over
 *  one axis; the joint model over two), else 'spline' — the config's `detection`, which picks the
 *  run's path and its threshold. */
export function detectionOf(
  fits: CompareConfig['axisFits'],
  axes: readonly ConditionKey[],
  detection: '4pl' | 'spline'
): '4pl' | 'spline' {
  return axes.some((_, i) => fitOf(fits, axes, i, detection).detect === '4pl') ? '4pl' : 'spline'
}

/** Whether the axes' models are the method preset's (no override in effect) — else custom. */
export function isPreset(
  fits: CompareConfig['axisFits'],
  axes: readonly ConditionKey[],
  detection: '4pl' | 'spline',
  baselines?: Baselines
): boolean {
  return axes.every((_, i) => {
    const f = fitOf(fits, axes, i, detection, baselines)
    const p = fitOf(undefined, axes, i, detection, baselines)
    return f.detect === p.detect && f.describe === p.describe && f.coupled === p.coupled
  })
}

export interface ShapeOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
  title: string
}

const SHAPE_LABEL: Record<Describe, string> = {
  spline: 'spline',
  '4pl': '4PL',
  linear: 'linear',
  constant: 'constant',
  none: 'none'
}

/** The detector shapes an axis can take: spline, 4PL, linear — and on a surface constant (no
 *  change along it). On a surface a spline can't share the joint model with a 4PL (picking one
 *  with the other axis on the other moves that one along — see setDetect). */
export function detectorOptions(surface: boolean): ShapeOption<AxisShape>[] {
  const opts: ShapeOption<AxisShape>[] = [
    {
      value: 'spline',
      label: 'spline',
      title: 'Shape-free: a smooth spline against flat, moderated F'
    },
    { value: '4pl', label: '4PL', title: 'A sigmoid against flat, its adjusted F' },
    { value: 'linear', label: 'linear', title: 'A straight line against flat, moderated F' }
  ]
  if (surface)
    opts.push({
      value: 'constant',
      label: 'constant',
      title: 'No change along this axis: the response is the same at every level of it'
    })
  return opts
}

/** The descriptor shapes an axis can take — none when its detector describes itself (a curve's 4PL
 *  detector: CurveCurator's fit). On a surface constant too. */
export function descriptorOptions(
  surface: boolean,
  detect: AxisShape
): { options: ShapeOption<Describe>[]; locked?: string } {
  if (!surface && detect === '4pl')
    return {
      options: [{ value: '4pl', label: '4PL', title: 'The 4PL detector’s own fit' }],
      locked: 'The 4PL detector describes its curves by its own fit'
    }
  const options: ShapeOption<Describe>[] = [
    { value: '4pl', label: '4PL', title: 'A sigmoid: EC50, slope and plateaus' },
    { value: 'linear', label: 'linear', title: 'A straight line from the baseline: its slope' },
    { value: 'none', label: 'none', title: 'Not described: the plots draw the detector’s fit' }
  ]
  if (surface)
    options.splice(2, 0, {
      value: 'constant',
      label: 'constant',
      title: 'No change along this axis (joint model only)'
    })
  return { options }
}

/** Why the joint description can't be built from the axes' descriptors (an axis without a shape:
 *  none or spline), else null. */
export function jointWhy(
  describes: readonly Describe[],
  axes: readonly ConditionKey[]
): string | null {
  const i = describes.findIndex((d) => d === 'none' || d === 'spline')
  return i < 0
    ? null
    : `The joint model needs a shape along every axis: ${condLabel(axes[i])} has none — pick its descriptor, or describe by slices`
}

/** The axes' models after setting one axis's field — stored whole for every axis the fit runs over
 *  (a custom choice: nothing then falls back to the method), every other condition's kept as it
 *  was. Except the drift: stored only once picked, so until then it follows the baselines. On a surface a detector moved onto the 4PL takes the other axis off the spline (the joint
 *  model has no spline), and one moved onto the spline takes it off the 4PL. */
export function setFit(
  fits: CompareConfig['axisFits'],
  axes: readonly ConditionKey[],
  index: number,
  field: keyof AxisFit,
  value: AxisFit[keyof AxisFit],
  detection: '4pl' | 'spline',
  baselines?: Baselines
): NonNullable<CompareConfig['axisFits']> {
  const eff = axes.map((_, i) => fitOf(fits, axes, i, detection, baselines))
  ;(eff[index] as Record<string, unknown>)[field] = value
  if (field === 'detect' && axes.length === 2) {
    const o = 1 - index
    if (value === '4pl' && eff[o].detect === 'spline') eff[o].detect = '4pl'
    if (value === 'spline' && eff[o].detect === '4pl') eff[o].detect = 'spline'
  }
  const out: NonNullable<CompareConfig['axisFits']> = { ...fits }
  axes.forEach((a, i) => {
    const { coupled, ...shapes } = eff[i]
    const picked = (field === 'coupled' && i === index) || fits?.[a]?.coupled !== undefined
    out[a] = picked ? { ...shapes, coupled } : shapes
  })
  return out
}

/** The axes' models with any picked drift cleared, so it follows the baselines again — what a
 *  change of an axis's baseline does (the drift is read off how the controls are set). */
export function driftFollowsBaselines(
  fits: CompareConfig['axisFits'],
  axes: readonly ConditionKey[]
): CompareConfig['axisFits'] {
  if (!fits || !axes.some((a) => fits[a]?.coupled !== undefined)) return fits
  const out: NonNullable<CompareConfig['axisFits']> = { ...fits }
  for (const a of axes) {
    if (!out[a]) continue
    const rest = { ...out[a] }
    delete rest.coupled
    out[a] = rest
  }
  return out
}

export { SHAPE_LABEL }
