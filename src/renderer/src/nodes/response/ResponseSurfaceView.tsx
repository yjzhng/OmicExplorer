/**
 * One gene's dose × time response surface (a Curve fit by the response surface method) — the
 * Response plot. Values are log₂ against the fit's baseline (one position, or the vehicle at each
 * time). What the model is, and what it reads at any dose × time — a control's 0 included — is
 * engine/surfaceModel.ts's, the one reading every view and the descriptor's fold change take; this
 * view only draws it.
 *
 *  - line (2-D): dose curves, one per time point (the legend), coloured early → late; the level
 *    means as points (coloured by their log₂ on the value palette, as in every view) and, as the
 *    line, the model's dose curve at that time (its Curve fit's model view — engine/modelView.ts):
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import Plotly, { type PlotlyGraphDiv } from 'plotly.js-strict-dist-min'

import { useNearView } from '../../dashboard/useInView'

import {
  condLabel,
  placed,
  shiftReference,
  surfaceAxes,
  surfaceModel,
  type CompareResultRow,
  type ModelView
} from '../../engine'
import type { ResponseLook } from '../../graph/types'
import { AUTO } from '../../ui/ColorPicker'
import { paletteScale, paletteSeries, type PaletteRef, type PaletteRole } from '../../ui/palettes'
import { useRolePalette } from '../../ui/useAppSettings'
import { tooltip } from '../../ui/condTooltip'
import { PlotlyChart } from '../../ui/PlotlyChart'
import { keepCameras } from '../../ui/traceFocus'
import { errorTraces } from '../../ui/errorTraces'
import { niceTicks, strokeAxes3d, type StrokeAxis } from '../../ui/strokeAxes3d'
import { liftGrid } from '../../ui/surfaceLift'
import { axisBase, PALETTES, plotBase, plotFontCss, withAlpha } from '../../ui/theme'
import { useUiTheme } from '../../ui/useUiTheme'

export type ResponseShow = 'line' | 'surface' | 'heatmap'

/** An axis of named levels (ResponseSurfaceView's `levels`): each level's position and name. */
export interface AxisLevels {
  at: number[]
  names: string[]
}

/** Evenly spaced points along each time's 4PL (2-D), and per axis of the 3-D grid (97 × 97
 *  vertices: visibly smooth, still light for WebGL). */
const SAMPLES = 60
const GRID = 96

/** A measured dose × time level: its log₂FC, the fold change's SE, and its replicates (each
 *  sample over the control's mean, log₂ — from the Clean data the Compare ran on). */
export interface MeasuredCell {
  dose: number
  time: number
  y: number
  se?: number
  reps?: number[]
}

/** What a hover on the 3-D surface reads (see bindSurfaceHover): the drawn grid — its doses
 *  (x), times (y) and values (z, a row per time) and the same grid on the surface's own axes (log
 *  dose, log(t + offset)) — the measured slices on those axes, the points there, and the look's
 *  opacities to fade from and back to. */
