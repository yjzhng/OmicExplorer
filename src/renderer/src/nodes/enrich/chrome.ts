/** Everything an enrichment plot draws around its marks, built once for every style (dot, bar,
 *  ridge): the term groups (categories) and their colours, the clickable category legend and its
 *  spacing, the term labels with their group squares, the term axis, the left / top / bottom
 *  margins, the x axis title and the empty note. A style draws only its own marks — its bars,
 *  dots, ridges, and the dot style's size key — so the styles can't drift apart (architecture.test
 *  checks EnrichView builds none of this itself). */
import { moduleParts } from '../../engine'
import { fitText, flowChips, measureText } from '../../ui/plot/legendChips'
import { AXIS_LINE_WIDTH } from '../../ui/plot/plotAxes'
import { axisBase, type Palette, PLOT_TEXT, plotBase, plotFontCss } from '../../ui/app/theme'

/** Prefix of a clickable legend chip's annotation name (the rest is its group). */
export const CHIP = 'oe-cat:'

/** The category legend's geometry: the gap between chips; the plot's top margin holds `TOP` of air
 *  under the tile's switch bars, then the legend's lines, then `GAP` down to the plot area (clear of
 *  the top row's dots, which draw past it — up to half the largest dot, 12px). No modebar to clear:
 *  it's hidden on this plot. */
const CHIP_GAP = 14
/** The longest a chip's name runs, px, before it's cut with "…" (a gene module is named after a term,
 *  and a long one took a legend line to itself); the full name stays in the term's hover. */
const CHIP_MAX = 240
const LEGEND_TOP = 8
const LEGEND_GAP = 14
/** The air between the legend's categories and its modules. */
const SECTION_GAP = 8
/** One legend line's height, px. */
const legendRow = (): number => PLOT_TEXT.legend + 4
/** The figure's width less the room the legend leaves: the 20px it starts in from the left edge
 *  (labels.ts CONTAINER_PAD) and a little clear of the right. */
export const LEGEND_INSET = 28
/** Beyond the widest term label (with its square): the tick labels' gap from the axis and a little
 *  slack for font metrics. */
const LABEL_PAD = 14
/** The split between the term labels and the plot, over the figure less its right margin (the dot
 *  style's key isn't the labels' to give up): the plot keeps at least `MIN_PLOT_PX` and
 *  `MIN_PLOT_SHARE` of it; the labels get what they need of the rest — whole, once there's room —
 *  so they're cut only where the plot would otherwise be squeezed, and never take more than 70%.
 *  In a tile too narrow for both, the labels keep `MIN_LABEL_PX`. */
const MIN_PLOT_PX = 100
const MIN_PLOT_SHARE = 0.3
const MIN_LABEL_PX = 80
/** The right margin when nothing is drawn there (the dot style's key widens it). */
export const PLAIN_RIGHT = 12
/** The bottom margin: the x tick labels, then the axis title (AXIS_TITLE_SHIFT under the plot). */
export const MARGIN_BOTTOM = 44
const AXIS_TITLE_SHIFT = -24
/** How faint a term, square or chip is while another is hovered, or left out by the chip filter. */
const FADE = 0.3

const tickFont = (): string => `${PLOT_TEXT.tick}px ${plotFontCss()}`
const boldTickFont = (): string => `bold ${tickFont()}`

/** A term label's category square, px a side — and the module bars' width, so the two marks
 *  beside the labels match. Drawn as the "■" character (it fades with its label on hover), at the
 *  font size that makes its ink this wide: ~0.46 em in Arial, so ~13px where the labels are 11. */
export const SQUARE_PX = 6
let squareFit: { font: string; px: number } | null = null
/** The font size the square is drawn at, measured in the plot's font (0.46 em before measuring). */
function squareFontPx(): number {
  const family = plotFontCss()
  if (squareFit?.font === family) return squareFit.px
  let ink = 0.46
  try {
    const c = document.createElement('canvas').getContext('2d')
    if (c) {
      c.font = `100px ${family}`
      const m = c.measureText('■')
      const w = (m.actualBoundingBoxRight + m.actualBoundingBoxLeft) / 100
      if (w > 0.1) ink = w
    }
  } catch {
    /* no canvas: the Arial ratio */
  }
  squareFit = { font: family, px: Math.round((SQUARE_PX / ink) * 10) / 10 }
  return squareFit.px
}
/** A label's square as its tick text draws it: a space, then the square in `color`. */
const squareText = (color: string): string =>
  ` <span style="font-size:${squareFontPx()}px;color:${color}">■</span>`
