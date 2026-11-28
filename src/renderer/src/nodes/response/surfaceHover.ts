/**
 * The 3-D surface's hover highlight (ResponseSurfaceView): the hovered point's dose and time
 * curves drawn over the surface, the rest faded behind them — restyled in place on the drawn chart.
 */
import Plotly, { type PlotlyGraphDiv } from 'plotly.js-strict-dist-min'

import { keepCameras } from '../../ui/plot/traceFocus'

/** What a hover on the 3-D surface reads (see bindSurfaceHover): the drawn grid — its doses
 *  (x), times (y) and values (z, a row per time) and the same grid on the surface's own axes (log
 *  dose, log(t + offset)) — the measured slices on those axes, the points there, and the look's
 *  opacities to fade from and back to. */
export interface SurfaceHover {
  x: number[]
  y: number[]
  z: Array<Array<number | null>>
  lx: number[]
  u: number[]
  doseLx: number[]
  timeU: number[]
  /** each point — where it's drawn, its colour value (when coloured by value), and where it sits
   *  on the surface's axes */
  points: Array<{ x: number; y: number; z: number; color?: number; lx: number; u: number }>
  surfaceOpacity: number
  curveOpacity: number
  /** where the hover's lines are drawn: the surface's vertices lifted toward the viewer (see
   *  surfaceLift), by row and column as `z` — absent, on the surface itself */
  lift?: { x: number[][]; y: number[][]; z: Array<Array<number | null>> }
}

/** A #rrggbb colour at `k` of its brightness (0–1, toward black) — the hover's lines, a shade
 *  darker than the surface they lie on so they stand out of it. Anything else passes through. */
