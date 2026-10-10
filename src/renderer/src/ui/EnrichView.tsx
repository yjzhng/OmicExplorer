import { useMemo, useState } from 'react'

import { useElementSize } from '../dashboard/useElementSize'

import type { EnrichData, EnrichTerm } from '../engine'
import { PlotlyChart, type PlotLabel } from './PlotlyChart'
import { axisBase, CATEGORICAL, EFFECT_COLOR, plotBase, PALETTES } from './theme'
import { useUiTheme } from './useUiTheme'
import type { EffectColors } from '../graph/types'

/** Pixel width of `text` at `font` (e.g. 'bold 10px sans-serif'), via a memoised offscreen canvas —
 *  so legend slot widths match the rendered text instead of a char-count estimate. */
let measureCtx: CanvasRenderingContext2D | null = null
function measureText(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * 6 // fallback if 2D context is unavailable
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

/** Prefix of a clickable legend chip's annotation name (the rest is its group). */
const CHIP = 'oe-cat:'

/** Flow legend chips left to right into lines that fit `budget` px, first line on top. Each chip's
 *  slot is `width` px — sized by the caller for its widest (bold) text. (The plot hides Plotly's
 *  control bar, which would otherwise sit over the top line's right end.) */
function flowChips(
  chips: { c: string; width: number }[],
  budget: number
): { at: { c: string; x: number; line: number }[]; lines: number } {
  const at: { c: string; x: number; line: number }[] = []
  let x = 0
  let line = 0
  for (const { c, width } of chips) {
    if (x > 0 && x + width > budget) {
      x = 0
      line++
    }
    at.push({ c, x, line })
    x += width
  }
  return { at, lines: at.length ? line + 1 : 0 }
}

/** `text` cut to fit `maxPx` at `font`, ending in "…" when cut (binary search on the length). */
function fitText(text: string, maxPx: number, font: string): string {
  if (measureText(text, font) <= maxPx) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (measureText(`${text.slice(0, mid).trimEnd()}…`, font) <= maxPx) lo = mid
    else hi = mid - 1
  }
  return `${text.slice(0, lo).trimEnd()}…`
}

/** Sequential colour ramps per direction (light→dark, no white end so faint dots stay visible):
 *  up = Reds, down = Blues. Colour encodes −log₁₀ FDR magnitude. */
const UP_SCALE: [number, string][] = [
  [0, '#fcbba1'],
  [0.5, '#ef6548'],
  [1, '#99000d']
]
const DOWN_SCALE: [number, string][] = [
  [0, '#c6dbef'],
  [0.5, '#6baed6'],
  [1, '#08519c']
]

/** Diverging over-representation plot: enriched terms share one y axis, DOWN-regulated hits
 *  extend LEFT and UP-regulated hits extend RIGHT of centre. Bar style plots ±(−log₁₀ FDR),
 *  each side coloured by direction (red = up, blue = down); dot style plots ±gene ratio as a
 *  lollipop (stem from centre to the dot) with size = hit count and colour = −log₁₀ FDR on a
 *  Reds (up) / Blues (down) ramp. A faint gridline runs along each term, so a bar / dot tracks
 *  back to its label. A term enriched in both
 *  directions shows a marker on each side. Ticks read as absolute magnitudes; top = most significant. */