interface SurfaceHover {
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
function shade(color: string, k: number): string {
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
const HOVER_LINE_SHADE = 0.75

/** How much closer than Plotly's own fit a 3-D view opens (its box's aspect ratio, scaled). */
const ZOOM_3D = 1.3

/** How faint the surface, its curves and the far points go while a point is hovered. */
const HOVER_DIM = 0.25

/** On the 3-D surface, a hover picks out the point's dose curve (at its time) and time curve (at
 *  its dose): drawn thick and coloured by value, the surface and its grid curves faded behind them,
 *  and the points faded but on the measured slices beside it — the dose and the time the pointer is
 *  on or less than half-way from (the nearest; both on a tie). In place (restyles, no re-render);
 *  everything back on leaving. Returns the unbinding. */
function bindSurfaceHover(el: PlotlyGraphDiv, hl: SurfaceHover): () => void {
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

/** The side a 3-D camera sees the scene from: the signs of its eye less its centre, as '+-+'
 *  (from +x, −y, above); undefined for something that isn't a camera. */
function sideOf(camera: unknown): string | undefined {
  const c = camera as
    | {
        eye?: Partial<Record<'x' | 'y' | 'z', number>>
        center?: Partial<Record<'x' | 'y' | 'z', number>>
      }
    | undefined
  if (!c?.eye) return undefined
  const sign = (k: 'x' | 'y' | 'z'): string =>
    (c.eye?.[k] ?? 0) - (c.center?.[k] ?? 0) >= 0 ? '+' : '-'
  return sign('x') + sign('y') + sign('z')
}

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
  // A 3-D scene holds a WebGL context while mounted (Chromium keeps ~16 a page, and a hidden
  // dashboard tab stays mounted), so it's mounted only while near the screen; away, a placeholder
  // of the same size holds its place. The user's last turn / zoom is kept to put back on return.
  const boxRef = useRef<HTMLDivElement>(null)
  const near = useNearView(boxRef)
  const cameraRef = useRef<Record<string, unknown> | null>(null)
  // The side the scene is seen from (the signs of the camera's eye less its centre: '+-+' is
  // from +x, −y, above), which places the drawn axes (see strokeAxes3d) — redrawn when a turn
  // ends on another side.
  const [side, setSide] = useState('+-+')
  const sideRef = useRef(side)
  // The camera it was left at, taken as it goes away (and drawn from when it's back).
  const [resume, setResume] = useState<Record<string, unknown> | null>(null)
  // A camera now on another side: redraw the axes for it — drawn FROM it, so the redraw can't put
  // the scene back to an older camera (Plotly may not have taken the turn as the user's yet, and
  // would then draw the layout's), which the next check would read as a turn back, and so on.
  const syncSide = useCallback((camera: unknown): void => {
    const sd = sideOf(camera)
    if (!sd || sd === sideRef.current) return
    sideRef.current = sd
    setResume(camera as Record<string, unknown>)
    setSide(sd)
  }, [])
  const onCamera = useCallback(
    (_scene: string, camera: Record<string, unknown>): void => {
      cameraRef.current = camera
      syncSide(camera)
    },
    [syncSide]
  )
  useEffect(() => {
    if (!near && cameraRef.current) setResume(cameraRef.current)
  }, [near])
  // A new projection is a new camera to Plotly, which would put the turn and zoom back to the
  // default — so it's drawn from the camera the user left, as a remount is.
  useEffect(() => {
    if (cameraRef.current) setResume(cameraRef.current)
  }, [projection])
  // Lines per time / per dose (per y / x level) run along those levels' palette roles unless the
  // plot picked one.
  const timeRole = useRolePalette(yRole)
  const doseRole = useRolePalette(xRole)
  const {
    data: plotData,
    layout: plotLayout,
    hl,
    axes3
  } = useMemo((): {
    data: Record<string, unknown>[]
    layout: Record<string, unknown>
    hl?: SurfaceHover
    /** a 3-D view's axes, drawn in the scene from the side it's seen from (below) */
    axes3?: Parameters<typeof strokeAxes3d>
  } => {
    const p = PALETTES[mode]
    // Each axis log or linear: a fitted surface's always log; measured values' as set.
    // A fitted surface's own axes (rs.maps: any pair, log or linear; absent — dose × time — log on
    // both); measured values' as set.
    const fm = measured ? undefined : row?.rs?.maps
    const xLog = measured
      ? !levels?.x && (scales?.x ?? 'log') === 'log'
      : fm?.[0].scale !== 'linear'
    const yLog = measured
      ? !levels?.y && (scales?.y ?? 'log') === 'log'
      : fm?.[1].scale !== 'linear'
    // A position's level name on a named axis (null: none there — between levels, or unnamed).
    const levelAt = (v: number, L?: AxisLevels): string | null => {
      if (!L) return null
      const i = L.at.findIndex((a) => Math.abs(a - v) <= 1e-9 * Math.max(1, Math.abs(a)))
      return i >= 0 ? L.names[i] : null
    }
    // Named axes: each point's hover names its levels (a template can only format numbers) — in
    // `text`, read by `xyConds`; between levels, nothing.
    const named = !!(levels?.x || levels?.y)
    const xyText = (x: number, y: number): string => {
      const nx = levels?.x ? levelAt(x, levels.x) : `${Number(x.toPrecision(3))}`
      const ny = levels?.y ? levelAt(y, levels.y) : `${Number(y.toPrecision(3))}`
      return nx != null && ny != null
        ? tooltip(
            {
              conds: [
                [doseLabel, nx],
                [timeLabel, ny]
              ]
            },
            PALETTES[mode].textMuted
          )
        : ''
    }
    const xyConds = (xf = '%{x:.3g}', yf = '%{y:.3g}'): Array<[string, string] | string> =>
      named
        ? ['%{text}']
        : [
            [doseLabel, xf],
            [timeLabel, yf]
          ]
    const textOf = (xs: number[], ys: number[]): { text?: string[] } =>
      named ? { text: xs.map((x, i) => xyText(x, ys[i])) } : {}
    // The axes — each one's coordinate, and where a log axis draws 0 — and the model on them
    // (engine/surfaceModel.ts: the one reading of a surface every view and the descriptor's fold
    // change take). Measured levels: each is its own "fit", joined straight; a level at 0 (or
    // below) has no place on a log axis. A fitted surface: its cells and controls (the vehicle, a
    // baseline level's samples — 0 by definition) placed as the fit placed them.
    const measuredCells = measured
      ? measured.cells.filter(
          (c) => (!xLog || c.dose > 0) && (!yLog || c.time > 0) && Number.isFinite(c.y)
        )
      : []
    const rawCells = measured ? measuredCells : (row?.rs?.cells ?? [])
    const axes = surfaceAxes({
      xLog,
      yLog,
      doses: rawCells.map((c) => c.dose),
      times: rawCells.map((c) => c.time),
      maps: fm,
      timeOffset: row?.rs?.timeOffset
    })
    const cells: Array<MeasuredCell & { fitted: number }> = measured
      ? measuredCells.map((c) => ({ ...c, fitted: c.y }))
      : placed(row?.rs?.cells ?? [], axes)
    const allControls = measured ? [] : placed(row?.rs?.controls ?? [], axes)
    const sm = surfaceModel({
      cells,
      controls: allControls,
      axes,
      desc: row?.rs?.surface,
      fromCells: !!measured || model === 'detector',
      join: measured ? 'linear' : 'pchip',
      slice,
      ubar: cells.length ? cells.reduce((a, c) => a + axes.uOf(c.time), 0) / cells.length : 0
    })
    // The points drawn for cells: measured, each one's replicates where the Clean data gives them
    // (as the Dose/time-response plot's focused view); else its value — a fit's level mean.
    const spread = (cs: typeof cells): Array<{ dose: number; time: number; y: number }> =>
      cs.flatMap((c) =>
        (c.reps?.length ? c.reps : [c.y]).map((y) => ({ dose: c.dose, time: c.time, y }))
      )
    // The measured values' error, in a line view: its colour (automatic: the line's).
    const errorInk = (line: string): string =>
      withAlpha(look.errorColor !== AUTO ? look.errorColor : line, look.errorOpacity)
    const showErrors = !!measured && look.errors && cells.some((c) => c.se != null && c.se > 0)
    if (!cells.length) return { data: [], layout: {} }
    const doses = [...new Set(cells.map((c) => c.dose))].sort((a, b) => a - b)
    const times = [...new Set(cells.map((c) => c.time))].sort((a, b) => a - b)
    const at = new Map(cells.map((c) => [`${c.dose}|${c.time}`, c]))
    // The reference: the vehicle's replicates and the treated samples at a baseline level (t₀) —
    // not cells. Shown where the reference reads (the heatmap, 3-D); the 2-D curves leave it out,
    // as response curves do (their log axis has no 0).
    const controls = dim === '3d' || show === 'heatmap' ? allControls : []
    const { xZero, yZero, placeX, placeY } = axes
    // Testing response changes: coloured by each point's shift from the reference curve — the
    // compared axis's base level (dose 0: the vehicle's own curve) at the same response level —
    // rather than by its value; the height still shows the curves themselves (the melt).
    const shift = !measured ? row?.rs?.shift : undefined
    // the curves run along the second axis (time / temperature), compared across the first
    const shiftAlongB = !!shift && shift.response === (row?.rs?.pair?.[1] ?? 'time')
    // the reference curve (engine shiftReference): the compared axis at its control level as the
    // Curve fit set it (placed as the cells are), else its lowest — its cell at a point's response
    // level, or a control there (0)
    const ref = shift
      ? shiftReference(
          cells,
          allControls,
          shiftAlongB,
          // (a result stored without its axes: dose × time against dose 0 at each time)
          shiftAlongB ? placeX(fm?.[0].base ?? 0) : placeY(fm?.[1].base ?? times[0])
        )
      : null
    const refDose = ref && shiftAlongB ? ref.level : doses[0]
    const refTime = ref && !shiftAlongB ? ref.level : times[0]
    const refAt = (c: { dose: number; time: number }): number | null => (ref ? ref.at(c) : null)
    // named by the reference: the compared axis at its base level (dose 0)
    const shiftName = shift
      ? `shift from ${condLabel(shift.across)} ${shiftAlongB ? (fm?.[0].base ?? 0) : (fm?.[1].base ?? 0)}`
      : ''
    // A level's name as the data has it — a log axis's placed 0 reads 0 (a slice's legend entry and
    // hover), not the place it's drawn at.
    const sliceName = (g: number, per: 'dose' | 'time'): string =>
      (per === 'dose' ? levelAt(g, levels?.x) : levelAt(g, levels?.y)) ??
      ((per === 'dose' ? xLog && g === xZero : yLog && g === yZero) ? '0' : `${g}`)
    // A line's colour: one per slice, low → high (early → late for times), along the palette.
    const sliceColor = (i: number, n: number, per: 'time' | 'dose'): string =>
      look.lineColor !== AUTO
        ? look.lineColor
        : paletteSeries(look.linePalette ?? (per === 'dose' ? doseRole : timeRole), i, n)
    const zAbs = valueRange
      ? Math.max(Math.abs(valueRange[0]), Math.abs(valueRange[1]), 0.1)
      : Math.max(...spread(cells).map((c) => Math.abs(c.y)), 0.1)
    const traces: Record<string, unknown>[] = []
    const base = { ...plotBase(p) }
    const scale = paletteScale(look.valuePalette ?? rolePalettes.value)
    // The points: the plot's own palette when it picked one (so they match its surface), else the
    // objects' role — whose middle stays visible as a dot.
    const pointScale = paletteScale(look.valuePalette ?? rolePalettes.points)
    // Default size: a fit's few level means stand out; a Compare's replicates are many, so smaller.
    // Each view its own size (a 3-D scene's points read differently from a 2-D plot's).
    const pointSize = (dim === '3d' ? look.pointSize3d : look.pointSize) ?? (dim === '3d' ? 3 : 7)
    // The points' colour: the set colour; or (automatic) in a line view their line's — the legend
    // group's — and on the surface each one's mean log₂, symmetric about 0 (±range at the ends).
    const pointColor = (ys: number[], range: number, lineCol?: string): Record<string, unknown> =>
      look.pointColor !== AUTO
        ? { color: look.pointColor }
        : lineCol
          ? { color: lineCol }
          : { color: ys, colorscale: pointScale, cmin: -range, cmax: range, showscale: false }
    const valueTitle = valueTitleSet
      ? valueTitleSet
      : measured
        ? measured.comparison
          ? `log₂FC · ${measured.comparison}`
          : 'log₂FC'
        : 'log₂ ratio to control'
    // The value's name in hovers and on the colour bar: the line's (a model's) and the points'.
    const valueName = measured ? 'log₂FC' : 'log₂'
    const pointLabel = measured
      ? cells.some((c) => c.reps?.length)
        ? 'replicate log₂FC'
        : 'log₂FC'
      : 'mean log₂'

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
    // The scene's gridlines a step stronger than the 2-D plots' (theme grid): a 3-D box reads by
    // them, and at the theme's strength they faded into its background.
    const grid3 = mode === 'dark' ? '#343434' : '#e4e4e4'
    // Every value drawn along the value axis (`key`: z in 3-D, y in 2-D) — lines, surface, points
    // and their error.
    const drawnExtent = (key: 'y' | 'z'): [number, number] | null => {
      let lo = Infinity
      let hi = -Infinity
      const take = (v: unknown): void => {
        if (typeof v !== 'number' || !Number.isFinite(v)) return
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      for (const t of traces) {
        const zs = (t[key] ?? []) as unknown[]
        const err = (t[key === 'z' ? 'error_z' : 'error_y'] as { array?: number[] } | undefined)
          ?.array
        zs.forEach((v, i) => {
          if (Array.isArray(v)) v.forEach(take)
          else if (err && typeof v === 'number') {
            take(v - (err[i] ?? 0))
            take(v + (err[i] ?? 0))
          } else take(v)
        })
      }
      return lo <= hi ? [lo, hi] : null
    }
    // A set range (the global scale: the genes' level means) widened to hold what this gene draws —
    // a model's surface runs past its means, and down to the control's 0 — so nothing drawn crosses
    // the box; else undefined.
    const heldRange = (key: 'y' | 'z'): [number, number] | undefined => {
      if (!valueRange) return undefined
      const d = drawnExtent(key)
      return d ? [Math.min(valueRange[0], d[0]), Math.max(valueRange[1], d[1])] : valueRange
    }
    // The value axis's extent: the set range (holding everything drawn), else every value drawn —
    // flat values given a unit's room. (Unpadded: finish3 adds the margin.)
    const zExtent = (): [number, number] => {
      const held = heldRange('z')
      if (held) return held
      const d = drawnExtent('z')
      if (!d) return [-1, 1]
      const [lo, hi] = d
      if (hi - lo < 1e-6) return [lo - 0.5, hi + 0.5]
      return [lo, hi]
    }
    // The reference in 3-D: each sample as an open marker at its levels — the vehicle's in the
    // muted ink, a baseline level's treated samples coloured by value as the points. With the points.
    const controlTraces = (legend: boolean): Record<string, unknown>[] =>
      !look.points
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
    // A 3-D view: the traces, the layout around them, and its axes — drawn in the scene (labels
    // lying in the box's planes — see strokeAxes3d) once the side it's seen from is known.
    const finish3 = (
      legend: boolean,
      legendTitle = timeLabel
    ): {
      data: Record<string, unknown>[]
      layout: Record<string, unknown>
      axes3: Parameters<typeof strokeAxes3d>
    } => {
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

    // ── the model every view draws (sm — engine/surfaceModel.ts; see the file comment) ──
    const { tx, itx, uOf, iu } = axes
    const perDose = sm.kind === 'byDose'
    const perTime = sm.kind === 'byTime'
    // No description (q beyond the describe cutoff, or none could be fitted): no line or surface —
    // NA, the level means only. (The spline surface is the detector's, drawn under that model.)
    const flat = sm.kind === 'none'
    const span = (lo: number, hi: number): number[] =>
      Array.from({ length: GRID + 1 }, (_, k) => lo + ((hi - lo) * k) / GRID)
    // The fine grid with the measured levels in it: every measured dose a column and every
    // measured time a row of the surface's mesh, so the curves drawn at them run along its edges
    // (between them they'd cut through the mesh's flat facets — half hidden, zig-zagging).
    // A fine value within rounding of a level gives way to the level itself (the grid's ends are
    // the extreme levels recomputed through logs — 59.99999999999996 for 60), so a curve drawn at a
    // level finds its row or column exactly.
    const withLevels = (fine: number[], levels: number[]): number[] => {
      const near = (a: number, b: number): boolean =>
        Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
      const kept = fine.filter((v) => !levels.some((l) => near(v, l)))
      return [...new Set([...kept, ...levels])].sort((a, b) => a - b)
    }
    // The views that show the reference (3-D, the heatmap) span it: the model runs down to the
    // controls' 0 (sm.gridDoses / gridTimes); the 2-D curves stop at the cells.
    const showsControl = !measured && (dim === '3d' || show === 'heatmap')
    const gridDoses = showsControl ? sm.gridDoses : doses
    const gridTimes = showsControl ? sm.gridTimes : times
    const fineDoses = withLevels(
      span(tx(gridDoses[0]), tx(gridDoses[gridDoses.length - 1])).map(itx),
      gridDoses
    )
    // Times spaced on the surface's own time axis, log(t + offset).
    const fineTimes = withLevels(
      span(uOf(gridTimes[0]), uOf(gridTimes[gridTimes.length - 1])).map(iu),
      gridTimes
    )
    const lx = (ds: number[]): number[] => ds.map(tx)
    const fineLx = lx(fineDoses)
    const fineU = fineTimes.map(uOf)
    const timesU = times.map(uOf)
    const what =
      sm.kind === 'joint'
        ? 'joint model'
        : perTime || perDose
          ? '4PL'
          : sm.kind === 'cells' && !measured
            ? 'spline'
            : 'no description'
    const lineLabel = measured ? 'log₂FC' : flat ? 'no description' : `${what} log₂`
    // The value at a measured cell (and a control's 0).
    const cellValue = sm.at
    const lxDoses = lx(doses)
    // The model along dose at a level of time, at log doses `at` (the fine ones by default) — and
    // along time at a level of dose, at times `at` on the time axis.
    const doseCurve = (t: number, at: number[] = fineLx): Array<number | null> =>
      sm.doseCurve(t, at)
    const timeCurve = (d: number, at: number[] = fineU): Array<number | null> => sm.timeCurve(d, at)

    if (show === 'line' && dim === '3d') {
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
      traces.push(...controlTraces(false))
      return finish3(true, byDose ? doseLabel : timeLabel)
    }

    if (show === 'line') {
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

    if (show === 'surface') {
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
              const ref = shiftAlongB
                ? refJ >= 0
                  ? z[i][refJ]
                  : null
                : refI >= 0
                  ? z[refI][j]
                  : null
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
      traces.push(...controlTraces(false))
      return {
        ...finish3(false),
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

    // heatmap: measured effect, dose across, time down (earliest at the top) — with the reference:
    // the vehicle's column (dose 0) and a baseline level's row (t₀), each cell its samples' mean vs
    // its level's vehicle (the vehicle's own scattering about 0: its replicates in the hover).
    // Levels a log axis had to place (0) keep that place here, labelled 0.
    const ctl = new Map(controls.map((c) => [`${placeX(c.dose)}|${placeY(c.time)}`, c]))
    const hd = [...new Set([...doses, ...controls.map((c) => placeX(c.dose))])].sort(
      (a, b) => a - b
    )
    const ht = [...new Set([...times, ...controls.map((c) => placeY(c.time))])].sort(
      (a, b) => a - b
    )
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
  }, [
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
  ])

  // A 3-D view's axes, drawn for the side it's seen from: their traces after the view's, and
  // Plotly's own axes hidden, the ranges padded for the drawn labels, the data box a cube.
  const { data, layout, hlLifted } = useMemo(() => {
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
  }, [plotData, plotLayout, axes3, side, hl, resume])

  // The 3-D surface's hover highlight, bound to each drawn chart (see bindSurfaceHover).
  // …and the drawn axes kept on the side the scene is actually seen from. The turn's end event
  // (onCamera) can miss — a draw from a kept or restored camera, a release outside the window —
  // so the camera on screen is read after every draw, and after every release and wheel over it.
  const onSurfaceMount = useCallback(
    (el: PlotlyGraphDiv): (() => void) | undefined => {
      const unbindHover = hlLifted ? bindSurfaceHover(el, hlLifted) : undefined
      let raf = 0
      const check = (): void => {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => {
          const full = (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout
          const sc = full?.scene as { _scene?: { getCamera?: () => unknown } } | undefined
          const camera = sc?._scene?.getCamera?.() as Record<string, unknown> | undefined
          // The camera as it is now — a wheel zoom sends Plotly no camera event of its own — so a
          // redraw (and a remount) goes on from it, not from the last turn's end.
          if (camera) cameraRef.current = camera
          syncSide(camera)
        })
      }
      check()
      window.addEventListener('mouseup', check)
      el.addEventListener('wheel', check, { passive: true })
      return () => {
        cancelAnimationFrame(raf)
        window.removeEventListener('mouseup', check)
        el.removeEventListener('wheel', check)
        unbindHover?.()
      }
    },
    [hlLifted, syncSide]
  )

  // One box in every case, so the visibility check above always has it to watch.
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
