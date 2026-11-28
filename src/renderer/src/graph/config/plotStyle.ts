/**
 * What many plots' settings share: effect colours and the fold-change palette, the top-N cap, axis
 * and legend overrides, the point groups' looks, and the quick-access switches.
 */
import type { TopSplit, TopSplitSpec } from '../../engine'
import {
  paletteEffectColors,
  type PaletteRef,
  ROLE_DEFAULTS,
  toPaletteRef
} from '../../ui/color/palettes'

/** The effect groups' colours, from the Compare: up, down, and none (not significant). */
export interface EffectColors {
  up: string
  down: string
  none: string
}
/** A plot's own effect colours over its upstream's (unset or 'auto' = follow the upstream). */
export type PlotEffectColors = Partial<Record<'up' | 'down' | 'none', string>>
/** A plot that draws fold changes may follow its own palette instead of the global one. */
export interface FcPaletteConfig {
  /** this plot's fold-change palette (unset = the global one, app settings → fcPalette) */
  fcPalette?: PaletteRef
}
/** The palette a plot draws fold changes on: its own, else the global one. */
export const fcPaletteOf = (plot: FcPaletteConfig | undefined, global: PaletteRef): PaletteRef =>
  toPaletteRef(plot?.fcPalette) ?? global
/**
 * The colours a plot draws its effect groups in, most specific first: the plot's own colour for
 * the group; else sampled from its FC palette — the plot's own, or the global one (Settings →
 * Customisation) — down its low end, none its middle, up its high end. (The Compare names the
 * classes; it doesn't colour them: a plot's colours are the plot's.)
 */
export function plotEffectColors(
  own: PlotEffectColors | undefined,
  global: PaletteRef = ROLE_DEFAULTS.fcObject,
  plotPalette?: PaletteRef
): EffectColors {
  const sampled = paletteEffectColors(toPaletteRef(plotPalette) ?? global)
  const pick = (k: 'up' | 'down' | 'none'): string => {
    const c = own?.[k]
    return c && c !== 'auto' ? c : sampled[k]
  }
  return { up: pick('up'), down: pick('down'), none: pick('none') }
}

/** Whether an optional top-N cap applies — the explicit switch, or (older configs without one)
 *  a non-zero N. Shared by every plot with a "Cap genes"/"Cap labels" switch. */
export const capOn = (enabled: boolean | undefined, n: number | undefined): boolean =>
  enabled ?? (n ?? 0) > 0

/** How a capped plot's top-N splits between up and down genes (engine/stats/stats/topPick): by size alone,
 *  in proportion to each side (default), or a declared count per side. */
export interface TopSplitConfig {
  topSplit?: TopSplit
  /** fixed: how many up / down */
  topUp?: number
  topDown?: number
}
export const TOP_SIDE_DEFAULT = 10
export const topSplitOf = (c: TopSplitConfig): TopSplitSpec =>
  c.topSplit === 'fixed'
    ? { by: 'fixed', up: c.topUp ?? TOP_SIDE_DEFAULT, down: c.topDown ?? TOP_SIDE_DEFAULT }
    : { by: c.topSplit ?? 'proportional' }
/** The top-N's total: the N set, or — fixed per side — the two counts together. */
export const topCountOf = (c: TopSplitConfig, n: number): number =>
  c.topSplit === 'fixed' ? (c.topUp ?? TOP_SIDE_DEFAULT) + (c.topDown ?? TOP_SIDE_DEFAULT) : n

/** How a line is stroked, for the axis decorations that offer a choice. */
export type LineStyle = 'solid' | 'dash' | 'dot'

/** Per-axis overrides for a Plotly plot's x or y axis. Every field is optional — unset keeps the
 *  view's own layout (title text, auto range, theme grid/line colours). */
