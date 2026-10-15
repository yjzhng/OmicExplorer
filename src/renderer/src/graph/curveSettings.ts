/**
 * A Curve fit's three settings — model, axis, and (on a dose × time surface) how each surface is
 * described — shared by the tile panel and the Configure dialog so both offer the same choices.
 */
import { CURVE_MIN_TREATED, type DataShape } from '../engine'

export type CurveModel = '4pl' | 'spline'
export type CurveAxisPick = 'dose' | 'time' | 'surface'
export type SurfaceFit = 'slices' | 'doseSlices' | 'joint'

/** Why the data can't fit a curve over an axis (too few levels) — null when it can, or when the
 *  shape isn't known yet (before Clean data has run). */
export const curveAxisWhy = (
  shape: DataShape | null | undefined,
  a: 'dose' | 'time'
): string | null =>
  !shape || ((shape.levels[a] ?? 0) >= 2 && (shape.treated[a] ?? 0) >= CURVE_MIN_TREATED)
    ? null
    : `Needs at least ${CURVE_MIN_TREATED} ${a} levels beyond the lowest`

export const curveSurfaceWhy = (shape: DataShape | null | undefined): string | null =>
  curveAxisWhy(shape, 'dose') || curveAxisWhy(shape, 'time')
    ? 'Needs both dose and time to vary in the data'
    : null

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

export function curveAxisOptions(
  shape: DataShape | null | undefined,
  model: CurveModel
): { value: CurveAxisPick; label: string; disabled: boolean; title: string }[] {
  const surfaceWhy = curveSurfaceWhy(shape)
  return [
    ...(['dose', 'time'] as const).map((a) => ({
      value: a,
      label: a,
      disabled: !!curveAxisWhy(shape, a),
      title: curveAxisWhy(shape, a) ?? `One curve per gene over ${a}`
    })),
    {
      value: 'surface' as const,
      label: 'dose × time',
      disabled: !!surfaceWhy,
      title:
        surfaceWhy ??
        (model === 'spline'
          ? 'One dose × time surface per gene × compound'
          : 'One 4PL surface per gene × compound, its adjusted F-test (slower)')
    }
  ]
}

export const SURFACE_FIT_OPTIONS: { value: SurfaceFit; label: string; title: string }[] = [
  {
    value: 'joint',
    label: 'surface',
    title:
      'One model over every cell: EC50 and top change smoothly with time (steadier on dense grids, ~10× slower)'
  },
  {
    value: 'slices',
    label: 'time slice',
    title: 'A 4PL dose curve at each time, fitted on its own'
  },
  {
    value: 'doseSlices',
    label: 'dose slice',
    title: 'A 4PL time curve at each dose, fitted on its own'
  }
]
