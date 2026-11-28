/**
 * The response-curve plots' settings: DR (dose/time-response), Curve metrics and Potency, and the
 * DR's resolved look.
 */
import type { ConditionKey } from '../../engine'
import type {
  FcPaletteConfig,
  PlotAxes,
  PointStyle,
  QuickAccess,
  TopSplitConfig
} from './plotStyle'
import type { PlotOrient } from '../types'

export interface DRConfig extends FcPaletteConfig, TopSplitConfig {
  /** the numeric condition along x — the tile's own (one Response plot per numeric condition) */
  axis: ConditionKey
  /** a response surface method curve fit: draw its description 4PL ('curve', default) or the
   *  spline its detection fitted ('spline') */
  model?: 'spline' | 'curve'
  /** the categorical palette its lines take a colour each from — a gene each (global, detailed),
   *  a comparison each (focused, several), a side each (from a Contrast); unset = the global one */
  categorical?: import('../../ui/color/palettes').CategoricalId
  /** cap genes: explicit switch (undefined on older configs → inferred from topGenes > 0) */
  capEnabled?: boolean
  /** cap genes: colour only the top-N most-differential genes (applied only while `capEnabled`;
   *  otherwise all are coloured, up to the renderer's safety cap) */
  topGenes: number
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
  /** one gene at a time (a Contrast-fed DR, or a Compare-fed one focused): the value axis scaled
   *  to the whole result, so genes compare, or to each gene's own values. Default: global from a
   *  Contrast, per gene from a Compare (as the gene bar) — see drYScale. */
  yScale?: 'global' | 'gene'
  /** a Compare-fed DR: every gene at once ('overview', shown as "global"; default), or one gene
   *  at a time with its points (and, for a curve fit, the fitted curve and EC50) — 'focus'. The
   *  focused pager steps through every gene, or only the selected ones while any are selected.
   *  'detail' ("detailed"): the top-N genes by response (at most DR_DETAIL_CAP; picked from the
   *  selected genes while any are selected) without the every-gene background, each drawn in full
   *  as focused. */
  view?: 'overview' | 'detail' | 'focus'
  /** the response lines: width (px; default 2), colour ('auto', the default = one colour per
   *  comparison when focused — the gene's effect group (up / down / none) when it's the only one —
   *  per gene in the global view, per side from a Contrast), opacity (0–1;
   *  default 1). In the global view these style the coloured curves; the faint every-gene
   *  background keeps its own look. */
  lineWidth?: number
  lineColor?: string
  lineOpacity?: number
  /** focused view: the points behind each line (a t-test's replicates, a curve fit's measured
   *  points; from a Contrast, each side's level means on its line) — shown (default), size (px;
   *  default 7), colour ('auto' = the line's), opacity (0–1; default 0.5) */
  points?: boolean
  pointSize?: number
  pointColor?: string
  pointOpacity?: number
  /** focused view: the error — a t-test's (or a Contrast's) fold-change SE, a curve fit's 95%
   *  confidence band — shown (default; hidden by default from a Curve fit), as a shaded band
   *  (default) or whiskers, colour ('auto' = the line's), opacity (0–1; default 0.2 for a band, 1
   *  for whiskers) */
  errors?: boolean
  errorStyle?: 'whisker' | 'band'
  errorColor?: string
  errorOpacity?: number
  /** focused / detailed view, from a Curve fit: a dotted line at each curve's EC50 (the 4PL's
   *  midpoint) — off by default */
  ec50Line?: boolean
}
/** The most genes the DR's detailed view draws in full (each with its points and error). */
export const DR_DETAIL_CAP = 5

/** A DR's line / point / error look with every default filled in ('auto' colours stay 'auto' —
 *  the view resolves them per series). */