/** The width the square takes after a label's text, px (its space included). */
const squareWidth = (): number =>
  measureText(' ', boldTickFont()) + measureText('■', `${squareFontPx()}px ${plotFontCss()}`)

/** `#rrggbb` → `rgba(r,g,b,a)`. */
export function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** A paper-anchored text annotation. */
export function note(
  text: string,
  x: number,
  y: number,
  color: string,
  size: number,
  align: 'left' | 'right' | 'center' = 'center'
): Record<string, unknown> {
  return {
    text,
    showarrow: false,
    xref: 'paper',
    yref: 'paper',
    x,
    y,
    xanchor: align,
    font: { color, size }
  }
}

/** The term groups a plot has: every one present (over EVERY term, so the chips stay put whichever
 *  are chosen), in the source's fixed order, each in its fixed colour — so a group has the same
 *  place and colour in every plot — and the ones chosen by clicking chips. */
export interface TermGroups {
  groups: string[]
  color: Map<string, string>
  /** the chosen groups (none: every term shows) — a choice the data no longer has is ignored, and
   *  with the legend off there are no chips to undo one with, so none */
  only: string[]
  /** whether a term shows under the choice */
  keep: (t: { category?: string }) => boolean
}

export function termGroups(
  terms: readonly { category?: string }[],
  o: {
    onlyCats: readonly string[]
    legendOff: boolean
    categorical: readonly string[]
    groupIndex: (group: string, local: number) => number
    inGroupOrder: (seen: string[]) => string[]
  }
): TermGroups {
  const seen: string[] = []
  for (const t of terms) if (t.category && !seen.includes(t.category)) seen.push(t.category)
  const groups = o.inGroupOrder(seen)
  const color = new Map(
    groups.map((c, i) => [c, o.categorical[o.groupIndex(c, i) % o.categorical.length]])
  )
  const only = (o.legendOff ? [] : o.onlyCats).filter((c) => groups.includes(c))
  const keep = (t: { category?: string }): boolean =>
    !only.length || (!!t.category && only.includes(t.category))
  return { groups, color, only, keep }
}

/** The gene modules a plot has (with modules on): every one present (over EVERY term, so the chips
 *  stay put whichever are chosen), in the order they stack top to bottom, each in its colour, and
 *  the ones chosen by clicking their chips — as TermGroups, for the categories. */
export interface TermModuleGroups {
  modules: string[]
  /** a module's colour: the module palette's, in stacking order from `offset` */
  color: (module: string) => string
  /** the chosen modules (none: every term shows) — one the data no longer has is ignored, and with
   *  the legend off there are no chips to undo one with, so none */
  only: string[]
  /** a term's module (none: undefined) */
  of: (term: string) => string | undefined
  /** whether a term shows under the choice: with modules chosen, only their terms */
  keep: (t: { term: string }) => boolean
}

export function termModuleGroups(
  topFirst: readonly string[],
  moduleOf: ReadonlyMap<string, string> | undefined,
  o: {
    onlyMods: readonly string[]
    legendOff: boolean
    /** the modules' palette, and the colour they start at in it: past the categories' when it's
     *  their palette too (moduleColorStart) */
    palette: readonly string[]
    offset: number
  }
): TermModuleGroups {
  const of = (term: string): string | undefined => moduleOf?.get(term)
  const modules: string[] = []
  for (const t of topFirst) {
    const m = of(t)
    if (m !== undefined && !modules.includes(m)) modules.push(m)
  }
  const only = (o.legendOff ? [] : o.onlyMods).filter((m) => modules.includes(m))
  const keep = (t: { term: string }): boolean => {
    if (!only.length) return true
    const m = of(t.term)
    return m !== undefined && only.includes(m)
  }
  const at = new Map(modules.map((m, i) => [m, i]))
  const color = (m: string): string => {
    const i = at.get(m)
    return i === undefined || !o.palette.length
      ? '#999999'
      : o.palette[(o.offset + i) % o.palette.length]
  }
  return { modules, color, only, of, keep }
}

