/**
 * The Response plot's settings (a Curve fit's dose × time surfaces) and the two-condition Response
 * (TDR): its views, slices and resolved look.
 */
import { type CompareResultRow, type ConditionKey, curvesReplicated, nestedCol } from '../../engine'
import { holderTable, rowCount } from '../../engine/columns/lazyRows'
import { type PaletteRef, toPaletteRef } from '../../ui/color/palettes'
import type { FcPaletteConfig, PlotAxes, QuickAccess } from './plotStyle'

/** Response plot: a Curve fit's dose × time surfaces (the response surface method), one gene at a
 *  time, in 2-D or 3-D. 2-D: dose curves with a line per time ('line') or a dose × time heatmap
 *  ('heatmap'). 3-D: the fitted surface ('surface'), or its dose curves as lines along each time
 *  point ('line') — the surface without the surface. */
export interface ResponseConfig extends FcPaletteConfig {
  /** a Curve fit's surface plot: the pair it is for (its fit's — absent: dose × time) */
  pair?: [ConditionKey, ConditionKey]
  /** the value axis fitted to each gene's own values ('gene', default — shown as "adjusted") or
   *  to every gene's in the facet, so paging genes keeps one scale */
  yScale?: 'gene' | 'global'
  /** unset: 3-D for a 'surface' show (configs from before the switch), else 2-D */
  dim?: '2d' | '3d'
  /** what's drawn; one the dimension can't draw (a heatmap in 3-D, a surface in 2-D) falls back
   *  to the dimension's default (see responseShow) */
  show?: 'line' | 'surface' | 'heatmap'
  /** The surface viewed by slices at each time (dose curves; the default) or at each dose (time
   *  curves): the lines a 3-D line view draws, and — with a slices description, whose dose and time
   *  curves are separate fits — the curves its surface and heatmap are built from. Unset on a result
   *  described by the older 'doseSlices': by dose (see responseSlice). */
  slice?: 'time' | 'dose'
  /** 3-D: the camera's projection — orthographic (default; parallel lines stay parallel, so
   *  levels line up across the box) or perspective (the far side drawn smaller) */
  projection?: 'perspective' | 'orthographic'
  /** the lines: width (px; default 2), colour ('auto' = one per slice, low → high, along
   *  `linePalette` — unset: the dose / time levels' palette role, as the lines are per dose / per
   *  time), opacity. Earlier versions stored the palette's name, with `linePaletteReverse` beside
   *  it; both are still read. */
  linePalette?: PaletteRef | string
  linePaletteReverse?: boolean
  lineWidth?: number
  lineColor?: string
  lineOpacity?: number
  /** the level means: shown (default), size in the 2-D and 3-D views each (px; default 7 in
   *  2-D, 3 in 3-D), colour ('auto' = each one's log₂ on the value palette, as the surface),
   *  opacity (default 0.5) */
  points?: boolean
  pointSize?: number
  pointSize3d?: number
  pointColor?: string
  pointOpacity?: number
  /** the 3-D surface's opacity (default 0.85) */
  surfaceOpacity?: number
  /** the surface's curves, traced on it in both directions (a dose curve at each time, a time
   *  curve at each dose): shown (default), width (px; default 1), colour ('auto' = the text
   *  colour), opacity (default 0.6) */
  curves?: boolean
  curveWidth?: number
  curveColor?: string
  curveOpacity?: number
  /** earlier versions' value scale (a Plotly name, or 'effect'); now `fcPalette`, still read */
  colorScale?: string
  /** which settings the tile surfaces as quick-access switch bars (unset = all) */
  quick?: QuickAccess
}
export const responseDim = (c: Partial<ResponseConfig>): '2d' | '3d' =>
  c.dim ?? (c.show === 'surface' ? '3d' : '2d')
/** The view drawn: the pick, unless its dimension can't draw it (heatmap 3-D, surface 2-D). */
export function responseShow(c: Partial<ResponseConfig>): 'line' | 'surface' | 'heatmap' {
  const dim = responseDim(c)
  const show = c.show ?? 'line'
  if (dim === '3d' && show === 'heatmap') return 'surface'
  if (dim === '2d' && show === 'surface') return 'line'
  return show
}
/** Why a show can't be picked in a dimension (its tooltip), else undefined. */
/** A Response plot's slice direction: its setting, else by dose for a surface described by the
 *  older 'doseSlices' fit (drawn per dose, as it was), else by time. */