export interface AxisStyle {
  /** axis title text; blank/unset = the view's own */
  title?: string
  /** title font size (px) */
  titleSize?: number
  /** show the tick labels (default on) */
  tickLabels?: boolean
  /** tick label font size (px) */
  tickSize?: number
  /** fixed range bounds; a missing side falls back to the view's range (or the data extent) */
  min?: number
  max?: number
  /** tick mark placement */
  ticks?: 'outside' | 'inside' | 'none'
  /** spacing between ticks, in the axis's own units (unset = Plotly's automatic spacing). On a
   *  categorical axis (response steps, gene rows) it counts categories: 2 = label every other. */
  interval?: number
  /** show gridlines */
  grid?: boolean
  /** gridline style (default solid) */
  gridStyle?: LineStyle
  /** gridline thickness (px) */
  gridWidth?: number
  /** axis line thickness (px); 0 hides the line */
  lineWidth?: number
  /** the axis line's style (default solid). Plotly draws the axis line solid-only, so anything
   *  else is drawn as a shape instead — see ui/plot/plotAxes. */
  lineStyle?: LineStyle
  /** mirror the axis line (and ticks) on the opposite side — a framed plot */
  mirror?: boolean
  /** the mirrored line's style (default solid). Plotly mirrors the axis line as-is, so anything
   *  else is drawn as a shape instead — see ui/plot/plotAxes. */
  frameStyle?: LineStyle
  /** the mirrored line's thickness (px); unset = the axis line's own */
  frameWidth?: number
  /** draw the zero line */
  zeroline?: boolean
  /** its line style (default solid). Plotly's own zero line is solid-only, so anything else is
   *  drawn as a shape instead — see ui/plot/plotAxes. */
  zerolineStyle?: LineStyle
  /** zero-line thickness (px) */
  zerolineWidth?: number
}
/** A plot's axis overrides, per axis. */
export interface PlotAxes {
  x?: AxisStyle
  y?: AxisStyle
}

/** A plot's legend switch, plot-wide (General's "show legend"): false hides the legend and the colour
 *  scale bars; unset = shown. (A point plot saved before the plot-wide switch may still carry its
 *  old switch in `style.legend` — see legendShown.) */
export interface LegendConfig {
  legend?: boolean
}

/** One point group's marker look on a point plot (volcano / MA / scatter). Every field is
 *  optional: unset falls back to the plot's built-in default for that group (ui/plot/pointStyle.ts). */
export interface GroupStyle {
  /** legend name for this group on this plot; unset/blank = the upstream tile's class name */
  name?: string
  /** marker diameter (px) */
  size?: number
  /** resting marker opacity (0–1) */
  opacity?: number
  /** marker colour (CSS) */
  color?: string
  /** outline thickness around the marker (px); 0 (the default) = no outline */
  outline?: number
  /** outline colour; unset = the theme's text colour */
  outlineColor?: string
  /** whether this group's genes are offered to the collision-managed label layer */
  label?: boolean
  /** its labels' text colour; unset (or automatic) = the group's own marker colour */
  labelColor?: string
  /** its labels' font size (px); unset = the plots' label size (PLOT_TEXT.label) */
  labelSize?: number
  /** whether this group has a legend entry (default on; moot while the legend is hidden) */
  legend?: boolean
  /** how THIS group's points look when selected/hovered, and how they fade when others are.
   *  Unset fields fall back to the plot-wide `PointStyle.highlight`, then to the defaults. */
  highlight?: HighlightStyle
}

/** Look of the emphasised (selected / hovered) points, and of the rest of the cloud while a
 *  selection is active. Used plot-wide (`PointStyle.highlight`) and per group
 *  (`GroupStyle.highlight`, which wins). Unset fields fall back (ui/plot/pointStyle.ts). */
export interface HighlightStyle {
  /** the emphasised marker's diameter (px). Unset = the point's own size plus `bump`, so a plot
   *  whose group sizes change keeps its emphasis proportional until this is set explicitly. */
  size?: number
  /** px added to the marker's own diameter when `size` is unset */
  bump?: number
  /** the emphasised marker's outline width (px); 0 = none. Shown as "outline" in the panel. */
  ring?: number
  /** that outline's colour; unset = the theme's text colour */
  ringColor?: string
  /** opacity of every non-selected point while something is selected (0–1) */
  dim?: number
  /** name the emphasised point in bold at its marker */
  label?: boolean
  /** font size (px) of that name */
  labelSize?: number
  /** that name's colour; unset (or automatic) = the point's own colour */
  labelColor?: string
}

/** Per-tile styling for the point plots: a look per point group, the highlight look, and the
 *  legend switch. Group keys are the effect classes ('up' | 'down' | 'none') or, for an
 *  independent-contrast scatter, the quadrant keys ('up, up', 'down, —', …). */
export interface PointStyle {
  groups?: Record<string, GroupStyle>
  highlight?: HighlightStyle
  /** show the legend (default on) */
  legend?: boolean
  /** the threshold / reference guide lines — Axes and lines › Threshold lines, as the other lines
   *  there: shown (unset = on), style (unset = dashed), width px (unset = GUIDE_WIDTH, 0.5) */
  guideShow?: boolean
  guideStyle?: LineStyle
  guideWidth?: number
}

/** Response curves (compare) over dose or time: every gene drawn, the top-N coloured. */
/** Per-field switch for a plot's quick-access switch bars in its tile: `quick[field] === false`
 *  hides that field's bar (the gear still has it). Unset fields are surfaced. */
export type QuickAccess = Record<string, boolean>
