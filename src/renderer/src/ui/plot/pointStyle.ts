/** Resolution of a point plot's `PointStyle` config against each plot's built-in defaults —
 *  shared by the views (which draw with the resolved values) and the config panel (which shows
 *  the defaults as the starting values). The config only ever stores what the user changed. */
import type {
  EffectColors,
  GroupStyle,
  HighlightStyle,
  PointStyle
} from '../../graph/config/plotStyle'
import { AUTO, CLEAR } from '../color/ColorPicker'
import { CATEGORICAL, EFFECT_COLOR } from '../app/theme'

/** A group's fully-resolved look, plus its key and display name for the panel. Its `highlight`
 *  is the plot-wide one with this group's own overrides on top. */
export interface ResolvedGroup
  extends
    Required<Omit<GroupStyle, 'highlight' | 'outlineColor' | 'labelColor' | 'labelSize'>>,
    Pick<GroupStyle, 'outlineColor' | 'labelSize'> {
  key: string
  name: string
  highlight: ResolvedHighlight
  /** its labels' colour — set by resolveGroup: the chosen one, else the marker colour */
  labelColor?: string
}

/** A group's label colour as drawn: its own, else its marker colour (a hollow marker's — no
 *  colour — falls back to the theme text, `ink`). */
export const labelColorOf = (g: ResolvedGroup, ink: string): string =>
  g.labelColor ?? (g.color && g.color !== CLEAR ? g.color : ink)

/** The highlight look with every field resolved. `ringColor` stays optional (unset = the theme's
 *  text colour) and so does `size` (unset = the point's own size + `bump`). */
export type ResolvedHighlight = Required<
  Omit<HighlightStyle, 'ringColor' | 'size' | 'labelColor'>
> &
  Pick<HighlightStyle, 'ringColor' | 'size' | 'labelColor'>

/** Shared highlight defaults — historically PlotlyChart's EMPH_BUMP / EMPH_RING / DIM_OPACITY and
 *  the overlay's 10px bold name. `dim` is softened so a gene's existing highlight stays visible
 *  alongside the hovered/pinned one rather than the plot fading almost to nothing. */
export const DEFAULT_HIGHLIGHT: ResolvedHighlight = {
  bump: 5,
  ring: 1,
  dim: 0.28,
  label: true,
  labelSize: 10
}

/** The point plots' highlight defaults: the shared ones, but a thinner selected outline (0.5, as
 *  a significant dot's), the rest faded to 20%, and the emphasised gene's name in its point's colour
 *  (labelColor AUTO). Any other chart's overlay keeps the shared look and names it in the theme
 *  text (no labelColor). */
const POINT_HIGHLIGHT: ResolvedHighlight = {
  ...DEFAULT_HIGHLIGHT,
  ring: 0.5,
  dim: 0.2,
  labelColor: AUTO
}

/** A point plot's default selected dot, px: 9 — above the plain dots' 7 / 8; a group drawn at 9 or
 *  more is selected 1 px larger than its own dot. */
export const SELECTED_SIZE = 9

/** A point's default outline width, px — every group of every point plot except 'none'. */
export const DEFAULT_OUTLINE = 0.5

/** The point plots' default dots, px: not significant ('none') 7, significant 8. */
const DOT = { none: 7, sig: 8 }

/** The non-significant ('none') group's default opacity; it's drawn without an outline. */
const NONE_OPACITY = 0.5

/** A significant group's default opacity. */
const SIG_OPACITY = 0.8

// Marginal (independent) contrasts label each significant gene by which quadrant it falls in —
// the composite "<FC1 dir>, <FC2 dir>" effect, where an em-dash means that axis wasn't itself
// significant. This is the order the quadrant legend groups are listed in.
export const QUAD_ORDER = [
  'up, up',
  'down, down',
  'up, down',
  'down, up',
  'up, —',
  'down, —',
  '—, up',
  '—, down'
]

