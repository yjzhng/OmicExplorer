/**
 * A 3-D Response plot's frame (ResponseSurfaceView): the reference's markers, the layout and the
 * axes around a 3-D view's traces, and those axes drawn in the scene for the side it's seen from.
 */
import { tooltip } from '../../ui/plot/condTooltip'
import { niceTicks, strokeAxes3d, type StrokeAxis } from '../../ui/plot/strokeAxes3d'
import { liftGrid } from '../../ui/plot/surfaceLift'
import { plotFontCss } from '../../ui/app/theme'

import type { AxisLevels, ResponseContext } from './responseContext'
import type { SurfaceHover } from './surfaceHover'

/** How much closer than Plotly's own fit a 3-D view opens (its box's aspect ratio, scaled). */
const ZOOM_3D = 1.3

// A log axis labelled at its powers of ten only (Plotly's 3-D log axes otherwise label the
// 2s and 5s too) — or, spanning less than two of them, at the measured levels: each once, in
// order (the axis's padding reads its first and last two ticks — a control's level repeated at
// the end would pad the range back inside the data).
const logTicks = (vals: number[]): number[] => {
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const decades: number[] = []
  for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e++)
    decades.push(10 ** e)
  return decades.length >= 2 ? decades : [...new Set(vals)].sort((a, b) => a - b)
}

// The reference in 3-D: each sample as an open marker at its levels — the vehicle's in the
// muted ink, a baseline level's treated samples coloured by value as the points. With the points.
export function controlTraces(ctx: ResponseContext, legend: boolean): Record<string, unknown>[] {
  const { look, controls, p, pointColor, zAbs, pointSize, placeX, placeY, doseLabel, timeLabel } =
    ctx
  return !look.points
    ? []
    : ([true, false] as const).flatMap((veh) => {
        const cs = controls.filter((c) => !!c.vehicle === veh)
        if (!cs.length) return []
        const smp = cs.flatMap((c) =>
          (c.reps.length ? c.reps : [c.y]).map((y) => ({ dose: c.dose, time: c.time, y }))
        )
        const what = veh ? 'control' : 'baseline level'
        return [
          {
            type: 'scatter3d',
            mode: 'markers',
            name: what,
            showlegend: legend,
            meta: { oeRole: 'controls' },
            x: smp.map((c) => placeX(c.dose)),
            y: smp.map((c) => placeY(c.time)),
            z: smp.map((c) => c.y),
            customdata: smp.map((c) => [c.dose, c.time]),
            marker: {
              ...(veh
                ? { color: p.textMuted }
                : pointColor(
                    smp.map((c) => c.y),
                    zAbs
                  )),
              symbol: 'circle-open',
              size: pointSize + 1,
              opacity: look.pointOpacity
            },
            hovertemplate: tooltip(
              {
                title: what,
                conds: [
                  [doseLabel, '%{customdata[0]}'],
                  [timeLabel, '%{customdata[1]}']
                ],
                values: [['log₂ vs control', '%{z:.3f}']]
              },
              p.textMuted,
              { template: true }
            )
          }
        ]
      })
}

