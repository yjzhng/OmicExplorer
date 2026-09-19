/** Resolution of a point plot's `PointStyle` config against each plot's built-in defaults —
 *  shared by the views (which draw with the resolved values) and the config panel (which shows
 *  the defaults as the starting values). The config only ever stores what the user changed. */
import type { GroupStyle, HighlightStyle, PointStyle } from '../graph/types'
import { EFFECT_COLOR } from './theme'

/** A group's fully-resolved look, plus its key and display name for the panel. */
export interface ResolvedGroup extends Required<GroupStyle> {
  key: string
  name: string
}

/** The highlight look with every field resolved (ringColor stays optional: unset = theme text). */
export type ResolvedHighlight = Required<Omit<HighlightStyle, 'ringColor'>> &
  Pick<HighlightStyle, 'ringColor'>

/** Shared highlight defaults — historically PlotlyChart's EMPH_BUMP / EMPH_RING / DIM_OPACITY and
 *  the overlay's 10px bold name. `dim` is softened so a gene's existing highlight stays visible
 *  alongside the hovered/pinned one rather than the plot fading almost to nothing. */
export const DEFAULT_HIGHLIGHT: ResolvedHighlight = {
  bump: 5,
  ring: 2,
  dim: 0.28,
  label: true,
  labelSize: 10
}

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
export type PointPlotKind = 'volcano' | 'ma' | 'scatter' | 'scatterQuad'

const effectGroups = (
  size: { none: number; sig: number },
  opacity: number,
  names: { up: string; down: string } = { up: 'up', down: 'down' }
): ResolvedGroup[] => [
  {
    key: 'none',
    name: 'none',
    size: size.none,
    opacity,
    color: EFFECT_COLOR.none,
    label: false,
    legend: false
  },
  {
    key: 'down',
    name: names.down,
    size: size.sig,
    opacity,
    color: EFFECT_COLOR.down,
    label: true,
    legend: true
  },
  {
    key: 'up',
    name: names.up,
    size: size.sig,
    opacity,
    color: EFFECT_COLOR.up,
    label: true,
    legend: true
  }
]

/** Each plot's built-in group looks, in legend order. `names` renames the up/down classes (the
 *  Compare's effect labels) for display; keys never change. */
export function defaultGroups(
  kind: PointPlotKind,
  names?: { up: string; down: string }
): ResolvedGroup[] {
  switch (kind) {
    case 'volcano':
      return effectGroups({ none: 7, sig: 7 }, 0.85, names)
    case 'ma':
      return effectGroups({ none: 6, sig: 6 }, 0.8, names)
    case 'scatter':
      return effectGroups({ none: 6, sig: 8 }, 0.85, names)
    case 'scatterQuad':
      return [
        {
          key: 'none',
          name: 'none',
          size: 6,
          opacity: 0.85,
          color: EFFECT_COLOR.none,
          label: false,
          legend: false
        },
        ...QUAD_ORDER.map((k) => ({
          key: k,
          name: k,
          size: 8,
          opacity: 0.85,
          color: QUAD_COLORS[k],
          label: true,
          legend: true
        }))
      ]
  }
}

/** A group's look with the config's overrides applied over its default. */
export function resolveGroup(style: PointStyle | undefined, def: ResolvedGroup): ResolvedGroup {
  const o = style?.groups?.[def.key]
  if (!o) return def
  return {
    ...def,
    name: o.name?.trim() || def.name,
    size: o.size ?? def.size,
    opacity: o.opacity ?? def.opacity,
    color: o.color ?? def.color,
    label: o.label ?? def.label,
    legend: o.legend ?? def.legend
  }
}

/** Every group of a plot, resolved, keyed for lookup by a point's effect. */
export function resolveGroups(
  style: PointStyle | undefined,
  kind: PointPlotKind,
  names?: { up: string; down: string }
): Map<string, ResolvedGroup> {
  return new Map(defaultGroups(kind, names).map((d) => [d.key, resolveGroup(style, d)]))
}

/** The highlight look with the config's overrides applied over the shared defaults. */
export function resolveHighlight(style: PointStyle | undefined): ResolvedHighlight {
  const h = style?.highlight
  if (!h) return DEFAULT_HIGHLIGHT
  return {
    bump: h.bump ?? DEFAULT_HIGHLIGHT.bump,
    ring: h.ring ?? DEFAULT_HIGHLIGHT.ring,
    ringColor: h.ringColor,
    dim: h.dim ?? DEFAULT_HIGHLIGHT.dim,
    label: h.label ?? DEFAULT_HIGHLIGHT.label,
    labelSize: h.labelSize ?? DEFAULT_HIGHLIGHT.labelSize
  }
}

/** Whether the legend is shown (on unless switched off). */
export const legendOn = (style: PointStyle | undefined): boolean => style?.legend !== false
