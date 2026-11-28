/**
 * What every Response plot view (ResponseSurfaceView) is drawn from: the axes, the cells and the
 * model on them (engine/curves/surfaceModel.ts), the reference a shift is read from, and the
 * look's colours, labels and hovers — built once per plot, then drawn by one view's builder
 * (responsePlot.ts).
 */
import {
  condLabel,
  placed,
  shiftReference,
  surfaceAxes,
  surfaceModel,
  type CompareResultRow,
  type ModelView
} from '../../engine'
import type { ResponseLook } from '../../graph/config/response'
import { AUTO } from '../../ui/color/ColorPicker'
import { paletteScale, paletteSeries, type PaletteRef } from '../../ui/color/palettes'
import { tooltip } from '../../ui/plot/condTooltip'
import type { strokeAxes3d } from '../../ui/plot/strokeAxes3d'
import { PALETTES, plotBase, withAlpha } from '../../ui/app/theme'

import type { SurfaceHover } from './surfaceHover'

export type ResponseShow = 'line' | 'surface' | 'heatmap'

/** An axis of named levels (ResponseSurfaceView's `levels`): each level's position and name. */
export interface AxisLevels {
  at: number[]
  names: string[]
}

/** Evenly spaced points along each time's 4PL (2-D), and per axis of the 3-D grid (97 × 97
 *  vertices: visibly smooth, still light for WebGL). */
export const SAMPLES = 60
export const GRID = 96

/** A measured dose × time level: its log₂FC, the fold change's SE, and its replicates (each
 *  sample over the control's mean, log₂ — from the Clean data the Compare ran on). */
export interface MeasuredCell {
  dose: number
  time: number
  y: number
  se?: number
  reps?: number[]
}

/** What ResponseSurfaceView's plot is drawn from: its props (defaults applied), the palettes its
 *  lines per time / per dose follow, and the theme mode. */
export interface ResponsePlotInput {
  row?: CompareResultRow
  measured?: { cells: MeasuredCell[]; comparison?: string }
  dim: '2d' | '3d'
  show: ResponseShow
  look: ResponseLook
  rolePalettes: { value: PaletteRef; points: PaletteRef }
  timeRole: PaletteRef
  doseRole: PaletteRef
  slice: 'time' | 'dose'
  doseLabel: string
  timeLabel: string
  scales?: { x: 'log' | 'linear'; y: 'log' | 'linear' }
  valueRange?: [number, number]
  shiftRange?: number
  levels?: { x?: AxisLevels; y?: AxisLevels }
  /** the value axis's title as set (the view's `valueTitle`) */
  valueTitleSet?: string
  mode: keyof typeof PALETTES
  model: ModelView
}

/** A drawn Response plot: its traces and layout, and on the 3-D surface what a hover reads. */
export interface ResponsePlot {
  data: Record<string, unknown>[]
  layout: Record<string, unknown>
  hl?: SurfaceHover
  /** a 3-D view's axes, drawn in the scene from the side it's seen from (see sceneWithAxes) */
  axes3?: Parameters<typeof strokeAxes3d>
}

/** The plot's shared drawing context — null when there are no cells to draw. */
export function responseContext(input: ResponsePlotInput) {
  const {
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
    levels,
    valueTitleSet,
    mode,
    model
  } = input
  const p = PALETTES[mode]
  // Each axis log or linear: a fitted surface's always log; measured values' as set.
  // A fitted surface's own axes (rs.maps: any pair, log or linear; absent — dose × time — log on
  // both); measured values' as set.
  const fm = measured ? undefined : row?.rs?.maps
  const xLog = measured ? !levels?.x && (scales?.x ?? 'log') === 'log' : fm?.[0].scale !== 'linear'
  const yLog = measured ? !levels?.y && (scales?.y ?? 'log') === 'log' : fm?.[1].scale !== 'linear'
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
  // (engine/curves/surfaceModel.ts: the one reading of a surface every view and the descriptor's fold
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
  if (!cells.length) return null
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

  // ── the model every view draws (sm — engine/curves/surfaceModel.ts; see the file comment) ──
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
  const doseCurve = (t: number, at: number[] = fineLx): Array<number | null> => sm.doseCurve(t, at)
  const timeCurve = (d: number, at: number[] = fineU): Array<number | null> => sm.timeCurve(d, at)

  return {
    ...input,
    p,
    xLog,
    yLog,
    levelAt,
    named,
    xyText,
    xyConds,
    textOf,
    fm,
    axes,
    cells,
    allControls,
    sm,
    spread,
    errorInk,
    showErrors,
    doses,
    times,
    at,
    controls,
    xZero,
    yZero,
    placeX,
    placeY,
    shift,
    shiftAlongB,
    refDose,
    refTime,
    refAt,
    shiftName,
    sliceName,
    sliceColor,
    zAbs,
    traces,
    base,
    scale,
    pointScale,
    pointSize,
    pointColor,
    valueTitle,
    valueName,
    pointLabel,
    grid3,
    drawnExtent,
    heldRange,
    zExtent,
    tx,
    itx,
    uOf,
    iu,
    perDose,
    perTime,
    flat,
    gridDoses,
    gridTimes,
    fineDoses,
    fineTimes,
    fineLx,
    fineU,
    timesU,
    what,
    lineLabel,
    cellValue,
    lxDoses,
    doseCurve,
    timeCurve
  }
}

export type ResponseContext = NonNullable<ReturnType<typeof responseContext>>
