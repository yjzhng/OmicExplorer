/**
 * The Response plot's line views (ResponseSurfaceView): the slices — dose curves per time, or
 * time curves per dose — in 3-D over the dose × time floor, or in 2-D along one axis.
 */
import { AUTO } from '../../ui/color/ColorPicker'
import { tooltip } from '../../ui/plot/condTooltip'
import { errorTraces } from '../../ui/plot/errorTraces'
import { axisBase } from '../../ui/app/theme'

import { SAMPLES, type ResponseContext, type ResponsePlot } from './responseContext'
import { controlTraces, finish3 } from './responseScene3d'

/** line (3-D): the slices in the scene, each at its own time (dose curves) or dose (time curves),
 *  with their error and points, and the reference's markers. */
export function line3dPlot(ctx: ResponseContext): ResponsePlot {
  const {
    look,
    slice,
    doseLabel,
    timeLabel,
    p,
    xyConds,
    textOf,
    cells,
    spread,
    errorInk,
    showErrors,
    doses,
    times,
    sliceName,
    sliceColor,
    zAbs,
    traces,
    pointSize,
    pointColor,
    pointLabel,
    perDose,
    perTime,
    fineDoses,
    fineTimes,
    lineLabel,
    doseCurve,
    timeCurve
  } = ctx
  // Time curves per dose: a per-dose description's own, or — when picked — a joint model's,
  // the flat no-description lines or the measured values'. A per-time description's lines
  // are its 4PLs, by time.
  const byDose = perDose || (!perTime && slice === 'dose')
  const groups = byDose ? doses : times
  groups.forEach((g, i) => {
    const col = sliceColor(i, groups.length, byDose ? 'dose' : 'time')
    const name = sliceName(g, byDose ? 'dose' : 'time')
    // Each slice drawn at its own time (dose curves) or dose (time curves).
    const line = byDose
      ? { x: fineTimes.map(() => g), y: fineTimes, z: timeCurve(g) }
      : { x: fineDoses, y: fineDoses.map(() => g), z: doseCurve(g) }
    const hover = (label: string): string =>
      tooltip(
        {
          conds: xyConds(),
          values: [[label, '%{z:.3f}']]
        },
        p.textMuted,
        { template: true }
      )
    traces.push({
      type: 'scatter3d',
      mode: 'lines',
      name,
      legendgroup: name,
      x: line.x,
      y: line.y,
      z: line.z,
      ...textOf(line.x, line.y),
      opacity: look.lineOpacity,
      line: { color: col, width: look.lineWidth },
      hovertemplate: hover(lineLabel)
    })
    // The error under its points: a band — a ribbon from −SE to +SE in the line's own plane,
    // joined straight between levels as the line is — or whiskers on each level. Both answer
    // the hover as their line's group: a 3-D scene picks the mark under the pointer, so one
    // that skipped the hover would hide the line behind it from it.
    const lv = cells
      .filter((c) => (byDose ? c.dose : c.time) === g)
      .sort((a, b) => (byDose ? a.time - b.time : a.dose - b.dose))
    if (showErrors && look.errorStyle === 'band' && lv.length > 1)
      traces.push({
        type: 'mesh3d',
        name,
        legendgroup: name,
        showlegend: false,
        x: lv.flatMap((c) => [c.dose, c.dose]),
        y: lv.flatMap((c) => [c.time, c.time]),
        z: lv.flatMap((c) => [c.y - (c.se ?? 0), c.y + (c.se ?? 0)]),
        ...textOf(
          lv.flatMap((c) => [c.dose, c.dose]),
          lv.flatMap((c) => [c.time, c.time])
        ),
        // two triangles per gap between levels k and k + 1 (vertices 2k: low, 2k + 1: high)
        i: lv.slice(1).flatMap((_, k) => [2 * k, 2 * k + 1]),
        j: lv.slice(1).flatMap((_, k) => [2 * k + 1, 2 * k + 3]),
        k: lv.slice(1).flatMap((_, k) => [2 * k + 2, 2 * k + 2]),
        color: look.errorColor !== AUTO ? look.errorColor : col,
        opacity: look.errorOpacity,
        // flat colour, unshaded — a band, not a solid
        flatshading: true,
        lighting: { ambient: 1, diffuse: 0, specular: 0, roughness: 1, fresnel: 0 },
        hovertemplate: hover('log₂FC ± SE')
      })
    else if (showErrors)
      traces.push({
        type: 'scatter3d',
        mode: 'markers',
        name,
        legendgroup: name,
        showlegend: false,
        x: lv.map((c) => c.dose),
        y: lv.map((c) => c.time),
        z: lv.map((c) => c.y),
        ...textOf(
          lv.map((c) => c.dose),
          lv.map((c) => c.time)
        ),
        marker: { size: 0.1, opacity: 0 },
        error_z: {
          type: 'data',
          array: lv.map((c) => c.se ?? 0),
          visible: true,
          color: errorInk(col),
          thickness: 1.5,
          width: 3
        },
        customdata: lv.map((c) => c.se ?? 0),
        hovertemplate: tooltip(
          {
            conds: xyConds(),
            values: [
              ['log₂FC', '%{z:.3f}'],
              ['SE', '%{customdata:.3f}']
            ]
          },
          p.textMuted,
          { template: true }
        )
      })
    if (look.points) {
      const pts = spread(lv)
      traces.push({
        type: 'scatter3d',
        mode: 'markers',
        name,
        legendgroup: name,
        showlegend: false,
        x: pts.map((c) => c.dose),
        y: pts.map((c) => c.time),
        z: pts.map((c) => c.y),
        ...textOf(
          pts.map((c) => c.dose),
          pts.map((c) => c.time)
        ),
        marker: {
          ...pointColor(
            pts.map((c) => c.y),
            zAbs,
            col
          ),
          size: pointSize,
          opacity: look.pointOpacity
        },
        hovertemplate: hover(pointLabel)
      })
    }
  })
  // (the reference's markers stay out of the legend: it lists the slices)
  traces.push(...controlTraces(ctx, false))
  return finish3(ctx, true, byDose ? doseLabel : timeLabel)
}

