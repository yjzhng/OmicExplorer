import { useMemo } from 'react'

import {
  condLabel,
  detectAxisScale,
  isNumericCond,
  slopePositions,
  type AnovaFactor,
  type InteractionGene,
  type NumericConds
} from '../../engine'
import type { ResponseLook } from '../../graph/config/response'
import type { PaletteRef } from '../../ui/color/palettes'
import {
  ResponseSurfaceView,
  type AxisLevels,
  type MeasuredCell
} from '../response/ResponseSurfaceView'

/** A factor's levels on a 3-D axis: a slope's own positions; a numeric condition's levels placed
 *  on its scale (log₁₀, 0 a step below the lowest — as a slope's); a category's evenly, the control
 *  first. With which level is the control: the one every pair compares against, its last. */
function axisOf(f: AnovaFactor, numeric: NumericConds): AxisLevels & { control: number } {
  const control = f.levels.length - 1
  if (f.x) return { at: f.x, names: f.levels, control }
  if (isNumericCond(f.condition, numeric) && f.levels.every((l) => Number.isFinite(Number(l)))) {
    const scale = detectAxisScale(f.levels.map(Number)).scale ?? 'linear'
    return { at: slopePositions(f.levels, scale), names: f.levels, control }
  }
  // the control at 0, the others after it in the model's order
  return { at: f.levels.map((_, i) => (i === control ? 0 : i + 1)), names: f.levels, control }
}

/**
 * The interaction plot in 3-D, one gene: the x factor along x, the line factor along y, each cell's
 * mean as log₂ against the control cell (both factors at their control: 0 there) — drawn by the
 * Curve fit's 3-D view on its measured values, with each cell's replicates as points and its
 * standard error. Both factors numeric: a surface through the cells; a category on either axis:
 * a line per level of the line factor, as nothing lies between two categories. Further factors
 * averaged, as in the other views.
 */
export function InteractionSurface({
  gene,
  xFactor,
  lineFactor,
  numeric,
  show,
  look,
  rolePalettes
}: {
  /** the gene's cell means on the log₂ scale (interactionGene with plot 'log2') */
  gene: InteractionGene
  xFactor: AnovaFactor
  lineFactor: AnovaFactor
  numeric: NumericConds
  /** a surface (both factors numeric — the caller checks) or a line per level of factor 2 */
  show: 'line' | 'surface'
  look: ResponseLook
  rolePalettes: { value: PaletteRef; points: PaletteRef }
}) {
  const ax = useMemo(() => axisOf(xFactor, numeric), [xFactor, numeric])
  const ay = useMemo(() => axisOf(lineFactor, numeric), [lineFactor, numeric])
  const measured = useMemo(() => {
    const ref = gene.means[ay.control]?.[ax.control]
    const cells: MeasuredCell[] = []
    if (ref == null || !Number.isFinite(ref)) return { cells }
    gene.means.forEach((row, li) =>
      row.forEach((m, xi) => {
        if (!Number.isFinite(m)) return
        cells.push({
          dose: ax.at[xi],
          time: ay.at[li],
          y: m - ref,
          se: (gene.hi[li][xi] - gene.lo[li][xi]) / 2,
          reps: gene.reps[li][xi].map((v) => v - ref)
        })
      })
    )
    return { cells }
  }, [gene, ax, ay])
  const controlName = `${xFactor.levels[ax.control]} · ${lineFactor.levels[ay.control]}`
  return (
    <ResponseSurfaceView
      measured={measured}
      dim="3d"
      show={show}
      slice="time"
      look={look}
      rolePalettes={rolePalettes}
      doseLabel={condLabel(xFactor.condition)}
      timeLabel={condLabel(lineFactor.condition)}
      scales={{ x: 'linear', y: 'linear' }}
      levels={{ x: ax, y: ay }}
      valueTitle={`log₂ vs ${controlName}`}
    />
  )
}