export function EnrichView({
  enrich,
  style = 'dot',
  title,
  effectColors,
  measure = 'log₂FC',
  comparison
}: {
  enrich: EnrichData
  style?: 'dot' | 'bar' | 'ridge'
  title?: string
  /** what the genes' values are (the upstream analysis's fold change — see fcMeasure) */
  measure?: string
  /** the facet's comparison, named with the measure on the axis; unset when several share it */
  comparison?: string
  /** the upstream Compare's effect colours (with any of the plot's own on top); unset = the
   *  shared defaults */
  effectColors?: EffectColors
}) {
  const mode = useUiTheme((s) => s.mode)
  const upColor = effectColors?.up ?? EFFECT_COLOR.up
  const downColor = effectColors?.down ?? EFFECT_COLOR.down
  const noneColor = effectColors?.none ?? EFFECT_COLOR.none
  // The tile's width, so the group legend wraps to what fits instead of running off the edge (it
  // stays in the plot — not HTML beside it — so copies and downloads carry it).
  const { ref: boxRef, width: boxW, height: boxH } = useElementSize<HTMLDivElement>()
  // The tile's height, in 10px steps (0 = not measured yet) — to stack the dot plot's right-margin
  // keys in pixels under one another.
  const heightBudget = boxH > 0 ? Math.floor(boxH / 10) * 10 : 0
  // Room for the legend: the figure's width less the inset either side; a fallback before measuring.
  // In 20px steps, so dragging a tile's edge rebuilds the figure only when the wrap could change.
  const legendBudget = boxW > 0 ? Math.max(160, Math.floor((boxW - 40) / 20) * 20) : 520
  // The widest a term's label may be: ~40% of the tile, so one very long term name can't take the
  // margin and squash the plot. The full name stays in the hover. 20px steps, as above.
  const termBudget = boxW > 0 ? Math.max(120, Math.floor((boxW * 0.4) / 20) * 20) : 280
  // Term groups to show — click a legend chip to show only its terms, click more to add them, click
  // a chosen one again to drop it; none chosen = every term. View state, not saved with the tile.
  const [onlyCats, setOnlyCats] = useState<string[]>([])
  const onAnnotationClick = (name: string): void => {
    if (!name.startsWith(CHIP)) return
    const c = name.slice(CHIP.length)
    setOnlyCats((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))
  }

  const { data, layout, labels, labelColor, boldTicks } = useMemo(() => {
    const p = PALETTES[mode]
    const gsea = enrich.method === 'gsea'

    // ── ridgeline (GSEA only): each set's member-log₂FC distribution as a stacked density ridge,
    //    on the real log₂FC axis, so up sets sit right of 0 and down sets left. ──────────────────
    if (style === 'ridge' && gsea) {
      const terms = [...enrich.up, ...enrich.down].filter((t) => (t.dist?.length ?? 0) > 0)
      if (terms.length === 0)
        return {
          data: [],
          layout: {
            ...plotBase(p),
            annotations: [note('No enriched sets', 0.5, 0.5, p.textMuted, 12)],
            xaxis: { ...axisBase(p), visible: false },
            yaxis: { ...axisBase(p), visible: false }
          },
          labels: [] as PlotLabel[],
          labelColor: p.text,
          boldTicks: undefined as undefined
        }
      // Ascending NES → index 0 (bottom) is the most down-regulated set, top the most up.
      terms.sort((a, b) => (a.nes ?? 0) - (b.nes ?? 0))
      // Every group present (bottom → top, as before) — the chips, whichever are chosen; then only
      // the chosen groups' sets are drawn (a choice the data no longer has is ignored).
      const allCats: string[] = []
      for (const t of terms)
        if (t.category && !allCats.includes(t.category)) allCats.push(t.category)
      const only = onlyCats.filter((c) => allCats.includes(c))
      const shown = only.length
        ? terms.filter((t) => !!t.category && only.includes(t.category))
        : terms
      // Build the row list, slotting the global (all-genes) reference ridge at the NES≈0 midline —
      // between the down sets (below) and the up sets (above).
      interface Row {
        label: string
        dist: number[]
        hue: string
        ref: boolean
        hover: string
        /** leading-edge genes to mark along the baseline (empty for the reference row); `ids` are
         *  the uniqIDs (for cross-view hover linking), aligned to names/x. */
        lead: { x: number[]; names: string[]; ids: string[] }
        /** KEGG top-level category (undefined for GO source / the reference row) */
        category?: string
      }
      const rows: Row[] = shown.map((t) => ({
        // Measured bold, as the margin below is — the widest a label gets (on hover).
        label: fitText(`${t.term} (${t.setSize})`, termBudget, 'bold 10px system-ui, sans-serif'),
        dist: t.dist as number[],
        hue: (t.nes ?? 0) >= 0 ? upColor : downColor,
        ref: false,
        hover:
          `<b>${t.term}</b><br>NES ${(t.nes ?? 0).toFixed(2)} • ` +
          `p.adj ${t.pAdjust.toExponential(2)}<br>set ${t.setSize} • ` +
          `median ${measure} ${med(t.dist as number[]).toFixed(2)}`,
        lead: { x: t.leadingDist ?? [], names: t.genes, ids: t.geneIds ?? t.genes },
        category: t.category
      }))
      const globalDist = enrich.ranked && enrich.ranked.length > 1 ? enrich.ranked : null
      if (globalDist) {
        const nDown = shown.filter((t) => (t.nes ?? 0) < 0).length
        rows.splice(nDown, 0, {
          label: `all genes (${globalDist.length})`,
          dist: globalDist,
          hue: noneColor,
          ref: true,
          hover:
            `<b>all genes</b> (reference)<br>${globalDist.length} genes • ` +
            `median ${measure} ${med(globalDist).toFixed(2)}`,
          lead: { x: [], names: [], ids: [] }
        })
      }

      let lo = Infinity
      let hi = -Infinity
      for (const row of rows)
        for (const v of row.dist) {
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      if (!(hi > lo)) {
        hi = lo + 1
        lo -= 1
      }
      const pad = (hi - lo) * 0.08
      lo -= pad
      hi += pad
      const G = 128
      const grid = Array.from({ length: G }, (_, i) => lo + ((hi - lo) * i) / (G - 1))
      const dens = rows.map((row) => kde(row.dist, grid))
      const maxD = Math.max(1e-9, ...dens.flat())
      const step = 1
      const overlap = 1.9
      const data: Record<string, unknown>[] = rows.map((row, r) => {
        const base = r * step
        const topY = dens[r].map((v) => base + (v / maxD) * overlap * step)
        return {
          type: 'scatter',
          mode: 'lines',
          __oeNoLabel: true,
          x: [...grid, ...[...grid].reverse()],
          y: [...topY, ...grid.map(() => base)],
          fill: 'toself',
          fillcolor: hexA(row.hue, 0.32),
          line: { width: 0 },
          hoveron: 'fills',
          text: row.hover,
          hovertemplate: '%{text}<extra></extra>'
        }
      })
      // Overlay the leading-edge genes as dots along each ridge's baseline (drawn after all fills
      // so they sit on top). A thin white edge keeps them legible over the coloured density.
      // Density-managed labels for the leading-edge dots: PlotlyChart's collision layer places the
      // highest-|log₂FC| ones that fit the current view (crowded ones hide; zooming in surfaces more).
      const labels: PlotLabel[] = []
      rows.forEach((row, r) => {
        if (row.ref || row.lead.x.length === 0) return
        data.push({
          type: 'scatter',
          mode: 'markers',
          __oeNoLabel: true,
          x: row.lead.x,
          y: row.lead.x.map(() => r * step),
          // customdata = uniqID drives the shared hover link (volcano/MA/etc.); the name is in `text`.
          customdata: row.lead.ids,
          text: row.lead.names,
          hovertemplate: '%{text}<br>log₂FC %{x:.2f}<extra></extra>',
          marker: { size: 5, color: row.hue, line: { width: 0.5, color: p.bg }, opacity: 0.95 }
        })
        // Leading-edge genes are shown as dots only (names appear on hover); no baseline labels.
      })
      // Term group → colour (a KEGG pathway's category, a COG category's area; stable order = first
      // appearance, top→bottom). Mark each term's y-tick label with a square in its group's
      // colour and show a centred legend above (only groups present).
      const cats = allCats
      const catColor = new Map(cats.map((c, i) => [c, CATEGORICAL[i % CATEGORICAL.length]]))
      // y-tick label for a term given its hover state: the name in the plain text colour, then a
      // square in its group's colour (by the axis) — the colour marks the group without making the
      // name itself hard to read. Active → bold; when another term is active this one FADES, square
      // and all (low opacity, like the STRING legend).
      const tickLabel = (i: number, active: boolean, anyActive: boolean): string => {
        const row = rows[i]
        const fade = (c: string): string => (anyActive && !active ? hexA(c, 0.3) : c)
        const inner = active ? `<b>${row.label}</b>` : row.label
        const group = row.category ? catColor.get(row.category) : undefined
        const square = group ? ` <span style="color:${fade(group)}">■</span>` : ''
        return `<span style="color:${fade(p.text)}">${inner}</span>${square}`
      }
      const ticktext = rows.map((_, i) => tickLabel(i, false, false))
      // One annotation PER category, at a FIXED pixel offset (xshift) from the figure's left edge, so
      // bolding one entry on hover can't shift the others. Each slot is sized for the BOLD width + a
      // padding gap, so a bolded entry grows within its own slot instead of into the next.
      const LEGEND_FS = 10
      const LEGEND_PAD = 12 // px gap between items
      // Legend item text per hover state: active → bold + full colour; muted (something else active)
      // → grey; otherwise full colour. Measured at BOLD width so slots don't overflow.
      // A group left out by the chip filter stays faint whatever is hovered.
      const legendItemText = (c: string, active: boolean, anyActive: boolean): string => {
        const base = catColor.get(c) ?? p.text
        const off = (only.length > 0 && !only.includes(c)) || (anyActive && !active)
        const col = off ? hexA(base, 0.3) : base
        // Bold for the hover and for a chosen group — the slots are sized for bold, so neither moves
        // a chip.
        const bold = active || only.includes(c)
        return `<span style="color:${col}">■ ${bold ? `<b>${c}</b>` : c}</span>`
      }
      // Items flow left to right and wrap onto further rows (stacked upward from the plot) when the
      // next would pass the tile's edge.
      const ROW_H = LEGEND_FS + 5
      const flow = flowChips(
        cats.map((c) => ({
          c,
          width:
            Math.ceil(measureText(`■ ${c}`, `bold ${LEGEND_FS}px system-ui, sans-serif`)) +
            LEGEND_PAD
        })),
        legendBudget
      )
      const legend = flow.at.map(({ c, x, line }) => {
        const ann = {
          // Align each item's left edge to the figure's left edge (the pathway-label margin) via the
          // shared container-left recompute in PlotlyChart; __oeLegendCat tags it for hover re-texting.
          __oeAlignContainerLeft: true,
          __oeLegendCat: c,
          x: 0,
          xref: 'paper',
          xanchor: 'left',
          xshift: x,
          y: 1.0,
          yref: 'paper',
          yanchor: 'bottom',
          // The first line on top (clear of the modebar), the rest below it down to the plot.
          yshift: (flow.lines - 1 - line) * ROW_H,
          showarrow: false,
          text: legendItemText(c, false, false),
          font: { size: LEGEND_FS },
          // A chip: click to show only this group's sets (see onAnnotationClick).
          name: `${CHIP}${c}`,
          captureevents: true
        }
        return ann
      })
      // Rows ABOVE the first, so the plot's top margin grows to hold them.
      const legendRows = flow.lines
      // The left margin, sized for every label at its WIDEST — bold, with its group square — and
      // fixed. Hovering a leading-edge gene bolds its pathways' labels (boldTicks); with an
      // auto-sized margin that widened the margin and slid the whole plot right under the cursor,
      // so the dot being clicked moved away (and, unhovered, un-bolded and slid back).
      const TICK_FS = 10
      const labelW = Math.max(
        0,
        ...rows.map((row) =>
          measureText(
            `${row.label}${row.category ? ' ■' : ''}`,
            `bold ${TICK_FS}px system-ui, sans-serif`
          )
        )
      )
      const lay: Record<string, unknown> = {
        ...plotBase(p),
        showlegend: false,
        title: title ? { text: title, font: { size: 13 } } : undefined,
        // + the tick labels' gap from the axis, and a little slack for font metrics.
        margin: {
          l: Math.ceil(labelW) + 16,
          r: 12,
          t: cats.length ? 40 + (legendRows - 1) * ROW_H : 24,
          b: 40
        },
        annotations: legend,
        xaxis: {
          ...axisBase(p),
          // The measure and the comparison it's of ("interaction log₂FC · KO|WT × Amk|H2O"), cut to
          // the tile's width; the measure alone when the facet holds several comparisons.
          title: {
            text: fitText(
              comparison ? `${measure} · ${comparison}` : measure,
              legendBudget,
              '11px system-ui, sans-serif'
            ),
            font: { size: 11 }
          },
          zeroline: true,
          zerolinecolor: p.axis,
          showgrid: true,
          // Fixed to the ridges' padded span: autorange pads for marker size, so a hovered (enlarged)
          // gene dot at the far left/right — the top or bottom of the ranking — widened the range and
          // nudged the whole plot.
          range: [lo, hi]
        },
        yaxis: {
          ...axisBase(p),
          tickmode: 'array',
          tickvals: rows.map((_, r) => r * step),
          ticktext,
          // Not automargin: the margin above already fits the widest (bold) label, and must not
          // move as labels bold and un-bold.
          automargin: false,
          tickfont: { size: TICK_FS },
          // No tick marks (the shared axis style's tick colour would turn them on) — see dot/bar.
          ticks: '',
          range: [-0.6, (rows.length - 1) * step + overlap * step + 0.3],
          // Horizontal gridline at each pathway's baseline, to track a ridge back to its label.
          showgrid: true,
          gridcolor: p.grid,
          gridwidth: 1
        }
      }
      // Bold a pathway's label (and its category legend entry) when a hovered/pinned gene is one of
      // its leading-edge genes.
      const boldTicks = {
        genesByTick: rows.map((r) => r.lead.ids),
        tickLabel,
        categoryByTick: rows.map((r) => r.category),
        legendItemText: cats.length ? legendItemText : undefined
      }
      return { data, layout: lay, labels, labelColor: p.text, boldTicks }
    }

    const negLog = (v: number): number => -Math.log10(Math.max(v, 1e-300))
    // Magnitude a term extends from centre. Bar: −log₁₀ FDR. Dot: gene ratio (ORA) or |NES| (GSEA).
    const mag = (t: EnrichTerm): number =>
      style === 'bar' ? negLog(t.pAdjust) : gsea ? Math.abs(t.nes ?? 0) : t.geneRatio
    const geneList = (g: string[]): string =>
      g.length <= 10 ? g.join(', ') : `${g.slice(0, 10).join(', ')} +${g.length - 10} more`
    const hover = (terms: EnrichTerm[], n: number, dir: string): string[] =>
      terms.map((t) =>
        gsea
          ? `<b>${t.term}</b> (${dir})<br>` +
            `NES ${(t.nes ?? 0).toFixed(2)} • p.adj ${t.pAdjust.toExponential(2)}<br>` +
            `leading edge: ${t.count}/${t.setSize}<br>${geneList(t.genes)}`
          : `<b>${t.term}</b> (${dir})<br>` +
            `genes: ${t.count}/${n} (ratio ${t.geneRatio.toFixed(3)})<br>` +
            `in set: ${t.setSize} • fold ${t.fold.toFixed(2)}<br>` +
            `p.adj ${t.pAdjust.toExponential(2)}<br>${geneList(t.genes)}`
      )

    // Shared y order: union of both directions' terms, most significant at TOP. A category axis
    // stacks index 0 at the bottom, so sort ascending by best −log₁₀ FDR (least significant first).
    const yOrder = (terms: EnrichTerm[]): string[] => {
      const best = new Map<string, number>()
      for (const t of terms) best.set(t.term, Math.max(best.get(t.term) ?? 0, negLog(t.pAdjust)))
      return [...best.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0])
    }

    // Term group → colour (a KEGG pathway's category, a Reactome term's top-level pathway, a
    // COG/KOG category's area), as the ridge style shows it: a square in the group's colour right of
    // each term's label, and the groups present listed above. Ordered top→bottom by first appearance,
    // over EVERY term — the chips stay put (and keep their colours) whichever are chosen.
    const all = [...enrich.up, ...enrich.down]
    const catOf = new Map<string, string>()
    for (const t of all) if (t.category && !catOf.has(t.term)) catOf.set(t.term, t.category)
    const groups: string[] = []
    for (const term of [...yOrder(all)].reverse()) {
      const c = catOf.get(term)
      if (c && !groups.includes(c)) groups.push(c)
    }
    // Only the chosen groups' terms (a choice the data no longer has is ignored).
    const only = onlyCats.filter((c) => groups.includes(c))
    const keep = (t: EnrichTerm): boolean =>
      !only.length || (!!t.category && only.includes(t.category))
    const up = enrich.up.filter(keep)
    const down = enrich.down.filter(keep)
    const both = [...up, ...down]
    const order = yOrder(both)
    // Each term's highlight ids: its bar's / dot's hover text (what it sets as the hover).
    const idsByTerm = new Map<string, string[]>()
    for (const [terms, n, dir] of [
      [up, enrich.querySize.up, 'up'],
      [down, enrich.querySize.down, 'down']
    ] as const)
      hover(terms, n, dir).forEach((id, k) => {
        const term = terms[k].term
        idsByTerm.set(term, [...(idsByTerm.get(term) ?? []), id])
      })
    const groupColor = new Map(groups.map((c, i) => [c, CATEGORICAL[i % CATEGORICAL.length]]))
    // A term's tick in its hover state (as the ridge's): active → bold; something else active →
    // faded; at rest → plain.
    const termTick = (term: string, active = false, anyActive = false): string => {
      const c = catOf.get(term)
      const fade = (col: string): string => (anyActive && !active ? hexA(col, 0.3) : col)
      // The shown name is capped; the category values (tickvals) stay the full term names.
      const name = fitText(term, termBudget, '10px system-ui, sans-serif')
      const square = c ? ` <span style="color:${fade(groupColor.get(c)!)}">■</span>` : ''
      if (!active && !anyActive) return `${name}${square}`
      return `<span style="color:${fade(p.text)}">${active ? `<b>${name}</b>` : name}</span>${square}`
    }
    // The group legend: one clickable chip per group (click to show only its terms), flowing left
    // to right and wrapping onto lines that fit the tile. A chosen group is bold, one left out faint.
    // Each chip has a fixed slot sized for its BOLD width in the plot's own font, so choosing one
    // never moves the others.
    const LEGEND_FS = 10
    const LEGEND_ROW = LEGEND_FS + 4
    const { at: chipAt, lines: legendLineCount } = flowChips(
      groups.map((c) => ({
        c,
        width: Math.ceil(measureText(`■ ${c}`, `bold ${LEGEND_FS}px system-ui, sans-serif`)) + 14
      })),
      legendBudget
    )
    const legendH = legendLineCount * LEGEND_ROW
    // The group legend sits a fixed gap above the plot area — clear of the top row's dots, which
    // draw past it (up to half the largest dot, 12px).
    const LEGEND_GAP = 14
    const chips = chipAt.map(({ c, x, line }) => {
      const base = groupColor.get(c) ?? p.text
      const off = only.length > 0 && !only.includes(c)
      const on = only.includes(c)
      return {
        ...note(
          `<span style="color:${off ? hexA(base, 0.3) : base}">■ ${on ? `<b>${c}</b>` : c}</span>`,
          0,
          1,
          p.text,
          LEGEND_FS,
          'left'
        ),
        __oeAlignContainerLeft: true,
        xshift: x,
        yanchor: 'bottom',
        // The first line on top, as the block of text it replaces read.
        yshift: LEGEND_GAP + (legendLineCount - 1 - line) * LEGEND_ROW,
        name: `${CHIP}${c}`,
        captureevents: true
      }
    })

    // Size and colour scales over EVERY term, so filtering to a group doesn't re-scale them.
    const maxCount = Math.max(1, ...all.map((t) => t.count))
    // Dot size: area ∝ hit count, the largest 24px across, none under 10px (sizemin is a radius).
    const SIZE_REF = (2 * maxCount) / 24 ** 2
    const SIZE_MIN = 5
    /** The diameter Plotly draws a count at — its area rule (see renderedSize in PlotlyChart). */
    const dotPx = (v: number): number => 2 * Math.max(Math.sqrt(v / 2 / SIZE_REF), SIZE_MIN)
    const maxNegLog = Math.max(1e-6, ...all.map((t) => negLog(t.pAdjust)))

    // Lollipop stems: a thin line from centre (x=0) to each dot, so a dot tracks back to its term.
    const stems = (terms: EnrichTerm[], sign: 1 | -1, hue: string): Record<string, unknown> => {
      const x: (number | null)[] = []
      const y: (string | null)[] = []
      for (const t of terms) {
        x.push(0, sign * mag(t), null)
        y.push(t.term, t.term, null)
      }
      return {
        type: 'scatter',
        mode: 'lines',
        __oeNoLabel: true,
        x,
        y,
        hoverinfo: 'skip',
        line: { color: hue, width: 1.3 },
        opacity: 0.4
      }
    }

    const dots = (
      terms: EnrichTerm[],
      n: number,
      sign: 1 | -1,
      dir: string,
      scale: [number, string][],
      colorbar: Record<string, unknown> | null
    ): Record<string, unknown> => ({
      type: 'scatter',
      mode: 'markers',
      __oeNoLabel: true,
      // Its ids are the terms' (hover texts), not genes: dim only for a term (see PlotlyChart).
      __oeOwnIds: true,
      x: terms.map((t) => sign * mag(t)),
      y: terms.map((t) => t.term),
      customdata: hover(terms, n, dir),
      hovertemplate: '%{customdata}<extra></extra>',
      // The y range is fixed to the rows; a big dot on the top/bottom row may reach past it.
      cliponaxis: false,
      marker: {
        size: terms.map((t) => t.count),
        sizemode: 'area',
        sizeref: SIZE_REF,
        sizemin: SIZE_MIN,
        color: terms.map((t) => negLog(t.pAdjust)),
        colorscale: scale,
        cmin: 0,
        cmax: maxNegLog,
        line: { width: 0.5, color: p.border },
        ...(colorbar ? { colorbar } : { showscale: false })
      }
    })

    const bars = (
      terms: EnrichTerm[],
      n: number,
      sign: 1 | -1,
      dir: string,
      hue: string
    ): Record<string, unknown> => ({
      type: 'bar',
      orientation: 'h',
      __oeOwnIds: true,
      x: terms.map((t) => sign * mag(t)),
      y: terms.map((t) => t.term),
      customdata: hover(terms, n, dir),
      hovertemplate: '%{customdata}<extra></extra>',
      marker: { color: hue }
    })

    // The right margin (dot style), top to bottom: the dot-size key, then two short colourbars, up
    // (Reds) over down (Blues) — stacked in pixels right under the key when the tile's height is
    // known and they fit, else up from the middle and down at the bottom. A thin outline in the
    // muted text grey at half strength: visible on either theme, lighter than Plotly's dark frame.
    const cbar = (
      label: string,
      y: number,
      anchor: 'top' | 'bottom',
      /** the bar's box (title included) in px; unset = 24% of the plot's height */
      lenPx?: number
    ): Record<string, unknown> => ({
      title: { text: label, side: 'top' },
      thickness: 9,
      ...(lenPx ? { lenmode: 'pixels', len: lenPx } : { len: 0.24 }),
      x: 1.01,
      xanchor: 'left',
      y,
      yanchor: anchor,
      outlinewidth: 0.6,
      outlinecolor: hexA(p.textMuted, 0.5)
    })

    // The dot-size key (dot style): two hit counts (25% / 75% of the largest, below) as circles
    // drawn at the size their dots are —
    // Plotly's area rule, as the markers above (diameter = 2·max(√(v / 2 / sizeref), sizemin)) —
    // stacked down the middle of the right margin under a heading, each labelled with its count.
    // Two levels: 25% and 75% of the largest hit count — the one the dot sizes are scaled to (every
    // term, so filtering doesn't move the key). Rounded OUTWARD — the upper level up, the lower
    // down (never below one step) — to multiples of 10 once the upper level passes 20, of 5 from 5,
    // else whole numbers; a finer step where that would merge the two or lift the upper one past
    // the largest count (no dot could match it), one level only when even whole numbers merge.
    const q1 = maxCount * 0.25
    const q3 = maxCount * 0.75
    const upTo = (v: number, st: number): number => Math.max(st, Math.ceil(v / st) * st)
    const downTo = (v: number, st: number): number => Math.max(st, Math.floor(v / st) * st)
    const keyStep =
      [q3 > 20 ? 10 : 0, q3 >= 5 ? 5 : 0, 1].find(
        (st) =>
          st > 0 && (st === 1 || (upTo(q3, st) !== downTo(q1, st) && upTo(q3, st) <= maxCount))
      ) ?? 1
    const keyCounts = [...new Set([upTo(q3, keyStep), downTo(q1, keyStep)])]
    const KEY_X = 14 // px right of the plot edge to the circles' centre line
    const KEY_GAP = 5
    // First in the right margin: from the plot's top edge, the heading, then the circles.
    const sizeKey = (() => {
      const shapes: Record<string, unknown>[] = []
      const notes: Record<string, unknown>[] = [
        {
          ...note(gsea ? 'lead genes' : 'genes', 1, 1, p.textMuted, 9, 'left'),
          xshift: KEY_X - 10,
          yanchor: 'top'
        }
      ]
      // Top of the next circle, in px from the plot's top edge (screen-up positive, so negative).
      let top = -12 - KEY_GAP
      for (const v of keyCounts) {
        const d = dotPx(v)
        const cy = top - d / 2
        shapes.push({
          type: 'circle',
          xref: 'paper',
          yref: 'paper',
          xsizemode: 'pixel',
          ysizemode: 'pixel',
          xanchor: 1,
          yanchor: 1,
          x0: KEY_X - d / 2,
          x1: KEY_X + d / 2,
          y0: cy - d / 2,
          y1: cy + d / 2,
          line: { color: p.textMuted, width: 0.8 },
          fillcolor: 'rgba(0,0,0,0)'
        })
        notes.push({
          ...note(String(v), 1, 1, p.textMuted, 9, 'left'),
          xshift: KEY_X + 12 + 4,
          yanchor: 'middle',
          yshift: cy
        })
        top -= d + KEY_GAP
      }
      // `bottom`: how far below the plot's top edge the key ends (px).
      return { shapes, notes, bottom: -top }
    })()
    // The colourbars' places: right under the key in pixels when they fit the plot's height.
    const plotH = heightBudget - (LEGEND_GAP + 30 + legendH) - (44 + 14)
    const BAR_BOX = 90
    const BAR_GAP = 6
    const upTop = sizeKey.bottom + 8
    const stackFits = heightBudget > 0 && upTop + 2 * BAR_BOX + BAR_GAP <= plotH
    const upBar = stackFits
      ? cbar('up', 1 - upTop / plotH, 'top', BAR_BOX)
      : cbar('up', 0.52, 'top')
    const downBar = stackFits
      ? cbar('down', 1 - (upTop + BAR_BOX + BAR_GAP) / plotH, 'top', BAR_BOX)
      : cbar('down', 0, 'bottom')

    let data: Record<string, unknown>[]
    if (style === 'bar') {
      data = [
        bars(down, enrich.querySize.down, -1, 'down', downColor),
        bars(up, enrich.querySize.up, 1, 'up', upColor)
      ]
    } else {
      data = [
        stems(down, -1, downColor),
        stems(up, 1, upColor),
        dots(down, enrich.querySize.down, -1, 'down', DOWN_SCALE, down.length ? downBar : null),
        dots(up, enrich.querySize.up, 1, 'up', UP_SCALE, up.length ? upBar : null)
      ]
    }

    // Symmetric x range with absolute-valued ticks (left side isn't shown as negative).
    const M = Math.max(1e-6, ...both.map(mag))
    const step = niceStep(M)
    const kmax = Math.max(1, Math.ceil(M / step))
    const tickvals: number[] = []
    for (let k = -kmax; k <= kmax; k++) tickvals.push(k * step)
    const bound = kmax * step
    const xTitle = style === 'bar' ? '−log p.adj' : gsea ? 'NES' : 'gene ratio'
    const unit = gsea ? 'sets' : 'genes'
    const heading = title ?? ''

    const empty = enrich.up.length === 0 && enrich.down.length === 0
    // Under the tick labels, two rows: the axis title — the measure, with the facet's comparison —
    // centred, then the groups below it: each side's direction and how many query genes / sets it
    // holds, in its colour, at that side's END of the axis (down left-aligned, up right-aligned).
    const AXIS_TITLE_SHIFT = -24
    const ROW = 14
    const titleNote = (
      text: string,
      x: number,
      color: string,
      align: 'left' | 'right' | 'center',
      row: 0 | 1
    ): Record<string, unknown> => ({
      ...note(text, x, 0, color, 11, align),
      yanchor: 'top',
      yshift: AXIS_TITLE_SHIFT - row * ROW
    })
    // The title is cut to the PLOT's width — the tile less the term labels on the left and the
    // right margin — not the tile's: annotations are placed on the plot.
    const TITLE_FONT = '11px system-ui, sans-serif'
    const TICK_FONT = '10px system-ui, sans-serif'
    const labelW =
      Math.max(0, ...order.map((t) => measureText(fitText(t, termBudget, TICK_FONT), TICK_FONT))) +
      (groups.length ? 14 : 0) +
      8
    const plotW = Math.max(120, legendBudget + 40 - 6 - labelW - (style === 'dot' ? 66 : 12))
    const axisLine = [
      titleNote(
        fitText(comparison ? `${xTitle} · ${comparison}` : xTitle, plotW, TITLE_FONT),
        0.5,
        p.textMuted,
        'center',
        0
      ),
      titleNote(`← down · ${enrich.querySize.down} ${unit}`, 0, downColor, 'left', 1),
      titleNote(`up · ${enrich.querySize.up} ${unit} →`, 1, upColor, 'right', 1)
    ]
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: false,
      barmode: 'overlay',
      bargap: 0.35,
      title: heading ? { text: heading, font: { size: 13 } } : undefined,
      margin: {
        l: 6,
        r: style === 'dot' ? 66 : 12,
        t: LEGEND_GAP + 30 + legendH,
        b: 44 + ROW
      },
      shapes: style === 'dot' && !empty ? sizeKey.shapes : [],
      xaxis: {
        ...axisBase(p),
        // The title line is drawn as annotations (see axisLine) so its sides can sit at the axis's
        // ends; Plotly's title is centred only.
        zeroline: true,
        zerolinecolor: p.axis,
        range: [-bound * 1.04, bound * 1.04],
        tickvals,
        ticktext: tickvals.map((v) => fmtAbs(Math.abs(v))),
        showgrid: true
      },
      yaxis: {
        ...axisBase(p),
        type: 'category',
        categoryorder: 'array',
        categoryarray: order,
        // Fixed to the rows: autorange pads for marker size, so a hovered (enlarged) dot on the top
        // or bottom term grew the range and pushed every row. The dots draw past it (cliponaxis).
        range: [-0.6, order.length - 0.4],
        // Each term's label with its group's square (the values stay the term names).
        tickmode: 'array',
        tickvals: order,
        ticktext: order.map((t) => termTick(t)),
        automargin: true,
        tickfont: { size: 10 },
        // No tick marks: the shared axis style's tick colour would turn Plotly's outside ticks on,
        // and they read as stray marks after each term's group square.
        ticks: '',
        // A faint gridline along each term, to track a bar / dot back to its label (as the ridge).
        showgrid: true,
        gridcolor: p.grid,
        gridwidth: 1
      },
      annotations: empty
        ? [note('No enriched terms', 0.5, 0.5, p.textMuted, 12)]
        : [
            ...axisLine,
            ...(style === 'dot' ? sizeKey.notes : []),
            // The groups, from the figure's left edge (the shared container-left alignment, as the
            // ridge's legend).
            ...chips
          ]
    }
    if (empty) {
      lay.xaxis = { ...axisBase(p), visible: false }
      lay.yaxis = { ...axisBase(p), visible: false }
    }
    return {
      data,
      layout: lay,
      labels: [] as PlotLabel[],
      labelColor: p.text,
      // Bold a term's label while its bar / dot is hovered or pinned (their ids are the hover
      // texts), or — where the result names them (GSEA) — one of its genes is.
      boldTicks: empty
        ? undefined
        : {
            genesByTick: order.map((term) => [
              ...(idsByTerm.get(term) ?? []),
              ...both.filter((t) => t.term === term).flatMap((t) => t.geneIds ?? [])
            ]),
            tickLabel: (i: number, active: boolean, anyActive: boolean) =>
              termTick(order[i], active, anyActive)
          }
    }
  }, [
    enrich,
    style,
    title,
    mode,
    legendBudget,
    heightBudget,
    termBudget,
    onlyCats,
    measure,
    comparison,
    upColor,
    downColor,
    noneColor
  ])

  return (
    // Measured (for the legend's wrap width) and otherwise invisible — the chart fills it as before.
    <div ref={boxRef} style={{ width: '100%', height: '100%' }}>
      <PlotlyChart
        data={data}
        layout={layout}
        labels={labels}
        labelColor={labelColor}
        labelsAbove
        boldTicks={boldTicks}
        onAnnotationClick={onAnnotationClick}
        // Its control bar would sit over the category chips (top right); drag-zoom and
        // double-click reset still work without it.
        modeBar={false}
      />
    </div>
  )
}

