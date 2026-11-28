/**
 * The Response plot's surface view (ResponseSurfaceView): the model over a fine dose × time grid
 * in 3-D, with its curves in both directions, the hover's highlight lines and the points.
 */
import { AUTO } from '../../ui/color/ColorPicker'
import { tooltip } from '../../ui/plot/condTooltip'

import type { ResponseContext, ResponsePlot } from './responseContext'
import { controlTraces, finish3 } from './responseScene3d'
import { HOVER_DIM, HOVER_LINE_SHADE, shade } from './surfaceHover'

/** surface (3-D): the model's surface — coloured by value, or (testing response changes) by its
 *  shift from the reference curve — with what a hover on it reads (see bindSurfaceHover). */
export function surface3dPlot(ctx: ResponseContext): ResponsePlot {
  const {
    look,
    shiftRange,
    p,
    named,
    xyText,
    xyConds,
    textOf,
    cells,
    spread,
    times,
    shift,
    shiftAlongB,
    refDose,
    refTime,
    refAt,
    shiftName,
    zAbs,
    traces,
    scale,
    pointSize,
    pointColor,
    valueName,
    pointLabel,
    tx,
    uOf,
    sm,
    gridDoses,
    fineDoses,
    fineTimes,
    fineLx,
    fineU,
    timesU,
    lineLabel,
    lxDoses,
    doseCurve,
    timeCurve
  } = ctx
  // The model over the fine grid (sm.grid): the joint model's own values; else its lines —
  // each time's dose curve (or each dose's time curve) — carried across the other axis by the
  // monotone cubic, which passes through every line; NA with no description.
  const z = sm.grid(fineDoses, fineTimes)
  const surf = { x: fineDoses, y: fineTimes, z }
  const zMax = Math.max(
    zAbs,
    ...surf.z.flat().map((v) => (v == null || !Number.isFinite(v) ? 0 : Math.abs(v)))
  )
  // testing changes: each grid point's shift from the reference curve at its response level
  const refJ = fineDoses.indexOf(refDose)
  const refI = fineTimes.indexOf(refTime)
  const shiftGrid = shift
    ? z.map((zr, i) =>
        zr.map((v, j) => {
          const ref = shiftAlongB ? (refJ >= 0 ? z[i][refJ] : null) : refI >= 0 ? z[refI][j] : null
          return v == null || ref == null ? null : v - ref
        })
      )
    : null
  const sMax = shiftGrid
    ? (shiftRange ??
      Math.max(
        0.1,
        ...shiftGrid.flat().map((v) => (v == null || !Number.isFinite(v) ? 0 : Math.abs(v)))
      ))
    : zMax
  // The surface's curves in both directions, from the same model: the dose curve at each time,
  // and the time curve at each dose (per-time: across the times' 4PLs, as the surface joins
  // them; no description: flat).
  const curveLine = {
    color: look.curveColor !== AUTO ? look.curveColor : p.text,
    width: look.curveWidth
  }
  const curveHover = tooltip(
    {
      conds: xyConds(),
      values: [[lineLabel, '%{z:.3f}']]
    },
    p.textMuted,
    { template: true }
  )
  const curveTraces: Record<string, unknown>[] = !look.curves
    ? []
    : [
        ...times.map((t) => ({ x: fineDoses, y: fineDoses.map(() => t), z: doseCurve(t) })),
        ...gridDoses.map((d) => ({ x: fineTimes.map(() => d), y: fineTimes, z: timeCurve(d) }))
      ].map((xyz) => ({
        type: 'scatter3d',
        mode: 'lines',
        ...xyz,
        ...textOf(xyz.x, xyz.y),
        line: curveLine,
        opacity: look.curveOpacity,
        showlegend: false,
        hovertemplate: curveHover,
        meta: { oeRole: 'curve' }
      }))
  traces.push({
    type: 'surface',
    x: surf.x,
    y: surf.y,
    z: surf.z,
    ...(shiftGrid ? { surfacecolor: shiftGrid, customdata: shiftGrid } : null),
    ...(named ? { text: surf.y.map((t) => surf.x.map((d) => xyText(d, t))) } : null),
    colorscale: scale,
    cmin: -sMax,
    cmax: sMax,
    opacity: look.surfaceOpacity,
    // No hover highlight of Plotly's own: the hovered point's dose and time curves are drawn
    // as their own traces (below — thick, coloured by value), not its one-colour contours.
    contours: {
      x: { highlight: false },
      y: { highlight: false },
      z: { highlight: false }
    },
    meta: { oeRole: 'surface' },
    // inside the plot's right edge (see finish3's legend)
    colorbar: {
      // testing changes: the colour is the shift from the reference curve, not the value
      title: { text: shift ? shiftName : valueName },
      thickness: 12,
      len: 0.5,
      x: 1,
      xanchor: 'right'
    },
    hovertemplate: tooltip(
      {
        conds: xyConds(),
        values: [
          [lineLabel, '%{z:.3f}'],
          ...(shift ? [[shiftName, '%{customdata:.3f}'] as [string, string]] : [])
        ]
      },
      p.textMuted,
      { template: true }
    )
  })
  traces.push(...curveTraces)
  // The hovered point's curves — its dose curve at that time, its time curve at that dose —
  // filled in on hover (see SurfaceHover), hidden otherwise.
  const hlLine = (role: string): Record<string, unknown> => ({
    type: 'scatter3d',
    mode: 'lines',
    x: [fineDoses[0]],
    y: [fineTimes[0]],
    z: [0],
    visible: false,
    line: {
      width: Math.max(4, look.curveWidth * 4),
      // the surface's palette, a shade darker so the lines stand out of it
      colorscale: scale.map(([t, c]) => [t, shade(c, HOVER_LINE_SHADE)]),
      cmin: -zMax,
      cmax: zMax,
      color: [0]
    },
    showlegend: false,
    // answers the hover (no label) so the pointer on it keeps the highlight — skipped, it
    // would pass as leaving the surface and the lines would flicker off and on
    hoverinfo: 'none',
    meta: { oeRole: role, oeGroup: '' }
  })
  traces.push(hlLine('hlDose'), hlLine('hlTime'))
  const pts = spread(cells)
  // testing changes: the points too by their shift from the reference curve (as spread lays
  // them out: each cell's replicates, or its value)
  const ptShift = shift
    ? cells.flatMap((c) => {
        const ref = refAt(c)
        return (c.reps?.length ? c.reps : [c.y]).map((y) => (ref == null ? NaN : y - ref))
      })
    : null
  const ptMarker = pointColor(ptShift ?? pts.map((c) => c.y), sMax)
  // A 3-D point trace takes one opacity for all its points, so the points the hover fades
  // move into a trace of their own (hidden until then; see bindSurfaceHover).
  const pointTrace = (role: string, opacity: number): Record<string, unknown> => ({
    type: 'scatter3d',
    mode: 'markers',
    meta: { oeRole: role },
    x: pts.map((c) => c.dose),
    y: pts.map((c) => c.time),
    z: pts.map((c) => c.y),
    ...textOf(
      pts.map((c) => c.dose),
      pts.map((c) => c.time)
    ),
    marker: { ...ptMarker, size: pointSize, opacity },
    ...(role === 'pointsDim' ? { visible: false } : null),
    showlegend: false,
    hovertemplate: tooltip(
      {
        conds: xyConds('%{x:.3g}', '%{y}'),
        values: [[pointLabel, '%{z:.3f}']]
      },
      p.textMuted,
      { template: true }
    )
  })
  if (look.points)
    traces.push(
      pointTrace('points', look.pointOpacity),
      pointTrace('pointsDim', look.pointOpacity * HOVER_DIM)
    )
  traces.push(...controlTraces(ctx, false))
  return {
    ...finish3(ctx, false),
    hl: {
      x: fineDoses,
      y: fineTimes,
      z: surf.z,
      lx: fineLx,
      u: fineU,
      doseLx: lxDoses,
      timeU: timesU,
      points: pts.map((c, k) => ({
        x: c.dose,
        y: c.time,
        z: c.y,
        color: Array.isArray(ptMarker.color) ? (ptMarker.color as number[])[k] : undefined,
        lx: tx(c.dose),
        u: uOf(c.time)
      })),
      surfaceOpacity: look.surfaceOpacity,
      curveOpacity: look.curveOpacity
    }
  }
}