// A 3-D view: the traces, the layout around them, and its axes — drawn in the scene (labels
// lying in the box's planes — see strokeAxes3d) once the side it's seen from is known.
export function finish3(
  ctx: ResponseContext,
  legend: boolean,
  legendTitle = ctx.timeLabel
): {
  data: Record<string, unknown>[]
  layout: Record<string, unknown>
  axes3: Parameters<typeof strokeAxes3d>
} {
  const {
    traces,
    zExtent,
    valueRange,
    xLog,
    yLog,
    doseLabel,
    timeLabel,
    doses,
    times,
    controls,
    placeX,
    placeY,
    xZero,
    yZero,
    levels,
    valueTitle,
    p,
    grid3,
    base
  } = ctx
  // Each axis runs half a tick interval past the data at either end, so the data (and the
  // labels at its ends) don't crowd the box's edges; a set value range is kept as set.
  const ze = zExtent()
  const zt = niceTicks(ze[0], ze[1])
  const zStep = zt.ticks.length > 1 ? zt.ticks[1] - zt.ticks[0] : (ze[1] - ze[0]) / 4
  const zr: [number, number] = valueRange ? ze : [ze[0] - zStep / 2, ze[1] + zStep / 2]
  const logAxis = (title: string, vals: number[], zero?: number): StrokeAxis => {
    // a placed 0 (a control's level, a position's base) is a tick of its own, labelled 0
    const real = vals.filter((v) => v !== zero)
    const decadeTicks = logTicks(real.length ? real : vals)
    const hasZero = zero != null && vals.includes(zero)
    const ticks = hasZero ? [zero, ...decadeTicks.filter((t) => t > zero)] : decadeTicks
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    // half the first and last tick intervals (in log units), or half a decade for one tick
    const L = ticks.map((t) => Math.log10(t))
    const padLo = L.length > 1 ? (L[1] - L[0]) / 2 : 0.5
    const padHi = L.length > 1 ? (L[L.length - 1] - L[L.length - 2]) / 2 : 0.5
    return {
      title,
      ticks,
      labels: ticks.map((v) => (hasZero && v === zero ? '0' : String(v))),
      range: [lo / 10 ** padLo, hi * 10 ** padHi],
      log: true
    }
  }
  // A linear axis at nice ticks, half a tick interval past the data at either end — or, named
  // levels, at the levels, half the narrowest gap past the ends.
  const linAxis = (title: string, vals: number[], L?: AxisLevels): StrokeAxis => {
    if (L) {
      // the levels in axis order, each with its name
      const order = L.at.map((_, i) => i).sort((i, j) => L.at[i] - L.at[j])
      const at = order.map((i) => L.at[i])
      const gap = Math.min(...at.slice(1).map((v, i) => v - at[i]), Infinity)
      const half = Number.isFinite(gap) && gap > 0 ? gap / 2 : 0.5
      return {
        title,
        ticks: at,
        labels: order.map((i) => L.names[i]),
        range: [at[0] - half, at[at.length - 1] + half],
        log: false
      }
    }
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    const t = niceTicks(lo, hi === lo ? lo + 1 : hi)
    const step = t.ticks.length > 1 ? t.ticks[1] - t.ticks[0] : (hi - lo || 1) / 4
    return {
      title,
      ticks: t.ticks,
      labels: t.labels,
      range: [lo - step / 2, hi + step / 2],
      log: false
    }
  }
  return {
    data: traces,
    axes3: [
      {
        x: xLog
          ? logAxis(doseLabel, [...doses, ...controls.map((c) => placeX(c.dose))], xZero)
          : linAxis(doseLabel, [...doses, ...controls.map((c) => c.dose)], levels?.x),
        y: yLog
          ? logAxis(timeLabel, [...times, ...controls.map((c) => placeY(c.time))], yZero)
          : linAxis(timeLabel, [...times, ...controls.map((c) => c.time)], levels?.y),
        z: { title: valueTitle, ticks: zt.ticks, labels: zt.labels, range: zr, log: false }
      },
      { line: p.textMuted, grid: grid3, ink: p.textMuted }
    ],
    layout: {
      ...base,
      showlegend: legend,
      // The legend (and a colour bar, below) inside the plot's right edge, not in a margin of
      // their own: the scene is centred on the whole tile, the key in the space beside it.
      ...(legend
        ? {
            legend: {
              title: { text: legendTitle },
              x: 1,
              xanchor: 'right',
              yanchor: 'middle',
              y: 0.5
            }
          }
        : null),
      // the 2-D axes a 3-D plot never uses — hidden, or an axis style (lines, frame) set for
      // the app's plots would draw them across the scene
      xaxis: { visible: false },
      yaxis: { visible: false },
      // Keep the user's turn and zoom across re-renders (paging genes, a setting) —
      // Plotly.react otherwise puts the scene back to the camera below.
      uirevision: 'response-3d',
      scene: {
        uirevision: 'response-3d',
        // From the front-right corner, above, looking a little below the middle (−z moves
        // the plot up): perspective draws the near corner large, and centred its labels
        // ran off the bottom. Raised to ~35° (isometric; the distance as before) so the
        // labels lying on the floor read at an angle, not edge-on.
        camera: {
          eye: { x: 1.4, y: -1.4, z: 1.4 },
          center: { x: 0, y: 0, z: -0.15 }
        }
      },
      margin: { l: 0, r: 0, t: 5, b: 5 }
    }
  }
}