export function shade(color: string, k: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  const n = parseInt(m[1], 16)
  const c = (v: number): string =>
    Math.round(v * k)
      .toString(16)
      .padStart(2, '0')
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`
}
/** The hover lines' brightness against the surface's palette. */
export const HOVER_LINE_SHADE = 0.75

/** How faint the surface, its curves and the far points go while a point is hovered. */
export const HOVER_DIM = 0.25

/** On the 3-D surface, a hover picks out the point's dose curve (at its time) and time curve (at
 *  its dose): drawn thick and coloured by value, the surface and its grid curves faded behind them,
 *  and the points faded but on the measured slices beside it — the dose and the time the pointer is
 *  on or less than half-way from (the nearest; both on a tie). In place (restyles, no re-render);
 *  everything back on leaving. Returns the unbinding. */
export function bindSurfaceHover(el: PlotlyGraphDiv, hl: SurfaceHover): () => void {
  type Trace = { meta?: { oeRole?: string } }
  const roleOf = (k: number): string | undefined => ((el.data ?? []) as Trace[])[k]?.meta?.oeRole
  const idx = (...roles: string[]): number[] =>
    ((el.data ?? []) as Trace[]).flatMap((t, i) =>
      roles.includes(t.meta?.oeRole ?? '') ? [i] : []
    )
  const nearest = (arr: number[], v: number): number => {
    let k = 0
    for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - v) < Math.abs(arr[k] - v)) k = i
    return k
  }
  // The measured slices the pointer is on or less than half-way from: the nearest (both on a tie).
  const adjacent = (slices: number[], v: number): number[] => {
    const d = slices.map((x) => Math.abs(x - v))
    const m = Math.min(...d)
    return slices.filter((_, i) => d[i] <= m + 1e-9)
  }
  const on = (slices: number[], v: number): boolean => slices.some((x) => Math.abs(x - v) < 1e-9)
  let at: string | null = null
  let raf = 0
  // Leaving waits a moment: a restyle redraws the scene, which can report the pointer leaving
  // and arriving again — a clear in between would flicker the highlight off and on.
  let leave: ReturnType<typeof setTimeout> | undefined
  const clearSoon = (): void => {
    clearTimeout(leave)
    leave = setTimeout(clear, 120)
  }
  const R = Plotly as unknown as {
    restyle: (e: PlotlyGraphDiv, u: Record<string, unknown>, i: number[]) => Promise<unknown>
  }
  // Every restyle redraws the whole 3-D scene, so each hover step makes ONE, carrying only what
  // changed: the lines every step; the fade on entering (and leaving); the points' split only
  // when the nearest dose or time slice changes. (A trace left undefined in an update is skipped.)
  let faded = false
  let split: string | null = null
  const restyle = (edits: Array<[number | undefined, string, unknown]>): void => {
    const traces: number[] = []
    const upd: Record<string, unknown[]> = {}
    for (const [k, attr, v] of edits) {
      if (k == null) continue
      let n = traces.indexOf(k)
      if (n < 0) n = traces.push(k) - 1
      ;(upd[attr] ??= [])[n] = v
    }
    if (!traces.length) return
    // every attribute's list as long as the traces (Plotly cycles a shorter one)
    for (const v of Object.values(upd)) v.length = traces.length
    keepCameras(el)
    void R.restyle(el, upd, traces)
  }
  // The points split: those on the adjacent slices in the lit trace, the rest in the faded one.
  const placePoints = (
    edits: Array<[number | undefined, string, unknown]>,
    lit: SurfaceHover['points'],
    dim: SurfaceHover['points']
  ): void => {
    const [pl] = idx('points')
    const [pd] = idx('pointsDim')
    const byValue = hl.points.some((p) => p.color != null)
    for (const [k, ps, shown] of [
      [pl, lit, true],
      [pd, dim, dim.length > 0]
    ] as const) {
      edits.push(
        [k, 'x', ps.map((p) => p.x)],
        [k, 'y', ps.map((p) => p.y)],
        [k, 'z', ps.map((p) => p.z)],
        [k, 'visible', shown]
      )
      if (byValue) edits.push([k, 'marker.color', ps.map((p) => p.color)])
    }
  }
  const fadeTo = (edits: Array<[number | undefined, string, unknown]>, f: number): void => {
    for (const k of idx('surface', 'curve'))
      edits.push([
        k,
        'opacity',
        (roleOf(k) === 'surface' ? hl.surfaceOpacity : hl.curveOpacity) * f
      ])
  }
  const show = (i: number, j: number): void => {
    const key = `${i}|${j}`
    if (key === at) return
    at = key
    const edits: Array<[number | undefined, string, unknown]> = []
    const [ld, lt] = idx('hlDose', 'hlTime')
    const row = hl.z[i]
    const col = hl.z.map((r) => r[j])
    // drawn lifted off the surface (coloured by the value there)
    const L = hl.lift
    edits.push(
      [ld, 'x', L ? L.x[i] : hl.x],
      [ld, 'y', L ? L.y[i] : hl.x.map(() => hl.y[i])],
      [ld, 'z', L ? L.z[i] : row],
      [ld, 'line.color', row.map((v) => v ?? 0)],
      [ld, 'visible', true],
      [lt, 'x', L ? L.x.map((r) => r[j]) : hl.y.map(() => hl.x[j])],
      [lt, 'y', L ? L.y.map((r) => r[j]) : hl.y],
      [lt, 'z', L ? L.z.map((r) => r[j]) : col],
      [lt, 'line.color', col.map((v) => v ?? 0)],
      [lt, 'visible', true]
    )
    if (!faded) {
      faded = true
      fadeTo(edits, HOVER_DIM)
    }
    const nd = adjacent(hl.doseLx, hl.lx[j])
    const nt = adjacent(hl.timeU, hl.u[i])
    const near = `${nd.join(',')}|${nt.join(',')}`
    if (near !== split) {
      split = near
      const lit = (p: SurfaceHover['points'][number]): boolean => on(nd, p.lx) || on(nt, p.u)
      placePoints(
        edits,
        hl.points.filter(lit),
        hl.points.filter((p) => !lit(p))
      )
    }
    restyle(edits)
  }
  const clear = (): void => {
    if (at == null) return
    at = null
    const edits: Array<[number | undefined, string, unknown]> = []
    for (const k of idx('hlDose', 'hlTime')) edits.push([k, 'visible', false])
    if (faded) {
      faded = false
      fadeTo(edits, 1)
    }
    if (split != null) {
      split = null
      placePoints(edits, hl.points, [])
    }
    restyle(edits)
  }
  const onHover = (e: {
    points?: Array<{ curveNumber: number; x: unknown; y: unknown }>
  }): void => {
    const p0 = e.points?.[0]
    const role = p0 ? roleOf(p0.curveNumber) : undefined
    // A point keeps what's shown (its slices are already the lit ones).
    if (role === 'points' || role === 'pointsDim') return
    cancelAnimationFrame(raf)
    clearTimeout(leave)
    // On the surface — or on its curves or the highlight itself, which lie on it — the point's
    // curves; anywhere else, nothing.
    if (p0 && (role === 'surface' || role === 'curve' || role === 'hlDose' || role === 'hlTime')) {
      const x = Number(p0.x)
      const y = Number(p0.y)
      raf = requestAnimationFrame(() => show(nearest(hl.y, y), nearest(hl.x, x)))
    } else clearSoon()
  }
  const onUnhover = (): void => {
    cancelAnimationFrame(raf)
    clearSoon()
  }
  const g = el as unknown as {
    on: (ev: string, cb: (e: never) => void) => void
    removeListener: (ev: string, cb: (e: never) => void) => void
  }
  g.on('plotly_hover', onHover)
  g.on('plotly_unhover', onUnhover)
  return () => {
    cancelAnimationFrame(raf)
    clearTimeout(leave)
    g.removeListener('plotly_hover', onHover)
    g.removeListener('plotly_unhover', onUnhover)
  }
}
