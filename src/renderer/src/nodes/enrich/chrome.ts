/** Everything an enrichment plot draws around its marks, built once for every style (dot, bar,
 *  ridge): the term groups (categories) and their colours, the clickable category legend and its
 *  spacing, the term labels with their group squares, the term axis, the left / top / bottom
 *  margins, the x axis title and the empty note. A style draws only its own marks — its bars,
 *  dots, ridges, and the dot style's size key — so the styles can't drift apart (architecture.test
 *  checks EnrichView builds none of this itself). */
import { fitText, flowChips, measureText } from '../../ui/legendChips'
import { AXIS_LINE_WIDTH } from '../../ui/plotAxes'
import { axisBase, type Palette, PLOT_TEXT, plotBase, plotFontCss } from '../../ui/theme'

/** Prefix of a clickable legend chip's annotation name (the rest is its group). */
export const CHIP = 'oe-cat:'

/** The category legend's geometry: the gap between chips; the plot's top margin holds `TOP` of air
 *  under the tile's switch bars, then the legend's lines, then `GAP` down to the plot area (clear of
 *  the top row's dots, which draw past it — up to half the largest dot, 12px). No modebar to clear:
 *  it's hidden on this plot. */
const CHIP_GAP = 14
const LEGEND_TOP = 8
const LEGEND_GAP = 14
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

/** The category legend: one clickable chip per group (click to show only its terms), flowing left
 *  to right from the figure's left edge and wrapping onto lines that fit the tile. Each chip has a
 *  fixed slot sized for its BOLD text, so bolding one (chosen, or its terms hovered) never moves the
 *  others. None while the tile's legend is off. */
export interface CategoryLegend {
  annotations: Record<string, unknown>[]
  /** the plot's top margin: the legend's lines with their air above and gap below */
  top: number
  /** a chip's text in a hover state (PlotlyChart re-texts the chips as terms are hovered) */
  itemText?: (c: string, active: boolean, anyActive: boolean) => string
}

export function categoryLegend(
  g: TermGroups,
  legendOff: boolean,
  budget: number,
  p: Palette
): CategoryLegend {
  const fs = PLOT_TEXT.legend
  const row = legendRow()
  const shown = legendOff ? [] : g.groups
  // Active → bold; something else active, or left out by the chip filter → faint; a chosen group
  // bold — the slots are sized for bold, so neither moves a chip.
  const itemText = (c: string, active: boolean, anyActive: boolean): string => {
    const base = g.color.get(c) ?? p.text
    const off = (g.only.length > 0 && !g.only.includes(c)) || (anyActive && !active)
    const bold = active || g.only.includes(c)
    return `<span style="color:${off ? hexA(base, FADE) : base}">■ ${bold ? `<b>${c}</b>` : c}</span>`
  }
  const flow = flowChips(
    shown.map((c) => ({
      c,
      width: Math.ceil(measureText(`■ ${c}`, `bold ${fs}px ${plotFontCss()}`)) + CHIP_GAP
    })),
    budget,
    CHIP_GAP
  )
  const annotations = flow.at.map(({ c, x, line }) => ({
    ...note(itemText(c, false, false), 0, 1, p.text, fs, 'left'),
    // from the figure's left edge (PlotlyChart's container-left alignment); tagged for re-texting
    __oeAlignContainerLeft: true,
    __oeLegendCat: c,
    xshift: x,
    yanchor: 'bottom',
    // the first line on top, the rest below it down to the plot
    yshift: LEGEND_GAP + (flow.lines - 1 - line) * row,
    name: `${CHIP}${c}`,
    captureevents: true
  }))
  return {
    annotations,
    top: LEGEND_TOP + flow.lines * row + LEGEND_GAP,
    itemText: shown.length ? itemText : undefined
  }
}

/** The most a term label's text may take, px, in a figure `figW` wide with `right` px of margin on
 *  the right (its square and the gap to the axis come on top). A fallback before measuring. */
export function labelTextBudget(figW: number, right: number): number {
  if (!(figW > 0)) return 280
  const room = figW - right
  const plotFloor = Math.max(MIN_PLOT_PX, MIN_PLOT_SHARE * room)
  const square = measureText(' ■', boldTickFont())
  return Math.max(MIN_LABEL_PX, Math.floor(room - plotFloor - LABEL_PAD - square))
}

/** The narrowest the figure is drawn, px, with `right` px of margin on the right: the labels' and
 *  the plot's minimums side by side. A tile narrower than this scrolls sideways to it rather than
 *  squeezing the plot to nothing. */
export function minFigureWidth(right: number): number {
  return Math.ceil(
    MIN_LABEL_PX + measureText(' ■', boldTickFont()) + LABEL_PAD + MIN_PLOT_PX + right
  )
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
    const square = group ? ` <span style="color:${fade(group)}">■</span>` : ''
    if (!active && !anyActive) return `${fitted}${square}`
    return `<span style="color:${fade(p.text)}">${active ? `<b>${fitted}</b>` : fitted}</span>${square}`
  }
  const marginLeft = (labels: readonly { fitted: string; category?: string }[]): number =>
    Math.ceil(
      Math.max(
        0,
        ...labels.map((l) =>
          measureText(
            `${l.fitted}${l.category && g.color.has(l.category) ? ' ■' : ''}`,
            boldTickFont()
          )
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
  a: { tickvals: unknown[]; ticktext: string[]; range: [number, number] }
): Record<string, unknown> {
  return {
    ...axisBase(p),
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
