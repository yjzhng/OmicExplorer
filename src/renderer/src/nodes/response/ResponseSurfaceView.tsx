/**
 * One gene's dose × time response surface (a Curve fit by the response surface method) — the
 * Response plot. Values are log₂ against the fit's baseline (one position, or the vehicle at each
 * time). What the model is, and what it reads at any dose × time — a control's 0 included — is
 * engine/curves/surfaceModel.ts's, the one reading every view and the descriptor's fold change take; this
 * view only draws it.
 *
 *  - line (2-D): dose curves, one per time point (the legend), coloured early → late; the level
 *    means as points (coloured by their log₂ on the value palette, as in every view) and, as the
 *    line, the model's dose curve at that time (its Curve fit's model view — engine/curves/modelView.ts):
 *    the description's, none where the surface wasn't described (q beyond the describe cutoff, or
 *    no description could be fitted) — or, under the detector, the spline surface's fit.
 *  - line (3-D) and surface (3-D) draw the gene's description, so the lines are the surface's own:
 *    · joint description: the joint model over a fine dose × time grid; the lines are its slices
 *      at each time (dose curves) or at each dose (time curves).
 *    · per-time description: each time's 4PL as the lines; the surface joins them across times.
 *    · per-dose description: each dose's 4PL time curve as the lines; the surface joins them
 *      across doses.
 *    · no description: no line or surface — NA, the level means only.
 *    · the detector (model view): the spline surface's fit at the cells, joined smoothly.
 *    The surface carries its curves as thin lines in both directions: a dose curve at each time
 *    and a time curve at each dose, from the same model. The level means as points.
 *  - heatmap (2-D): the measured log₂ effect over dose × time, on the value colour scale.
 *
 * The two-condition Response plot draws a Compare's measured log₂FC (`measured`) the same way,
 * with no model behind it, over any two numeric conditions — the first in the dose slot (x), the
 * second in the time slot (the lines), each axis log or linear (`scales`): the lines and the
 * surface join the measured values with straight lines (on those axes), and the value axis is the
 * fold change's own (log₂FC · A | B).
 */
import { useMemo } from 'react'

import type { CompareResultRow, ModelView } from '../../engine'
import type { ResponseLook } from '../../graph/config/response'
import type { PaletteRef, PaletteRole } from '../../ui/color/palettes'
import { useRolePalette } from '../../ui/app/useAppSettings'
import { PlotlyChart } from '../../ui/plot/PlotlyChart'
import { useUiTheme } from '../../ui/app/useUiTheme'

import type { AxisLevels, MeasuredCell, ResponseShow } from './responseContext'
import { buildResponsePlot } from './responsePlot'
import { sceneWithAxes } from './responseScene3d'
import { useSurfaceCamera, useSurfaceMount } from './useSurfaceCamera'

export type { AxisLevels, MeasuredCell, ResponseShow } from './responseContext'