/** A paper-anchored text annotation. */
function note(
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

/** A "nice" tick step (~4 ticks) for a max magnitude. */
function niceStep(m: number): number {
  const raw = m / 4
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const n = raw / magnitude
  const s = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10
  return s * magnitude
}

/** Format an absolute tick value compactly (trailing zeros trimmed). */
function fmtAbs(v: number): string {
  if (v === 0) return '0'
  return String(+v.toFixed(v < 1 ? 2 : 1))
}

/** Gaussian kernel density of `values` sampled on `grid` (Silverman bandwidth, floored). */
function kde(values: number[], grid: number[]): number[] {
  const n = values.length
  const mean = values.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1))
  let h = 1.06 * sd * Math.pow(n, -1 / 5)
  if (!(h > 0)) h = (Math.max(...values) - Math.min(...values)) / 10 || 0.3
  h = Math.max(h, 1e-3)
  const c = 1 / (n * h * Math.sqrt(2 * Math.PI))
  return grid.map((x) => {
    let s = 0
    for (const v of values) {
      const z = (x - v) / h
      s += Math.exp(-0.5 * z * z)
    }
    return c * s
  })
}

/** Median of a numeric array (does not mutate). */
function med(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** `#rrggbb` → `rgba(r,g,b,a)`. */
function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