/** line (2-D): one line per slice along the other axis, with its error and points. */
export function line2dPlot(ctx: ResponseContext): ResponsePlot {
  const {
    look,
    slice,
    doseLabel,
    timeLabel,
    valueRange,
    p,
    xLog,
    yLog,
    cells,
    spread,
    errorInk,
    showErrors,
    doses,
    times,
    xZero,
    yZero,
    sliceName,
    sliceColor,
    zAbs,
    traces,
    base,
    pointSize,
    pointColor,
    valueTitle,
    pointLabel,
    heldRange,
    tx,
    itx,
    uOf,
    iu,
    perDose,
    perTime,
    lineLabel,
    doseCurve,
    timeCurve
  } = ctx
  // Dose curves, one line per time (dose along x) — or, sliced by dose, time curves, one line
  // per dose (time along x). The same pick as the 3-D lines'.
  const byDose = perDose || (!perTime && slice === 'dose')
  const groups = byDose ? doses : times
  // a cell's place along x, that axis's own coordinate and back, its title and scale
  const along = (c: { dose: number; time: number }): number => (byDose ? c.time : c.dose)
  const fwd = byDose ? uOf : tx
  const inv = byDose ? iu : itx
  const xLabel = byDose ? timeLabel : doseLabel
  const xIsLog = byDose ? yLog : xLog
  groups.forEach((g, i) => {
    const pts = cells
      .filter((c) => (byDose ? c.dose : c.time) === g)
      .sort((a, b) => along(a) - along(b))
    const col = sliceColor(i, groups.length, byDose ? 'dose' : 'time')
    const name = sliceName(g, byDose ? 'dose' : 'time')
    // The description's curve at this level over its measured levels along x (flat with
    // none); measured values, joined straight.
    const lx0 = fwd(along(pts[0]))
    const lx1 = fwd(along(pts[pts.length - 1]))
    const lxs = Array.from({ length: SAMPLES + 1 }, (_, k) => lx0 + ((lx1 - lx0) * k) / SAMPLES)
    // (measured values too: straight between the levels, sampled along them as a model's curve
    // is, so the line answers the hover anywhere on it, not only near a level)
    const lineX = lxs.map(inv)
    const lineY = byDose ? timeCurve(g, lxs) : doseCurve(g, lxs)
    const conds: [string, string | number][] = [
      [byDose ? doseLabel : timeLabel, name],
      [xLabel, '%{x:.3g}']
    ]
    const val = '%{y:.3f}'
    // The fold change's SE, under the line: a band along it or whiskers at each dose.
    if (showErrors)
      traces.push(
        ...errorTraces(
          pts.map(along),
          pts.map((c) => c.y),
          pts.map((c) => c.y - (c.se ?? 0)),
          pts.map((c) => c.y + (c.se ?? 0)),
          errorInk(col),
          look.errorStyle
        ).map((tr) => ({ ...tr, name, legendgroup: name }))
      )
    traces.push({
      type: 'scatter',
      mode: 'lines',
      name,
      legendgroup: name,
      x: lineX,
      y: lineY,
      opacity: look.lineOpacity,
      line: { color: col, width: look.lineWidth },
      hovertemplate: tooltip(
        {
          conds,
          values: [[lineLabel, val]]
        },
        p.textMuted,
        { template: true }
      )
    })
    const reps = spread(pts)
    if (look.points)
      traces.push({
        type: 'scatter',
        mode: 'markers',
        name,
        legendgroup: name,
        showlegend: false,
        x: reps.map(along),
        y: reps.map((c) => c.y),
        marker: {
          ...pointColor(
            reps.map((c) => c.y),
            zAbs,
            col
          ),
          size: pointSize,
          opacity: look.pointOpacity,
          line: { color: p.panel, width: 1 }
        },
        hovertemplate: tooltip({ conds, values: [[pointLabel, val]] }, p.textMuted, {
          template: true
        })
      })
  })
  // A log x axis at its decades — and, where its 0 is a data level (against one position, dose
  // 0: drawn a median step below the lowest level), a tick there labelled 0, as in 3-D.
  const logZeroTicks = (): Record<string, unknown> => {
    const zero = byDose ? yZero : xZero
    const xs = [...new Set(cells.map(along))].filter((v) => v > 0)
    if (!xs.includes(zero)) return { dtick: 1 }
    const lo = Math.min(...xs)
    const hi = Math.max(...xs)
    const decades: number[] = []
    for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e++)
      if (10 ** e > zero) decades.push(10 ** e)
    // as Plotly labels decades: 1000 in full, 10k on
    const fmt = (v: number): string => (v >= 10000 ? `${v / 1000}k` : String(v))
    return {
      tickmode: 'array',
      tickvals: [zero, ...decades],
      ticktext: ['0', ...decades.map(fmt)]
    }
  }
  return {
    data: traces,
    layout: {
      ...base,
      showlegend: true,
      legend: { title: { text: byDose ? doseLabel : timeLabel }, yanchor: 'middle', y: 0.5 },
      xaxis: xIsLog
        ? { ...axisBase(p), title: xLabel, type: 'log', ...logZeroTicks() }
        : { ...axisBase(p), title: xLabel, type: 'linear' },
      yaxis: {
        ...axisBase(p),
        title: valueTitle,
        zeroline: true,
        ...(valueRange ? { range: heldRange('y') } : null)
      }
    }
  }
}