/** The slice switch as the plot names it — by the curves drawn: dose curves (a slice at each time)
 *  or time curves (a slice at each dose). Stored as the slice direction (`slice`). */
export const CURVE_OF_SLICE = { time: 'dose', dose: 'time' } as const
export const SLICE_OF_CURVE = { dose: 'time', time: 'dose' } as const

export function responseSlice(
  cfg: { slice?: 'time' | 'dose' },
  rows: ReadonlyArray<{ rs?: { surface?: { method?: string } } }> | undefined
): 'time' | 'dose' {
  return cfg.slice ?? (rows?.some((r) => r.rs?.surface?.method === 'doseSlices') ? 'dose' : 'time')
}

/** Whether a Response plot's view can be switched between time and dose slices: every line view
 *  (2-D or 3-D) can; a 3-D surface only from a slices description (separate dose and time curves
 *  — a joint model or measured values are the same whichever way they're sliced). Never the 2-D
 *  heatmap: it draws the measured cells, so there are no curves to switch. */
export function responseSliceable(
  dim: '2d' | '3d',
  show: string,
  rows: ReadonlyArray<{ rs?: { axis?: string; surface?: { method?: string } } }> | undefined
): boolean {
  if (show === 'line') return true
  if (show === 'heatmap') return false
  return !!rows?.some((r) => r.rs?.surface && r.rs.surface.method !== 'joint')
}

/** A result's rows' key for a cache: its table when columnar, else its rows array. */
const rowsKey = (holder: { rows: readonly object[] }): object => holderTable(holder) ?? holder.rows

const surfaceRows = new WeakMap<object, Array<{ rs: { surface: { method?: string } } }>>()
/** A Compare's response surfaces (`rs.surface`), one row each — of the rows that have one, the only
 *  rows responseSlice, responseSliceable and a joint-surface check can pass on — read off the nested
 *  column (no row built). Cached per table (or rows). */
export function responseSurfaceRows(cmp: {
  rows: readonly CompareResultRow[]
}): Array<{ rs: { surface: { method?: string } } }> {
  const key = rowsKey(cmp)
  let out = surfaceRows.get(key)
  if (!out) {
    const surface = nestedCol(cmp, 'rs', 'surface')
    out = []
    for (let r = 0; r < rowCount(cmp); r++) {
      const s = surface(r) as { method?: string } | null | undefined
      if (s) out.push({ rs: { surface: s } })
    }
    surfaceRows.set(key, out)
  }
  return out
}

const replicatedCurves = new WeakMap<object, boolean>()
/** curvesReplicated over a Compare's rows, read off the nested columns — only the curve fields it
 *  reads, of the rows with points (no row built). Cached per table (or rows). */
export function curvesReplicatedOf(cmp: { rows: readonly CompareResultRow[] }): boolean {
  const key = rowsKey(cmp)
  let out = replicatedCurves.get(key)
  if (out === undefined) {
    const [x, rep, cy, crep] = ['x', 'rep', 'cy', 'crep'].map((k) => nestedCol(cmp, 'curve', k))
    const kept: Parameters<typeof curvesReplicated>[0][number][] = []
    for (let r = 0; r < rowCount(cmp); r++)
      if (x(r))
        kept.push({
          curve: {
            x: x(r) as number[],
            rep: rep(r) as Array<number | null> | undefined,
            cy: cy(r) as number[] | undefined,
            crep: crep(r) as Array<number | null> | undefined
          }
        })
    out = curvesReplicated(kept)
    replicatedCurves.set(key, out)
  }
  return out
}

export const responseShowWhy = (dim: '2d' | '3d', show: string): string | undefined =>
  dim === '3d' && show === 'heatmap'
    ? 'A heatmap is 2-D — switch the view to 2D'
    : dim === '2d' && show === 'surface'
      ? 'A surface is 3-D — switch the view to 3D'
      : undefined