/** Where the modules' colours start in their palette: past the categories' (`categories` of them —
 *  every one the source has, so it's the same in every plot) when the two share a palette, so no
 *  module takes a category's colour; at its start when they don't. */
export const moduleColorStart = (
  modulePalette: readonly string[],
  categoryPalette: readonly string[],
  categories: number
): number => (modulePalette === categoryPalette ? categories : 0)

/** Prefix of a clickable module chip's annotation name (the rest is its module). */
export const MODULE_CHIP = 'oe-mod:'
/** A module's key among the legend's re-texted entries (`__oeLegendCat`, and a tick's entries in
 *  `legendKeys`) — apart from any category's. */
const MOD_KEY = '\u0000mod:'

/** The legend entries a term's tick lights while it's active: its category's chip, its module's. */
export function legendKeys(category: string | undefined, module: string | undefined): string[] {
  return [...(category ? [category] : []), ...(module !== undefined ? [MOD_KEY + module] : [])]
}

/** The legend: one clickable chip per category (click to show only its terms), flowing left to
 *  right from the figure's left edge and wrapping onto lines that fit the tile. With modules on, two
 *  sections, a gap apart: "categories", then "modules", each heading in a column of its own on the
 *  left with its chips flowing (and wrapping) to its right — a module's chip a bar in its colour, as
 *  beside the labels, then its name; a click shows only that module's terms (with categories chosen
 *  too, the terms in both). Each chip has a fixed slot sized for its BOLD text, so bolding one
 *  (chosen, or its terms hovered) never moves the others. None while the tile's legend is off. */
export interface CategoryLegend {
  annotations: Record<string, unknown>[]
  /** the plot's top margin: the legend's lines with their air above and gap below */
  top: number
  /** an entry's text in a hover state (PlotlyChart re-texts the chips as terms are hovered), by its
   *  key: a category, or a module's (legendKeys) */
  itemText?: (key: string, active: boolean, anyActive: boolean) => string
}