// Quadrant palette as an 8-hue wheel: the four CORNERS are a tetrad, rotated so the main diagonal
// runs RED (up, up — top-right) ↔ BLUE (down, down — bottom-left) with magenta (up, down — top-left)
// ↔ green (down, up — bottom-right) on the other diagonal. Each single-axis EDGE sits between two
// corners on the plane and takes the TETRADIC INTERMEDIATE hue of those two corners:
//   up, — (top)    = red↔magenta   → rose      —, up (right) = red↔green    → yellow
//   down, — (bot)  = blue↔green    → teal      —, down (left)= magenta↔blue → violet
// Edges are a touch lighter so the both-axes corners still read as the strongest. Fixed hexes.
export const QUAD_COLORS: Record<string, string> = {
  'up, up': '#d1495b', // red      (top-right)
  'down, down': '#3b7fb5', // blue     (bottom-left)
  'up, down': '#b45fae', // magenta  (top-left)
  'down, up': '#4fa05a', // green    (bottom-right)
  'up, —': '#d2798f', // rose   (between red & magenta, pushed toward red to clear magenta)
  '—, up': '#caca73', // yellow (between red & green)
  'down, —': '#73cab7', // teal   (between blue & green)
  '—, down': '#7f70cd' // violet (between magenta & blue, pushed toward blue to clear magenta)
}

/** Which point plot (and, for scatter, which grouping) a default set is for. */
export type PointPlotKind = 'volcano' | 'ma' | 'scatter' | 'scatterQuad' | 'potency' | 'curveMad'

const effectGroups = (
  size: { none: number; sig: number },
  opacity: number,
  names: { up: string; down: string; none?: string } = { up: 'up', down: 'down' },
  colors: EffectColors = EFFECT_COLOR
): ResolvedGroup[] => [
  {
    key: 'none',
    name: names.none ?? 'none',
    size: size.none,
    opacity: NONE_OPACITY,
    color: colors.none,
    label: false,
    legend: false,
    outline: 0,
    highlight: DEFAULT_HIGHLIGHT
  },
  {
    key: 'down',
    name: names.down,
    size: size.sig,
    opacity,
    color: colors.down,
    label: true,
    legend: true,
    outline: DEFAULT_OUTLINE,
    highlight: DEFAULT_HIGHLIGHT
  },
  {
    key: 'up',
    name: names.up,
    size: size.sig,
    opacity,
    color: colors.up,
    label: true,
    legend: true,
    outline: DEFAULT_OUTLINE,
    highlight: DEFAULT_HIGHLIGHT
  }
]

/** Each plot's built-in group looks, in legend order. `names` renames the up/down classes (the
 *  Compare's effect labels) for display, and `colors` colours them (the Compare's effect colours
 *  — what a group's automatic colour follows); keys never change. */
/** The residual plots' control samples: a neutral grey, not an effect colour. */
const RESIDUAL_CONTROL = '#8a8f98'

