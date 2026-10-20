/**
 * A Curve fit's three settings — model, axis (any numeric condition, or a dose × time surface), and
 * (on a surface) how each surface is described — shared by the tile panel and the Configure dialog
 * so both offer the same choices.
 */
import { condLabel, CURVE_MIN_TREATED, type ConditionKey, type DataShape } from '../engine'

export type CurveModel = '4pl' | 'spline'
/** what a curve runs over: a numeric condition, or the dose × time surface */
export type CurveAxisPick = ConditionKey | 'surface'
export type SurfaceFit = 'slices' | 'doseSlices' | 'joint'

/** Why the data can't fit a curve over an axis (too few levels) — null when it can, or when the
 *  shape isn't known yet (before Clean data has run). */
export const curveAxisWhy = (
  shape: DataShape | null | undefined,
  a: ConditionKey
): string | null =>
  !shape || ((shape.levels[a] ?? 0) >= 2 && (shape.treated[a] ?? 0) >= CURVE_MIN_TREATED)
    ? null
    : `Needs at least ${CURVE_MIN_TREATED} ${condLabel(a)} levels beyond the lowest`

export const curveSurfaceWhy = (
  shape: DataShape | null | undefined,
  pair: readonly [ConditionKey, ConditionKey] = ['dose', 'time']
): string | null =>
  curveAxisWhy(shape, pair[0]) || curveAxisWhy(shape, pair[1])
    ? `Needs both ${condLabel(pair[0])} and ${condLabel(pair[1])} to vary in the data`
    : null

/** A surface's entry in an axis switch: `surface:a|b` (the pair, first axis first). */
export const surfaceValue = (pair: readonly [ConditionKey, ConditionKey]): string =>
  `surface:${pair[0]}|${pair[1]}`
/** An axis switch's value read back: one axis, or a surface's pair. */
export function readAxisValue(
  v: string
): { axis: ConditionKey } | { pair: [ConditionKey, ConditionKey] } {
  if (!v.startsWith('surface:')) return { axis: v as ConditionKey }
  const [a, b] = v.slice('surface:'.length).split('|') as [ConditionKey, ConditionKey]
  return { pair: [a, b] }
}
/** The pairs a surface can run over: every two numeric conditions, in order (dose before time). */
export function surfacePairs(axes: readonly ConditionKey[]): Array<[ConditionKey, ConditionKey]> {
  return axes.flatMap((a, i) =>
    axes.slice(i + 1).map((b) => [a, b] as [ConditionKey, ConditionKey])
  )
}

/** The method presets — the tile panel's and the Configure window's Model rows alike (each axis's
 *  own models: graph/axisFits.ts). */
export const CURVE_METHOD_OPTIONS: { value: 'hybrid' | '4pl' | 'custom'; label: string }[] = [
  { value: 'hybrid', label: 'Hybrid' },
  { value: '4pl', label: '4PL' },
  { value: 'custom', label: 'custom' }
]
/** A model switch while a method preset holds it: faded (still usable — picking another value
 *  makes the method custom). */
export const MODEL_LOCK = {
  style: { opacity: 0.55 },
  title: 'Set by the method — picking another makes it custom'
}

export const CURVE_MODEL_OPTIONS: { value: CurveModel; label: string; title: string }[] = [
  {
    value: '4pl',
    label: '4PL',
    title: 'The CurveCurator method: a 4-parameter sigmoid vs a flat line'
  },
  {
    value: 'spline',
    label: 'Hybrid',
    title:
      'Detects with a smooth spline (any response shape, moderated F), then describes each called curve by a 4PL'
  }
]

/** The axes a curve can run over: every numeric condition in the data (dose and time before its
 *  data is known), each greyed with the reason when it has too few levels, and a surface over
 *  every pair of them (value: surfaceValue). */
export function curveAxisOptions(
  shape: DataShape | null | undefined,
  model: CurveModel
): { value: string; label: string; disabled: boolean; title: string }[] {
  const axes: ConditionKey[] = shape?.numeric.length ? shape.numeric : ['dose', 'time']
  return [
    ...axes.map((a) => ({
      value: a as string,
      label: condLabel(a),
      disabled: !!curveAxisWhy(shape, a),
      title: curveAxisWhy(shape, a) ?? `One curve per gene over ${condLabel(a)}`
    })),
    ...surfacePairs(axes).map((p) => {
      const why = curveSurfaceWhy(shape, p)
      const name = `${condLabel(p[0])} × ${condLabel(p[1])}`
      return {
        value: surfaceValue(p),
        label: name,
        disabled: !!why,
        title:
          why ??
          (model === 'spline'
            ? `One ${name} surface per gene × compound`
            : `One 4PL ${name} surface per gene × compound, its adjusted F-test (slower)`)
      }
    })
  ]
}

/** What a two-axis fit is for (CompareConfig.surfaceIntent). */
export type SurfaceIntent = 'shape' | 'changes'
export const INTENT_OPTIONS: { value: SurfaceIntent; label: string; title: string }[] = [
  {
    value: 'shape',
    label: 'capture shape',
    title:
      'Is there a response, and what is its shape? One surface over every cell (noise evened out across neighbouring levels), tested against flat and described by one joint model (EC50 and top changing smoothly along the other axis). E.g. decryptM.'
  },
  {
    value: 'changes',
    label: 'test changes',
    title:
      'Does the response along one axis change with the other? A curve along the response axis at each level of the other, each fitted on its own, tested against one curve shared by all — what every level shares (a melt curve) is not a change. Described by how the curves differ: consistent drift or a change of shape. E.g. TPP.'
  }
]

export const SURFACE_FIT_OPTIONS: { value: SurfaceFit; label: string; title: string }[] = [
  {
    value: 'joint',
    label: 'surface',
    title:
      'One model over every cell: EC50 and top change smoothly with time (steadier on dense grids, ~10× slower)'
  },
  {
    value: 'slices',
    label: 'slices',
    title:
      'A 4PL at each slice, each fitted on its own: a dose curve at each time and a time curve at each dose'
  }
]

/** The fit option a saved setting shows as: the older 'doseSlices' (the same slice fits, drawn per
 *  dose — now the Response plot's own slice switch) is 'slices'. */
export const surfaceFitShown = (v: SurfaceFit | undefined): 'joint' | 'slices' =>
  v === 'joint' ? 'joint' : 'slices'