/** A Response plot's look with every default filled in ('auto' colours stay 'auto'). */
export interface ResponseLook {
  lineWidth: number
  lineColor: string
  lineOpacity: number
  /** the plot's own line palette (undefined = the dose / time levels' role) */
  linePalette: PaletteRef | undefined
  points: boolean
  /** 2-D and 3-D, each; unset → the plot's default (the view picks) */
  pointSize: number | undefined
  pointSize3d: number | undefined
  pointColor: string
  pointOpacity: number
  surfaceOpacity: number
  curves: boolean
  curveWidth: number
  curveColor: string
  curveOpacity: number
  /** the surface / heatmap's own palette (undefined = the global fold-change palette) */
  valuePalette: PaletteRef | undefined
  /** the measured values' error (the Time & Dose-response plot's; see TdrConfig) */
  errors: boolean
  errorStyle: 'whisker' | 'band'
  errorColor: string
  errorOpacity: number
}
// One resolved look per config object (as drLook), so the view's memo rebuilds only on an edit.
const responseLookCache = new WeakMap<object, ResponseLook>()
export function responseLook(c: Partial<TdrConfig>): ResponseLook {
  let look = responseLookCache.get(c)
  if (!look) responseLookCache.set(c, (look = resolveResponseLook(c)))
  return look
}
const resolveResponseLook = (c: Partial<TdrConfig>): ResponseLook => ({
  lineWidth: c.lineWidth ?? 2,
  lineColor: c.lineColor ?? 'auto',
  lineOpacity: c.lineOpacity ?? 1,
  linePalette: toPaletteRef(c.linePalette, c.linePaletteReverse),
  points: c.points ?? true,
  pointSize: c.pointSize,
  pointSize3d: c.pointSize3d,
  pointColor: c.pointColor ?? 'auto',
  pointOpacity: c.pointOpacity ?? 0.5,
  surfaceOpacity: c.surfaceOpacity ?? 0.85,
  curves: c.curves ?? true,
  curveWidth: c.curveWidth ?? 1,
  curveColor: c.curveColor ?? 'auto',
  curveOpacity: c.curveOpacity ?? 0.6,
  // an earlier 'effect' (or a Plotly scale with no counterpart) follows the global palette
  valuePalette: toPaletteRef(c.fcPalette) ?? toPaletteRef(c.colorScale),
  errors: c.errors ?? true,
  errorStyle: c.errorStyle ?? 'band',
  errorColor: c.errorColor ?? 'auto',
  errorOpacity: c.errorOpacity ?? ((c.errorStyle ?? 'band') === 'band' ? 0.2 : 1)
})

/** Two-condition Response plot (compare; dose × time, or any pair of numeric conditions — `pair`):
 *  one gene's measured log₂FC over the two, drawn as the Response plot draws a surface — 2-D lines
 *  per level of the second or a heatmap, 3-D lines (per level of either, `slice`) or a surface —
 *  with the same settings. */
export interface TdrConfig extends ResponseConfig {
  /** the line views' error — each level's fold change SE, as the Dose/time-response plot's
   *  focused view draws it: shown (default), as a shaded band (default) or
   *  whiskers, its colour ('auto' = the line's) and opacity (default 0.2 band, 1 whiskers) */
  errors?: boolean
  errorStyle?: 'whisker' | 'band'
  errorColor?: string
  errorOpacity?: number
  /** earlier versions' x / y axis overrides (a 2-D dose plot); no longer applied */
  axes?: PlotAxes
  /** the two numeric conditions it's over — the first along x, the second one line (slice) per
   *  level; the tile's own (one plot per pair). Unset (configs from before): dose × time. Its
   *  `slice` names them by slot: 'time' = a line per level of the second, 'dose' = of the first. */
  pair?: [ConditionKey, ConditionKey]
}

/** A Time & Dose-response (tdr) plot's two numeric conditions (see TdrConfig.pair). */
export const tdrPair = (c: Partial<TdrConfig> | null | undefined): [ConditionKey, ConditionKey] =>
  c?.pair ?? ['dose', 'time']