export function defaultGroups(
  kind: PointPlotKind,
  names?: { up: string; down: string; none?: string },
  colors?: EffectColors
): ResolvedGroup[] {
  switch (kind) {
    case 'volcano':
      return effectGroups(DOT, SIG_OPACITY, names, colors)
    case 'ma':
      return effectGroups(DOT, SIG_OPACITY, names, colors)
    case 'potency':
      return effectGroups(DOT, SIG_OPACITY, names, colors)
    case 'curveMad':
      // The fit-residual QC's residuals: the control samples' and the dosed ones' (small and faint —
      // there's one per gene per sample).
      return [
        {
          key: 'control',
          name: 'control',
          size: 4,
          opacity: 0.35,
          // not an effect group: a fixed neutral grey, whatever the fold-change palette
          color: RESIDUAL_CONTROL,
          label: false,
          legend: true,
          outline: DEFAULT_OUTLINE,
          highlight: DEFAULT_HIGHLIGHT
        },
        {
          key: 'dose',
          name: 'dosed',
          size: 4,
          opacity: 0.35,
          color: CATEGORICAL[0],
          label: false,
          legend: true,
          outline: DEFAULT_OUTLINE,
          highlight: DEFAULT_HIGHLIGHT
        }
      ]
    case 'scatter':
      return effectGroups(DOT, SIG_OPACITY, names, colors)
    case 'scatterQuad':
      return [
        {
          key: 'none',
          name: 'none',
          size: DOT.none,
          opacity: NONE_OPACITY,
          color: colors?.none ?? EFFECT_COLOR.none,
          label: false,
          legend: false,
          outline: 0,
          highlight: DEFAULT_HIGHLIGHT
        },
        ...QUAD_ORDER.map((k) => ({
          key: k,
          name: k,
          size: DOT.sig,
          opacity: SIG_OPACITY,
          color: QUAD_COLORS[k],
          label: true,
          legend: true,
          outline: DEFAULT_OUTLINE,
          highlight: DEFAULT_HIGHLIGHT
        }))
      ]
  }
}

/** A group's look with the config's overrides applied over its default. */
export function resolveGroup(style: PointStyle | undefined, def: ResolvedGroup): ResolvedGroup {
  const o = style?.groups?.[def.key]
  const size = o?.size ?? def.size
  // Selected: the size set, else SELECTED_SIZE — or 1 px over a dot already that large.
  const hl = resolveHighlight(style, o?.highlight)
  const highlight = hl.size != null ? hl : { ...hl, size: Math.max(SELECTED_SIZE, size + 1) }
  if (!o) return { ...def, highlight }
  const color = o.color && o.color !== AUTO ? o.color : def.color
  return {
    ...def,
    name: o.name?.trim() || def.name,
    size,
    opacity: o.opacity ?? def.opacity,
    // Automatic (unset, or AUTO) follows the default — for an effect group, the upstream's colour.
    color,
    outline: o.outline ?? def.outline,
    outlineColor: o.outlineColor ?? def.outlineColor,
    label: o.label ?? def.label,
    // Automatic (unset, or AUTO) follows the marker colour (labelColorOf).
    labelColor: o.labelColor && o.labelColor !== AUTO ? o.labelColor : undefined,
    labelSize: o.labelSize,
    legend: o.legend ?? def.legend,
    highlight
  }
}

/** Every group of a plot, resolved, keyed for lookup by a point's effect. */
export function resolveGroups(
  style: PointStyle | undefined,
  kind: PointPlotKind,
  names?: { up: string; down: string; none?: string },
  colors?: EffectColors
): Map<string, ResolvedGroup> {
  return new Map(defaultGroups(kind, names, colors).map((d) => [d.key, resolveGroup(style, d)]))
}

/** The highlight look: the shared defaults, then the plot-wide overrides, then (optionally) one
 *  group's own. */
export function resolveHighlight(
  style: PointStyle | undefined,
  group?: HighlightStyle
): ResolvedHighlight {
  const h = style?.highlight
  if (!h && !group) return POINT_HIGHLIGHT
  const pick = <K extends keyof ResolvedHighlight>(k: K): ResolvedHighlight[K] =>
    (group?.[k] as ResolvedHighlight[K]) ?? (h?.[k] as ResolvedHighlight[K]) ?? POINT_HIGHLIGHT[k]
  return {
    size: group?.size ?? h?.size,
    bump: pick('bump'),
    ring: pick('ring'),
    ringColor: group?.ringColor ?? h?.ringColor,
    dim: pick('dim'),
    label: pick('label'),
    labelSize: pick('labelSize'),
    labelColor: group?.labelColor ?? h?.labelColor ?? AUTO
  }
}

/** Whether the legend is shown (on unless switched off). */
export const legendOn = (style: PointStyle | undefined): boolean => style?.legend !== false