export interface DRLook {
  lineWidth: number
  lineColor: string
  lineOpacity: number
  points: boolean
  pointSize: number
  pointColor: string
  pointOpacity: number
  errors: boolean
  errorStyle: 'whisker' | 'band'
  errorColor: string
  errorOpacity: number
  ec50Line: boolean
}
// One resolved look per config object (the store replaces the object on any edit), so a view's
// memo keyed on the look only rebuilds when a setting actually changed — one cache per upstream
// kind, as a Curve fit's defaults differ.
const drLookCache = new WeakMap<object, DRLook>()
const drLookCurveCache = new WeakMap<object, DRLook>()
/** A DR's look; `curveFit` — fed by a Curve fit, whose error (its confidence band) is hidden by
 *  default. */
export function drLook(c: Partial<DRConfig>, curveFit = false): DRLook {
  const cache = curveFit ? drLookCurveCache : drLookCache
  let look = cache.get(c)
  if (!look) cache.set(c, (look = resolveDRLook(c, curveFit)))
  return look
}
/** A one-gene DR's value-axis scale: the setting, else global from a Contrast, per gene from a
 *  Compare. */
export const drYScale = (c: Partial<DRConfig>, fromContrast: boolean): 'global' | 'gene' =>
  c.yScale ?? (fromContrast ? 'global' : 'gene')
function resolveDRLook(c: Partial<DRConfig>, curveFit: boolean): DRLook {
  // A shaded band by default, from a Compare or a Contrast alike.
  const errorStyle = c.errorStyle ?? 'band'
  return {
    lineWidth: c.lineWidth ?? 2,
    lineColor: c.lineColor ?? 'auto',
    lineOpacity: c.lineOpacity ?? 1,
    points: c.points ?? true,
    pointSize: c.pointSize ?? 7,
    pointColor: c.pointColor ?? 'auto',
    pointOpacity: c.pointOpacity ?? 0.5,
    errors: c.errors ?? !curveFit,
    errorStyle,
    errorColor: c.errorColor ?? 'auto',
    errorOpacity: c.errorOpacity ?? (errorStyle === 'band' ? 0.2 : 1),
    ec50Line: c.ec50Line ?? false
  }
}
/** Curve metrics plot (a Curve fit's): one gene's fitted parameter as a bar chart — a surface's per
 *  slice level (graph/results/metricBars.ts). Genes from the gene picker, the metric from a switch. */
export interface MetricsConfig {
  /** force pEC50: a flat curve (its F-test doesn't reject the flat line) at pEC50 0 — EC50 1 M,
   *  the least potent — instead of none (unset): it has no midpoint to place */
  forcePEC50?: boolean
  /** the metric drawn (unset: the potency — graph/results/metricBars.ts METRIC_IDS) */
  metric?: 'potency' | 'slope' | 'front' | 'back'
  /** a 2-D fit's per-slice values as they are (unset / 'value') or as their difference from the
   *  reference slice's ('delta': the lowest level — dose 0, the vehicle's curve) */
  show?: 'value' | 'delta'
  /** which settings the tile surfaces as quick-access switch bars (unset = all) */
  quick?: QuickAccess
}
/** Potency plot (curve-fit Compare, as CurveCurator draws it): each curve's potency (pEC50)
 *  against its curve fold change. */
export interface PotencyConfig extends FcPaletteConfig {
  /** force pEC50: a flat curve (its F-test doesn't reject the flat line) at pEC50 0 — EC50 1 M,
   *  the least potent — instead of none (unset): it has no midpoint to place */
  forcePEC50?: boolean
  /** every curve (default), or the called curves only — a flat curve's pEC50 means little */
  show?: 'called' | 'all'
  /** which settings the tile surfaces as quick-access switch bars (unset = all) */
  quick?: QuickAccess
  /** cap labels: explicit switch (undefined → inferred from labelTop > 0) */
  capEnabled?: boolean
  /** cap labels: label only the top-N curves by |fold change| (applied only while `capEnabled`) */
  labelTop: number
  /** marker/legend/highlight look; unset fields fall back to the plot's defaults */
  style?: PointStyle
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
  /** tile orientation (persisted); undefined = portrait default — the potency up the side, the
   *  fold change across (landscape: CurveCurator's layout, the potency across) */
  orient?: PlotOrient
}