export function categoryLegend(
  g: TermGroups,
  legendOff: boolean,
  budget: number,
  p: Palette,
  m?: TermModuleGroups
): CategoryLegend {
  const fs = PLOT_TEXT.legend
  const row = legendRow()
  const shown = legendOff ? [] : g.groups
  const mods = legendOff || !m ? [] : m.modules
  const boldFont = `bold ${fs}px ${plotFontCss()}`
  const name = (c: string): string => fitText(c, Math.min(CHIP_MAX, budget), boldFont)
  // A module's name is its top term's with its size — cut the term, keep the size.
  const modName = (mod: string): string => {
    const k = moduleParts(mod)
    if (!k) return name(mod)
    const size = ` (${k.size})`
    return `${fitText(k.rep, Math.min(CHIP_MAX, budget) - measureText(size, boldFont), boldFont)}${size}`
  }
  // Active → bold; something else active, or left out by the chip filter → faint; a chosen group
  // bold — the slots are sized for bold, so neither moves a chip.
  const catText = (c: string, active: boolean, anyActive: boolean): string => {
    const base = g.color.get(c) ?? p.text
    const off = (g.only.length > 0 && !g.only.includes(c)) || (anyActive && !active)
    const bold = active || g.only.includes(c)
    const n = name(c)
    return `<span style="color:${off ? hexA(base, FADE) : base}">■ ${bold ? `<b>${n}</b>` : n}</span>`
  }
  const modText = (mod: string, active: boolean, anyActive: boolean): string => {
    const only = m?.only ?? []
    const off = (only.length > 0 && !only.includes(mod)) || (anyActive && !active)
    const bold = active || only.includes(mod)
    const n = modName(mod)
    const hue = m?.color(mod) ?? p.textMuted
    const bar = off ? hexA(hue, FADE) : hue
    return (
      `<span style="color:${bar}">▌</span>` +
      `<span style="color:${off ? hexA(p.text, FADE) : p.text}"> ${bold ? `<b>${n}</b>` : n}</span>`
    )
  }
  const itemText = (key: string, active: boolean, anyActive: boolean): string =>
    key.startsWith(MOD_KEY)
      ? modText(key.slice(MOD_KEY.length), active, anyActive)
      : catText(key, active, anyActive)
  // Two sections (categories, modules) once there are modules: each heading in a column on the
  // left, wide enough for either, its chips to the right of it.
  const headed = mods.length > 0
  const headFont = `${fs}px ${plotFontCss()}`
  const HEADS = ['categories', 'modules'] as const
  const indent = headed
    ? Math.ceil(Math.max(...HEADS.map((h) => measureText(h, headFont)))) + CHIP_GAP
    : 0
  const room = Math.max(CHIP_GAP, budget - indent)
  const catFlow = flowChips(
    shown.map((c) => ({
      c,
      width: Math.ceil(measureText(`■ ${name(c)}`, boldFont)) + CHIP_GAP
    })),
    room,
    CHIP_GAP
  )
  const modFlow = flowChips(
    mods.map((mod) => ({
      c: MOD_KEY + mod,
      width: Math.ceil(measureText(`▌ ${modName(mod)}`, boldFont)) + CHIP_GAP
    })),
    room,
    CHIP_GAP
  )
  // the sections' gap, between the categories' last line and the modules' first
  const gap = catFlow.lines && modFlow.lines ? SECTION_GAP : 0
  const height = (catFlow.lines + modFlow.lines) * row + gap
  // up from the plot to the bottom of the categories' line `line` (0 = their first) or the
  // modules'; the first line on top, the rest below it down to the plot
  const catUp = (line: number): number =>
    modFlow.lines * row + gap + (catFlow.lines - 1 - line) * row
  const modUp = (line: number): number => (modFlow.lines - 1 - line) * row
  // an item at `x` past the heading column, `up` px over the legend's bottom line, from the
  // figure's left edge (PlotlyChart's container-left alignment)
  const place = (text: string, color: string, x: number, up: number): Record<string, unknown> => ({
    ...note(text, 0, 1, color, fs, 'left'),
    __oeAlignContainerLeft: true,
    xshift: x,
    yanchor: 'bottom',
    yshift: LEGEND_GAP + up
  })
  const chip = (key: string, x: number, up: number, click: string): Record<string, unknown> => ({
    ...place(itemText(key, false, false), p.text, indent + x, up),
    // tagged for re-texting
    __oeLegendCat: key,
    name: click,
    captureevents: true
  })
  const annotations = [
    ...(headed && catFlow.lines ? [place(HEADS[0], p.textMuted, 0, catUp(0))] : []),
    ...catFlow.at.map(({ c, x, line }) => chip(c, x, catUp(line), `${CHIP}${c}`)),
    ...(headed ? [place(HEADS[1], p.textMuted, 0, modUp(0))] : []),
    ...modFlow.at.map(({ c, x, line }) =>
      chip(c, x, modUp(line), `${MODULE_CHIP}${c.slice(MOD_KEY.length)}`)
    )
  ]
  return {
    annotations,
    top: LEGEND_TOP + height + LEGEND_GAP,
    itemText: shown.length || mods.length ? itemText : undefined
  }
}

/** The most a term label's text may take, px, in a figure `figW` wide with `right` px of margin on
 *  the right (its square and the gap to the axis come on top). A fallback before measuring. */
export function labelTextBudget(figW: number, right: number): number {
  if (!(figW > 0)) return 280
  const room = figW - right
  const plotFloor = Math.max(MIN_PLOT_PX, MIN_PLOT_SHARE * room)
  const square = squareWidth()
  return Math.max(MIN_LABEL_PX, Math.floor(room - plotFloor - LABEL_PAD - square))
}

/** The narrowest the figure is drawn, px, with `right` px of margin on the right: the labels' and
 *  the plot's minimums side by side. A tile narrower than this scrolls sideways to it rather than
 *  squeezing the plot to nothing. */
export function minFigureWidth(right: number): number {
  return Math.ceil(MIN_LABEL_PX + squareWidth() + LABEL_PAD + MIN_PLOT_PX + right)
}

/** Term labels: a term's text cut to the label budget (at its bold width, the widest it draws),
 *  then a square in its group's colour. At rest in the axis's own muted tick colour; once something's
 *  hovered, the active one bold in the text colour and the rest faded, square and all. */
