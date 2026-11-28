/**
 * The Response plot's heatmap view (ResponseSurfaceView): the measured effect over dose × time,
 * on the value colour scale.
 */
import { tooltip } from '../../ui/plot/condTooltip'
import { axisBase } from '../../ui/app/theme'

import type { ResponseContext, ResponsePlot } from './responseContext'

// heatmap: measured effect, dose across, time down (earliest at the top) — with the reference:
// the vehicle's column (dose 0) and a baseline level's row (t₀), each cell its samples' mean vs
// its level's vehicle (the vehicle's own scattering about 0: its replicates in the hover).
// Levels a log axis had to place (0) keep that place here, labelled 0.
export function heatmapPlot(ctx: ResponseContext): ResponsePlot {
  const {
    measured,
    doseLabel,
    timeLabel,
    shiftRange,
    p,
    xLog,
    yLog,
    doses,
    times,
    at,
    controls,
    xZero,
    yZero,
    placeX,
    placeY,
    shift,
    refAt,
    shiftName,
    zAbs,
    traces,
    base,
    scale,
    valueName,
    pointLabel,
    flat,
    what,
    cellValue
  } = ctx
  const ctl = new Map(controls.map((c) => [`${placeX(c.dose)}|${placeY(c.time)}`, c]))
  const hd = [...new Set([...doses, ...controls.map((c) => placeX(c.dose))])].sort((a, b) => a - b)
  const ht = [...new Set([...times, ...controls.map((c) => placeY(c.time))])].sort((a, b) => a - b)
  const levelName = (v: number, zero: number, log: boolean): string =>
    log && v === zero ? '0' : String(v)
  const xs = hd.map((d) => levelName(d, xZero, xLog))
  const ys = ht.map((t) => levelName(t, yZero, yLog))
  const f3 = (v: number): string => v.toFixed(3)
  const z: Array<Array<number | null>> = []
  const text: string[][] = []
  ht.forEach((t, i) => {
    z.push([])
    text.push([])
    hd.forEach((d, j) => {
      const conds: [string, string][] = [
        [doseLabel, xs[j]],
        [timeLabel, ys[i]]
      ]
      const c = at.get(`${d}|${t}`)
      const k = ctl.get(`${d}|${t}`)
      if (c) {
        const fit = cellValue(c.dose, c.time)
        // testing changes: the cell's shift from the reference curve (its colour)
        const ref = refAt(c)
        const sh = shift ? (ref == null ? null : c.y - ref) : null
        z[i].push(shift ? sh : c.y)
        text[i].push(
          tooltip(
            {
              conds,
              // measured values have no fit beside them
              values: [
                [pointLabel, f3(c.y)],
                ...(measured || flat || fit == null || !Number.isFinite(fit)
                  ? []
                  : [[what, f3(fit)] as [string, string]]),
                ...(sh != null ? [[shiftName, f3(sh)] as [string, string]] : [])
              ]
            },
            p.textMuted
          )
        )
      } else if (k) {
        z[i].push(k.y)
        text[i].push(
          tooltip(
            {
              title: k.vehicle ? 'control' : 'baseline level',
              conds,
              values: [
                ['mean log₂ vs control', f3(k.y)],
                ['replicates', k.reps.map(f3).join(', ')]
              ]
            },
            p.textMuted
          )
        )
      } else {
        z[i].push(null)
        text[i].push('')
      }
    })
  })
  traces.push({
    type: 'heatmap',
    x: xs,
    y: ys,
    z,
    text,
    hoverongaps: false,
    colorscale: scale,
    // testing changes: the shifts' own range, else the values'
    ...(() => {
      const m = shift
        ? (shiftRange ?? Math.max(0.1, ...z.flat().map((v) => (v == null ? 0 : Math.abs(v)))))
        : zAbs
      return { zmin: -m, zmax: m }
    })(),
    colorbar: { title: { text: shift ? shiftName : valueName }, thickness: 12 },
    hovertemplate: '%{text}<extra></extra>'
  })
  return {
    data: traces,
    layout: {
      ...base,
      xaxis: { ...axisBase(p), title: doseLabel, type: 'category' },
      yaxis: { ...axisBase(p), title: timeLabel, type: 'category', autorange: 'reversed' }
    }
  }
}