export function ResponseSurfaceView({
  row,
  measured,
  dim,
  show,
  look,
  rolePalettes,
  slice = 'time',
  projection = 'orthographic',
  doseLabel = 'dose',
  timeLabel = 'time',
  scales,
  xRole = 'dose',
  yRole = 'time',
  valueRange,
  shiftRange,
  levels,
  valueTitle: valueTitleSet,
  model = 'descriptor'
}: {
  /** the gene's surface row (rs.axis 'surface') in the facet on show */
  row?: CompareResultRow
  /** a fitted surface's model to draw (its Curve fit's model view): the description, or the
   *  detector's spline surface */
  model?: ModelView
  /** instead of a fitted surface: a Compare's measured log₂FC at each dose × time level (the
   *  Time & Dose-response plot), and the comparison it's for (the value axis's title) */
  measured?: { cells: MeasuredCell[]; comparison?: string }
  dim: '2d' | '3d'
  /** a show the dimension can draw (see responseShow) */
  show: ResponseShow
  look: ResponseLook
  /** the global role palettes this plot's Automatic follows: `value` (fold change — the surface
   *  and heatmap) and `points` (fold change on objects — the level means) */
  rolePalettes: { value: PaletteRef; points: PaletteRef }
  /** lines (2-D or 3-D) from a joint description, the spline surface or measured values: slices at each
   *  time or at each dose */
  slice?: 'time' | 'dose'
  /** 3-D: the camera's projection */
  projection?: 'perspective' | 'orthographic'
  /** the axes' titles, with their units */
  doseLabel?: string
  timeLabel?: string
  /** measured values only: each axis's scale (default log for both, as a fitted surface's) */
  scales?: { x: 'log' | 'linear'; y: 'log' | 'linear' }
  /** the palette roles the lines per x level / per y level follow (default dose / time) */
  xRole?: PaletteRole
  yRole?: PaletteRole
  /** the value axis fixed to this range — and the value colours to ± its larger end — so paging
   *  genes keeps one scale (scale: global); unset = fitted to this gene's own values */
  valueRange?: [number, number]
  /** testing response changes: the shift colours fixed to ± this — so paging genes keeps one
   *  scale (scale: global); unset = fitted to this gene's own shifts */
  shiftRange?: number
  /** measured values only: an axis of named levels at set positions (an ANOVA's factors — a
   *  category, or a numeric level placed on its scale), linear: ticks at the levels, named; the
   *  slices and hovers by the names. The cells' dose / time are those positions. */
  levels?: { x?: AxisLevels; y?: AxisLevels }
  /** the value axis's title, for values other than a Compare's log₂FC */
  valueTitle?: string
}) {
  const mode = useUiTheme((s) => s.mode)
  // A 3-D scene is mounted only while near the screen, and the user's turn / zoom kept to put
  // back on return (see useSurfaceCamera).
  const { boxRef, near, cameraRef, side, resume, syncSide, onCamera } = useSurfaceCamera(projection)
  // Lines per time / per dose (per y / x level) run along those levels' palette roles unless the
  // plot picked one.
  const timeRole = useRolePalette(yRole)
  const doseRole = useRolePalette(xRole)
  const {
    data: plotData,
    layout: plotLayout,
    hl,
    axes3
  } = useMemo(
    () =>
      buildResponsePlot({
        row,
        measured,
        dim,
        show,
        look,
        rolePalettes,
        timeRole,
        doseRole,
        slice,
        doseLabel,
        timeLabel,
        scales,
        valueRange,
        shiftRange,
        levels,
        valueTitleSet,
        mode,
        model
      }),
    [
      row,
      measured,
      dim,
      show,
      look,
      rolePalettes,
      timeRole,
      doseRole,
      slice,
      doseLabel,
      timeLabel,
      scales,
      valueRange,
      shiftRange,
      levels,
      valueTitleSet,
      mode,
      model
    ]
  )

  // A 3-D view's axes, drawn for the side it's seen from (see sceneWithAxes).
  const { data, layout, hlLifted } = useMemo(
    () => sceneWithAxes(plotData, plotLayout, axes3, side, hl, resume),
    [plotData, plotLayout, axes3, side, hl, resume]
  )

  // The 3-D surface's hover highlight, bound to each drawn chart, and the camera on screen read
  // after every draw (see useSurfaceMount).
  const onSurfaceMount = useSurfaceMount(hlLifted, cameraRef, syncSide)

  // One box in every case, so the visibility check (useSurfaceCamera) always has it to watch.
  const scene = (layout as { scene?: Record<string, unknown> }).scene
  const shown = scene
    ? {
        ...layout,
        scene: {
          ...scene,
          camera: {
            ...((resume ?? scene.camera) as Record<string, unknown>),
            projection: { type: projection }
          }
        }
      }
    : layout
  return (
    <div ref={boxRef} style={{ width: '100%', height: '100%' }}>
      {!data.length ? (
        <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted, #888)' }}>
          {measured
            ? `No ${doseLabel} × ${timeLabel} response for this gene here (needs both active).`
            : 'No surface for this gene here.'}
        </div>
      ) : dim !== '3d' ? (
        <PlotlyChart controls={show === 'heatmap' ? 'none' : 'zoom'} data={data} layout={layout} />
      ) : (
        // Mounted again after being away: from the camera it was left at.
        near && (
          <PlotlyChart
            controls="zoom"
            data={data}
            layout={shown}
            onCamera={onCamera}
            onGraphMount={onSurfaceMount}
          />
        )
      )}
    </div>
  )
}