export interface TermLabels {
  /** the text cut to fit, as the label shows it (the full text stays in the hover) */
  fit: (text: string) => string
  /** a label's tick text in a hover state, from its fitted text and its term's group */
  tick: (
    fitted: string,
    category: string | undefined,
    active: boolean,
    anyActive: boolean
  ) => string
  /** the left margin for these labels (fitted, with their groups) at their widest — fixed, so the
   *  plot never slides as labels bold or the chosen groups change */
  marginLeft: (labels: readonly { fitted: string; category?: string }[]) => number
}

export function termLabels(g: TermGroups, budget: number, p: Palette): TermLabels {
  const fit = (text: string): string => fitText(text, budget, boldTickFont())
  const tick = (
    fitted: string,
    category: string | undefined,
    active: boolean,
    anyActive: boolean
  ): string => {
    const fade = (c: string): string => (anyActive && !active ? hexA(c, FADE) : c)
    const group = category ? g.color.get(category) : undefined
    const square = group ? squareText(fade(group)) : ''
    if (!active && !anyActive) return `${fitted}${square}`
    return `<span style="color:${fade(p.text)}">${active ? `<b>${fitted}</b>` : fitted}</span>${square}`
  }
  const marginLeft = (labels: readonly { fitted: string; category?: string }[]): number =>
    Math.ceil(
      Math.max(
        0,
        ...labels.map(
          (l) =>
            measureText(l.fitted, boldTickFont()) +
            (l.category && g.color.has(l.category) ? squareWidth() : 0)
        )
      )
    ) + LABEL_PAD
  return { fit, tick, marginLeft }
}

/** The term axis (y): the labels as array ticks, no tick marks (the shared axis style's tick colour
 *  would turn Plotly's on, reading as stray marks after each square), a faint gridline along each
 *  term to track its marks back to its label, and a fixed range — not automargin or autorange, which
 *  followed a hovered label's bolding or an enlarged dot and slid the plot. */
export function termAxis(
  p: Palette,
  a: { tickvals: unknown[]; ticktext: string[]; range: [number, number]; standoff?: number }
): Record<string, unknown> {
  return {
    ...axisBase(p),
    // the labels off the axis by the module bars' room (moduleRoom), when they're drawn
    ...(a.standoff ? { ticklabelstandoff: a.standoff } : null),
    tickmode: 'array',
    tickvals: a.tickvals,
    ticktext: a.ticktext,
    range: a.range,
    automargin: false,
    tickfont: { size: PLOT_TEXT.tick },
    ticks: '',
    showgrid: true,
    gridcolor: p.grid,
    gridwidth: AXIS_LINE_WIDTH
  }
}

/** The layout every style starts from: the shared plot base, no Plotly legend (the category
 *  legend is chrome's own), the tile's title. */
export function frame(p: Palette, title: string | undefined): Record<string, unknown> {
  return {
    ...plotBase(p),
    showlegend: false,
    title: title ? { text: title, font: { size: PLOT_TEXT.heading } } : undefined
  }
}

/** Gene modules' bars, beside the term labels (as the fold-change heatmap's beside its rows): a bar
 *  `MODULE_BAR` px wide, `MODULE_GAP` off the plot's left edge, over each run of rows in one module
 *  — one row too: a module is computed over every term, so the plot's cut (or "one per module") can
 *  leave one of its terms on show, and the legend lists it. The labels stand `moduleRoom` further
 *  off the axis to make room. */
const MODULE_BAR = SQUARE_PX
const MODULE_GAP = 4
export const moduleRoom = (on: boolean): number => (on ? MODULE_BAR + 2 * MODULE_GAP : 0)

/** A module's own id, as its bar's focus target (hovered, clicked — as a term's mark). */
export const moduleId = (module: string): string => `module:${module}`

/** The modules' bars as focus targets, for rows each with its module (`moduleOf[i]`) and its own
 *  ids (`idsOf[i]` — its term's marks): each module's id → its rows' ids (PlotlyChart memberIdsOf,
 *  so hovering the bar focuses them all), and into `genesById` the module's id → every one of their
 *  genes (so a click selects them, as a term's does). */