// A 3-D view's axes, drawn for the side it's seen from: their traces after the view's, and
// Plotly's own axes hidden, the ranges padded for the drawn labels, the data box a cube.
export function sceneWithAxes(
  plotData: Record<string, unknown>[],
  plotLayout: Record<string, unknown>,
  axes3: Parameters<typeof strokeAxes3d> | undefined,
  side: string,
  hl: SurfaceHover | undefined,
  resume: Record<string, unknown> | null
): {
  data: Record<string, unknown>[]
  layout: Record<string, unknown>
  hlLifted: SurfaceHover | undefined
} {
  if (!axes3) return { data: plotData, layout: plotLayout, hlLifted: hl }
  const [ax, colors] = axes3
  const drawn = strokeAxes3d(
    ax,
    colors,
    {
      x: side[0] === '+' ? 1 : -1,
      y: side[1] === '+' ? 1 : -1,
      z: side[2] === '+' ? 1 : -1
    },
    // the plot font (a change remounts the tile, so this re-runs)
    plotFontCss()
  )
  const sc = plotLayout.scene as Record<string, unknown>
  // The surface's curves, moved a hair toward the camera (see surfaceLift) — their vertices
  // are the surface's own (the measured levels are rows and columns of its grid). Along the
  // camera's line of sight: the one the view was left at (resume) or its default.
  const cam = (resume ?? sc.camera ?? {}) as {
    eye?: { x?: number; y?: number; z?: number }
    center?: { x?: number; y?: number; z?: number }
  }
  const toward: [number, number, number] = (['x', 'y', 'z'] as const).map(
    (k) => (cam.eye?.[k] ?? 1) - (cam.center?.[k] ?? 0)
  ) as [number, number, number]
  const sceneAxis = (k: 'xaxis' | 'yaxis' | 'zaxis') => {
    const a = drawn.scene[k] as { range: [number, number]; type?: string }
    return { range: a.range, log: a.type === 'log' }
  }
  // The box drawn larger than Plotly would fit it: the scene opens closer up (its zoom).
  const fit = drawn.scene.aspectratio as { x: number; y: number; z: number }
  const aspect = { x: fit.x * ZOOM_3D, y: fit.y * ZOOM_3D, z: fit.z * ZOOM_3D }
  const lift = hl
    ? liftGrid(
        hl.x,
        hl.y,
        hl.z,
        {
          axes: [sceneAxis('xaxis'), sceneAxis('yaxis'), sceneAxis('zaxis')],
          aspect: [aspect.x, aspect.y, aspect.z]
        },
        toward
      )
    : null
  const col = new Map(hl?.x.map((v, j) => [v, j]))
  const row = new Map(hl?.y.map((v, i) => [v, i]))
  const lifted = !lift
    ? plotData
    : plotData.map((t) => {
        if ((t.meta as { oeRole?: string } | undefined)?.oeRole !== 'curve') return t
        const xs = t.x as number[]
        const ys = t.y as number[]
        const at = xs.map((v, k) => [row.get(ys[k]), col.get(v)] as const)
        if (at.some(([i, j]) => i == null || j == null)) return t
        return {
          ...t,
          x: at.map(([i, j]) => lift.x[i!][j!]),
          y: at.map(([i, j]) => lift.y[i!][j!]),
          z: at.map(([i, j]) => lift.z[i!][j!])
        }
      })
  return {
    data: [...lifted, ...drawn.traces],
    layout: { ...plotLayout, scene: { ...sc, ...drawn.scene, aspectratio: aspect } },
    hlLifted: hl && lift ? { ...hl, lift } : hl
  }
}