export function moduleTargets(
  moduleOf: readonly (string | undefined)[],
  idsOf: readonly (readonly string[])[],
  genesById: Map<string, string[]>
): Map<string, string[]> {
  const members = new Map<string, string[]>()
  moduleOf.forEach((m, i) => {
    if (m === undefined) return
    const k = moduleId(m)
    members.set(k, [...(members.get(k) ?? []), ...idsOf[i]])
  })
  for (const [k, ids] of members)
    genesById.set(k, [...new Set(ids.flatMap((id) => genesById.get(id) ?? []))])
  return members
}

/** Where a label's square sits about its row's centre, px up: Plotly sets a tick label's baseline
 *  `MID_SHIFT` font-sizes below its tick, and the "■" sits on the baseline — so a square runs from
 *  that far below the centre to SQUARE_PX above that (from 3.85px below to 2.15px above, at 11px
 *  labels and a 6px square). */
const MID_SHIFT = 0.35
const squareSpan = (): { below: number; above: number } => {
  const below = MID_SHIFT * PLOT_TEXT.tick
  return { below, above: SQUARE_PX - below }
}

/** The module bars for rows at y positions `at(i)`, `moduleOf[i]` each row's module (undefined:
 *  none), each in its module's colour. A bar lines up with the labels' squares beside it — from its
 *  top row's square's top edge to its bottom row's square's bottom edge, so a one-row module's bar
 *  is a square level with the category square: the run between its rows' centres in data, and a
 *  square-sized cap in pixels on each end row (rows stretch with the tile; the squares don't). */
export function moduleBars(
  moduleOf: readonly (string | undefined)[],
  at: (i: number) => number,
  color: (module: string) => string
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const { below, above } = squareSpan()
  const piece = (m: string, y: Record<string, unknown>): Record<string, unknown> => ({
    type: 'rect',
    xref: 'paper',
    yref: 'y',
    xsizemode: 'pixel',
    xanchor: 0,
    x0: -(MODULE_GAP + MODULE_BAR),
    x1: -MODULE_GAP,
    ...y,
    fillcolor: color(m),
    // hovered / clicked as its module's terms together (pointer.ts hit-tests it)
    __oeId: moduleId(m),
    line: { width: 0 },
    layer: 'above'
  })
  // an end row's square: pixels about its centre, up positive
  const cap = (m: string, y: number): Record<string, unknown> =>
    piece(m, { ysizemode: 'pixel', yanchor: y, y0: -below, y1: above })
  let i = 0
  while (i < moduleOf.length) {
    const m = moduleOf[i]
    let j = i
    while (j + 1 < moduleOf.length && m !== undefined && moduleOf[j + 1] === m) j++
    if (m !== undefined) {
      const lo = Math.min(at(i), at(j))
      const hi = Math.max(at(i), at(j))
      out.push(cap(m, hi))
      if (j > i) out.push(piece(m, { y0: lo, y1: hi }), cap(m, lo))
    }
    i = j + 1
  }
  return out
}

/** The plot's margins: the labels' on the left, the legend's on top, the style's on the right. */
export function margins(
  left: number,
  legend: CategoryLegend,
  right: number = PLAIN_RIGHT
): Record<string, number> {
  return { l: left, r: right, t: legend.top, b: MARGIN_BOTTOM }
}

/** The x axis title under the tick labels — the measure, with the facet's comparison — centred and
 *  cut to the plot's width: the figure's (`budget` + LEGEND_INSET) less the margins either side. */
export function axisTitle(
  text: string,
  budget: number,
  m: Record<string, number>,
  p: Palette
): Record<string, unknown> {
  const plotW = Math.max(120, budget + LEGEND_INSET - m.l - m.r)
  return {
    ...note(
      fitText(text, plotW, `${PLOT_TEXT.axisTitle}px ${plotFontCss()}`),
      0.5,
      0,
      p.textMuted,
      PLOT_TEXT.axisTitle,
      'center'
    ),
    yanchor: 'top',
    yshift: AXIS_TITLE_SHIFT
  }
}

/** Nothing enriched: the note alone, no axes. */
export function emptyLayout(p: Palette): Record<string, unknown> {
  return {
    ...plotBase(p),
    annotations: [note('No enriched terms', 0.5, 0.5, p.textMuted, 12)],
    xaxis: { ...axisBase(p), visible: false },
    yaxis: { ...axisBase(p), visible: false }
  }
}
