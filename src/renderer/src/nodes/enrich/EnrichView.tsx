import { useCallback, useContext, useMemo, useState } from 'react'

import { GridPitchContext } from '../../dashboard/gridPitch'
import { useElementSize } from '../../dashboard/useElementSize'

import type { EnrichData, EnrichTerm } from '../../engine'
import { measureText } from '../../ui/legendChips'
import { tooltip } from '../../ui/condTooltip'
import { PlotlyChart, type PlotLabel } from '../../ui/PlotlyChart'
import { effectHalves } from '../../ui/palettes'
import { PlotAxesContext } from '../../ui/plotAxes'
import {
  axisBase,
  CATEGORICAL,
  EFFECT_COLOR,
  PALETTES,
  PLOT_TEXT,
  plotFontCss
} from '../../ui/theme'
import { useUiTheme } from '../../ui/useUiTheme'
import type { EffectColors } from '../../graph/types'
import {
  axisTitle,
  categoryLegend,
  CHIP,
  emptyLayout,
  frame,
  hexA,
  labelTextBudget,
  minFigureWidth,
  LEGEND_INSET,
  MARGIN_BOTTOM,
  margins,
  note,
  PLAIN_RIGHT,
  termAxis,
  termGroups,
  termLabels
} from './chrome'
import { groupIndexer } from './groupOrder'

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
  comparison,
  groupOrder = [],
  categorical = CATEGORICAL,
  termOrder = 'significance'
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
  /** every term group the source has in the dataset, in its fixed order (groupOrder.ts): a group's
   *  colour is its place here, so it's the same in every enrichment plot */
  groupOrder?: readonly string[]
  /** the term groups' palette (the plot's own, else the global one); unset = the global one */
  categorical?: readonly string[]
  /** stack the terms by significance alone, or by category first (in the fixed order), then by
   *  significance within each */
  termOrder?: 'significance' | 'category'
}) {
  const mode = useUiTheme((s) => s.mode)
  // A term group's colour: its place in the source's fixed order, the same in every plot.
  const groupIndex = useMemo(() => groupIndexer(groupOrder), [groupOrder])
  // The groups a plot has, in that fixed order (any the order lacks after, as they came).
  const inGroupOrder = useCallback(
    (seen: string[]): string[] =>
      seen
        .map((c, i) => [c, groupIndex(c, i)] as const)
        .sort((a, b) => a[1] - b[1])
        .map(([c]) => c),
    [groupIndex]
  )
  const byCategory = termOrder === 'category'
  // A term's category's place in the fixed order (no category: after every one), for stacking by
  // category — the first at the top.
  const catRank = useCallback(
    (c: string | undefined): number => (c ? groupIndex(c, groupOrder.length) : Infinity),
    [groupIndex, groupOrder]
  )
  const upColor = effectColors?.up ?? EFFECT_COLOR.up
  const downColor = effectColors?.down ?? EFFECT_COLOR.down
  const noneColor = effectColors?.none ?? EFFECT_COLOR.none
  // The tile's width, so the group legend wraps to what fits instead of running off the edge (it
  // stays in the plot — not HTML beside it — so copies and downloads carry it).
  const { ref: boxRef, width: boxW, height: boxH } = useElementSize<HTMLDivElement>()
  // The tile's height, in 10px steps (0 = not measured yet) — to stack the dot plot's right-margin
  // keys in pixels under one another.
  const heightBudget = boxH > 0 ? Math.floor(boxH / 10) * 10 : 0
  // Room for the legend: the figure's width less its inset (chrome.ts); a fallback before
  // measuring. In 10px steps, so dragging a tile's edge rebuilds the figure only when the wrap
  // could change.
  const legendBudget = boxW > 0 ? Math.max(160, Math.floor((boxW - LEGEND_INSET) / 10) * 10) : 520
  // The figure's width for the labels / plot split (chrome.ts labelTextBudget), stepped with the
  // Results grid's columns — so a resize re-cuts the labels only as the tile passes a column, as
  // it will snap to (10px steps outside the grid).
  const pitch = useContext(GridPitchContext) || 10
  const figW = boxW > 0 ? Math.floor(boxW / pitch) * pitch : 0
  // Term groups to show — click a legend chip to show only its terms, click more to add them, click
  // a chosen one again to drop it; none chosen = every term. View state, not saved with the tile.
  const [onlyCats, setOnlyCats] = useState<string[]>([])
  const onAnnotationClick = (name: string): void => {
    if (!name.startsWith(CHIP)) return
    const c = name.slice(CHIP.length)
    setOnlyCats((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))
  }

  // The tile's legend switched off: no group chips and no size key (PlotlyChart drops the colour
  // bar) — and so no group filter either.
  const legendOff = useContext(PlotAxesContext)?.legend === false

  const { data, layout, labels, labelColor, boldTicks, genesById, minWidth } = useMemo(() => {
    // The dots' significance ramps (faint → strong): each side's own colour, from a pale tint of it
    // to the colour its stems, bars and axis note draw in.
    const halves = effectHalves({ up: upColor, down: downColor })
    const p = PALETTES[mode]
    const gsea = enrich.method === 'gsea'
    // The groups, legend, labels, axes and margins: chrome.ts, the same for every style.
    const groupOpts = { onlyCats, legendOff, categorical, groupIndex, inGroupOrder }
    const nothing = {
      data: [] as Record<string, unknown>[],
      layout: emptyLayout(p),
      labels: [] as PlotLabel[],
      labelColor: p.text,
      boldTicks: undefined,
      genesById: null as Map<string, string[]> | null,
      minWidth: 0
    }

    // ── ridgeline (GSEA only): each set's member-log₂FC distribution as a stacked density ridge,
    //    on the real log₂FC axis, so up sets sit right of 0 and down sets left. ──────────────────
    if (style === 'ridge' && gsea) {
      const terms = [...enrich.up, ...enrich.down].filter((t) => (t.dist?.length ?? 0) > 0)
      if (terms.length === 0) return nothing
      // Ascending NES → index 0 (bottom) is the most down-regulated set, top the most up.
      terms.sort((a, b) => (a.nes ?? 0) - (b.nes ?? 0))
      // Every group present; only the chosen groups' sets drawn.
      const g = termGroups(terms, groupOpts)
      const L = termLabels(g, labelTextBudget(figW, PLAIN_RIGHT), p)
      const chosen = terms.filter(g.keep)
      // By category first: the categories top → bottom in the fixed order, each's sets by NES
      // (most up at the top) — index 0 is the bottom, so the last category comes first.
      const shown = byCategory
        ? [...chosen].sort(
            (a, b) => catRank(b.category) - catRank(a.category) || (a.nes ?? 0) - (b.nes ?? 0)
          )
        : chosen
      // Build the row list, slotting the global (all-genes) reference ridge at the NES≈0 midline —
      // between the down sets (below) and the up sets (above); stacked by category there's no
      // midline, so at the bottom.
      interface Row {
        label: string
        dist: number[]
        hue: string
        ref: boolean
        /** the term's own id (`term:` + its name — apart from any gene's): hovering its ridge or
         *  label focuses it, a click selects its genes. Null for the reference row. */
        id: string | null
        hover: string
        /** leading-edge genes to mark along the baseline (empty for the reference row); `ids` are
         *  the uniqIDs (for cross-view hover linking), aligned to names/x. */
        lead: { x: number[]; names: string[]; ids: string[] }
        /** KEGG top-level category (undefined for GO source / the reference row) */
        category?: string
      }
      const setLabel = (t: EnrichTerm): string => L.fit(`${t.term} (${t.setSize})`)
      const rows: Row[] = shown.map((t) => ({
        label: setLabel(t),
        dist: t.dist as number[],
        hue: (t.nes ?? 0) >= 0 ? upColor : downColor,
        ref: false,
        id: `term:${t.term}`,
        hover: tooltip(
          {
            title: t.term,
            values: [
              ['NES', (t.nes ?? 0).toFixed(2)],
              ['p.adj', t.pAdjust.toExponential(2)],
              ['set', t.setSize],
              [`median ${measure}`, med(t.dist as number[]).toFixed(2)]
            ]
          },
          p.textMuted
        ),
        lead: { x: t.leadingDist ?? [], names: t.genes, ids: t.geneIds ?? t.genes },
        category: t.category
      }))
      const globalDist = enrich.ranked && enrich.ranked.length > 1 ? enrich.ranked : null
      if (globalDist) {
        const nDown = byCategory ? 0 : shown.filter((t) => (t.nes ?? 0) < 0).length
        rows.splice(nDown, 0, {
          label: L.fit(`all genes (${globalDist.length})`),
          dist: globalDist,
          hue: noneColor,
          ref: true,
          id: null,
          hover: tooltip(
            {
              title: 'all genes',
              conds: [['set', 'reference']],
              values: [
                ['genes', globalDist.length],
                [`median ${measure}`, med(globalDist).toFixed(2)]
              ]
            },
            p.textMuted
          ),
          lead: { x: [], names: [], ids: [] }
        })
      }

      // The x range over EVERY set (and the reference), not just the chosen groups' — so choosing a
      // group never rescales or moves the axis.
      let lo = Infinity
      let hi = -Infinity
      for (const dist of [
        ...terms.map((t) => t.dist as number[]),
        ...(globalDist ? [globalDist] : [])
      ])
        for (const v of dist) {
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
      // The top of the drawn ridges: each one's own peak above its baseline (the tallest any could
      // reach, overlap, is the highest density of all — usually not the top row's, which left an
      // empty band over the plot up to it).
      const ridgeTop = Math.max(
        ...dens.map((d, r) => r * step + (Math.max(0, ...d) / maxD) * overlap * step)
      )
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
          // Hovered as a whole, with no tooltip of its own (a fill's floats off its shape): it
          // focuses its term — the other ridges fade, its label bolds, its genes light — and a
          // click selects those genes. Its id on every point, for the focus layer (__oeOwnIds).
          ...(row.id
            ? {
                hoveron: 'fills',
                hoverinfo: 'none',
                __oeOwnIds: true,
                __oeId: row.id,
                customdata: grid.map(() => row.id).concat(grid.map(() => row.id))
              }
            : { hoverinfo: 'skip' })
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
          hovertemplate: tooltip(
            { title: '%{text}', values: [['log₂FC', '%{x:.2f}']] },
            p.textMuted,
            { template: true }
          ),
          marker: { size: 5, color: row.hue, line: { width: 0.5, color: p.bg }, opacity: 0.95 }
        })
        // Leading-edge genes are shown as dots only (names appear on hover); no baseline labels.
      })
      const legend = categoryLegend(g, legendOff, legendBudget, p)
      const tickLabel = (i: number, active: boolean, anyActive: boolean): string =>
        L.tick(rows[i].label, rows[i].category, active, anyActive)
      // The left margin over every set (not only the chosen groups'), so choosing one keeps the
      // plot in place; the reference's label too.
      const margin = margins(
        L.marginLeft([
          ...terms.map((t) => ({ fitted: setLabel(t), category: t.category })),
          ...(globalDist ? [{ fitted: L.fit(`all genes (${globalDist.length})`) }] : [])
        ]),
        legend
      )
      const lay: Record<string, unknown> = {
        ...frame(p, title),
        margin,
        annotations: [
          // the measure and the comparison it's of ("interaction log₂FC · KO|WT × Amk|H2O"); the
          // measure alone when the facet holds several comparisons
          axisTitle(comparison ? `${measure} · ${comparison}` : measure, legendBudget, margin, p),
          ...legend.annotations
        ],
        xaxis: {
          ...axisBase(p),
          zeroline: true,
          zerolinecolor: p.axis,
          showgrid: true,
          // Fixed to the ridges' padded span: autorange pads for marker size, so a hovered (enlarged)
          // gene dot at the far left/right — the top or bottom of the ranking — widened the range and
          // nudged the whole plot.
          range: [lo, hi]
        },
        yaxis: termAxis(p, {
          tickvals: rows.map((_, r) => r * step),
          ticktext: rows.map((_, i) => tickLabel(i, false, false)),
          // up to the highest ridge, with the top row's label clear of the edge
          range: [-0.6, Math.max((rows.length - 1) * step + 0.6, ridgeTop + 0.15)]
        })
      }
      // Bold a pathway's label (and its category legend entry) when a hovered/pinned gene is one of
      // its leading-edge genes.
      const boldTicks = {
        // bold while one of its genes is active, or the term itself (its ridge or label hovered)
        // a term's label bolds with the term itself — hovered, or selected (all its genes are) —
        // not with any one of its genes, which many terms share
        genesByTick: rows.map((r) => (r.id ? [r.id] : [])),
        tickLabel,
        categoryByTick: rows.map((r) => r.category),
        legendItemText: legend.itemText,
        // a label hovers / selects its term, as its ridge does
        idByTick: rows.map((r) => r.id)
      }
      // A ridge's (or label's) term id → its genes, which a click selects; a gene dot pins itself.
      const genesById = new Map<string, string[]>()
      for (const r of rows) if (r.id) genesById.set(r.id, r.lead.ids)
      return {
        data,
        layout: lay,
        labels,
        labelColor: p.text,
        boldTicks,
        genesById,
        minWidth: minFigureWidth(PLAIN_RIGHT)
      }
    }

    const negLog = (v: number): number => -Math.log10(Math.max(v, 1e-300))
    // Magnitude a term extends from centre. Bar: −log₁₀ FDR. Dot: gene ratio (ORA) or |NES| (GSEA).
    const mag = (t: EnrichTerm): number =>
      style === 'bar' ? negLog(t.pAdjust) : gsea ? Math.abs(t.nes ?? 0) : t.geneRatio
    const geneList = (g: string[]): string =>
      g.length <= 10 ? g.join(', ') : `${g.slice(0, 10).join(', ')} +${g.length - 10} more`
    const hover = (terms: EnrichTerm[], n: number, dir: string): string[] =>
      terms.map(
        (t) =>
          tooltip(
            {
              title: t.term,
              conds: [['direction', dir]],
              values: gsea
                ? [
                    ['NES', (t.nes ?? 0).toFixed(2)],
                    ['p.adj', t.pAdjust.toExponential(2)],
                    ['leading edge', `${t.count}/${t.setSize}`]
                  ]
                : [
                    ['genes', `${t.count}/${n}`],
                    ['gene ratio', t.geneRatio.toFixed(3)],
                    ['in set', t.setSize],
                    ['fold', t.fold.toFixed(2)],
                    ['p.adj', t.pAdjust.toExponential(2)]
                  ]
            },
            p.textMuted
          ) + `<br>${geneList(t.genes)}`
      )

    // Shared y order: union of both directions' terms, most significant at TOP. A category axis
    // stacks index 0 at the bottom, so sort ascending by best −log₁₀ FDR (least significant first).
    // By category first: the categories top → bottom in the fixed order (the last one first, at
    // the bottom), each's terms by significance.
    const yOrder = (terms: EnrichTerm[]): string[] => {
      const best = new Map<string, number>()
      const rank = new Map<string, number>()
      for (const t of terms) {
        best.set(t.term, Math.max(best.get(t.term) ?? 0, negLog(t.pAdjust)))
        if (!rank.has(t.term) || t.category) rank.set(t.term, catRank(t.category))
      }
      return [...best.entries()]
        .sort((a, b) => (byCategory ? rank.get(b[0])! - rank.get(a[0])! : 0) || a[1] - b[1])
        .map((e) => e[0])
    }

    // Term group (a KEGG pathway's category, a Reactome term's top-level pathway, a COG/KOG
    // category's area): its square by each term's label, and the groups present listed above.
    const all = [...enrich.up, ...enrich.down]
    if (all.length === 0) return nothing
    const catOf = new Map<string, string>()
    for (const t of all) if (t.category && !catOf.has(t.term)) catOf.set(t.term, t.category)
    const g = termGroups(all, groupOpts)
    const keep = g.keep
    const up = enrich.up.filter(keep)
    const down = enrich.down.filter(keep)
    const both = [...up, ...down]
    const order = yOrder(both)
    // Each term's highlight ids: its bar's / dot's hover text (what it sets as the hover).
    const idsByTerm = new Map<string, string[]>()
    // A dot's / bar's id (its hover text) → its term's genes, which a click on it selects.
    const genesById = new Map<string, string[]>()
    for (const [terms, n, dir] of [
      [up, enrich.querySize.up, 'up'],
      [down, enrich.querySize.down, 'down']
    ] as const)
      hover(terms, n, dir).forEach((id, k) => {
        const term = terms[k].term
        idsByTerm.set(term, [...(idsByTerm.get(term) ?? []), id])
        genesById.set(id, terms[k].geneIds ?? [])
      })
    const legend = categoryLegend(g, legendOff, legendBudget, p)

    // Size and colour scales over EVERY term, so filtering to a group doesn't re-scale them.
    const maxCount = Math.max(1, ...all.map((t) => t.count))
    // Dot size: area ∝ hit count, the largest 24px across, none under 10px (sizemin is a radius).
    const SIZE_REF = (2 * maxCount) / 24 ** 2
    const SIZE_MIN = 5
    /** The diameter Plotly draws a count at — its area rule (see renderedSize in PlotlyChart). */
    const dotPx = (v: number): number => 2 * Math.max(Math.sqrt(v / 2 / SIZE_REF), SIZE_MIN)
    // At least to the 0.05 significance level: with nothing significant, a scale fitted to the
    // terms alone would stretch a negligible difference (p.adj 0.97 vs 1) over the whole ramp.
    const maxNegLog = Math.max(-Math.log10(0.05), ...all.map((t) => negLog(t.pAdjust)))

    // Lollipop stems: a thin line from centre (x=0) to each dot, so a dot tracks back to its term.
    // One trace per stem, carrying its dot's id (its hover text — an own id, as the dot's), so a
    // stem fades and stays with its dot when a term is hovered or selected. Its faintness is in its
    // colour, so the fade (a trace opacity) dims it further rather than resetting it.
    const stems = (
      terms: EnrichTerm[],
      n: number,
      sign: 1 | -1,
      dir: string,
      hue: string
    ): Record<string, unknown>[] => {
      const ids = hover(terms, n, dir)
      return terms.map((t, k) => ({
        type: 'scatter',
        mode: 'lines',
        __oeNoLabel: true,
        __oeOwnIds: true,
        x: [0, sign * mag(t)],
        y: [t.term, t.term],
        customdata: [ids[k], ids[k]],
        hoverinfo: 'skip',
        showlegend: false,
        line: { color: hexA(hue, 0.4), width: 1.3 }
      }))
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

    // The right margin (dot style), top to bottom, as fractions of the plot's height: the dot-size
    // key (0.2), a 0.04 gap, the up colourbar (Reds, 0.3), a 0.1 gap, the down colourbar (Blues,
    // 0.3), the rest free below — so the bars scale with the tile and the three never overlap.
    // The key's band is mostly empty under its circles, so its gap is the smaller one. A thin outline in the
    // muted text grey at half strength: visible on either theme, lighter than Plotly's dark frame.
    const KEY_BAND = 0.2
    const BAR_LEN = 0.3
    const BAND_GAP = 0.1
    const KEY_GAP_BAND = 0.04
    // The legend's text matches the x axis: its headings (genes, up, down) the axis title's size,
    // its numbers (key counts, colourbar ticks) the axis tick labels'.
    const AXIS_TITLE_FS = PLOT_TEXT.axisTitle // the axis title line (titleNote)
    const AXIS_TICK_FS = PLOT_TEXT.tick // the x tick labels: the layout font (plotBase)
    const cbar = (label: string, top: number): Record<string, unknown> => ({
      title: { text: label, side: 'top', font: { size: AXIS_TITLE_FS } },
      tickfont: { size: AXIS_TICK_FS },
      thickness: 9,
      // the bar's box (title included) exactly its band: no padding at either end
      lenmode: 'fraction',
      len: BAR_LEN,
      ypad: 0,
      x: 1.01,
      xanchor: 'left',
      y: top,
      yanchor: 'top',
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
    const KEY_X = 14 // px right of the plot edge to the circles' centre line
    const KEY_GAP = 5
    const KEY_HEAD = 13 // the heading's line
    const KEY_HEADING = gsea ? 'lead genes' : 'genes'
    // A key row: its circle, or its count label's line when the circle is smaller than the text.
    const keyRow = (v: number): number => Math.max(dotPx(v), AXIS_TICK_FS + 2)
    // The plot's height in px (0 before the tile is measured), for fitting the key to its band.
    const plotH = heightBudget - legend.top - MARGIN_BOTTOM
    // The key's two levels — or only the lower one when both circles (at their true dot size)
    // wouldn't fit the key's band.
    const twoCounts = [...new Set([upTo(q3, keyStep), downTo(q1, keyStep)])]
    const keyH = (cs: number[]): number =>
      KEY_HEAD + cs.reduce((h, v) => h + KEY_GAP + keyRow(v), 0)
    const keyCounts =
      twoCounts.length > 1 && plotH > 0 && keyH(twoCounts) > KEY_BAND * plotH
        ? twoCounts.slice(1)
        : twoCounts
    // First in the right margin: from the plot's top edge, the heading, then the circles.
    const sizeKey = (() => {
      const shapes: Record<string, unknown>[] = []
      const notes: Record<string, unknown>[] = [
        {
          ...note(KEY_HEADING, 1, 1, p.textMuted, AXIS_TITLE_FS, 'left'),
          xshift: KEY_X - 10,
          yanchor: 'top'
        }
      ]
      // Top of the next circle, in px from the plot's top edge (screen-up positive, so negative).
      let top = -KEY_HEAD - KEY_GAP
      for (const v of keyCounts) {
        const d = dotPx(v)
        const cy = top - keyRow(v) / 2
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
          ...note(String(v), 1, 1, p.textMuted, AXIS_TICK_FS, 'left'),
          xshift: KEY_X + 12 + 4,
          yanchor: 'middle',
          yshift: cy
        })
        top -= keyRow(v) + KEY_GAP
      }
      return { shapes, notes }
    })()
    // The colourbars' bands, under the key's.
    const upBar = cbar('up', 1 - KEY_BAND - KEY_GAP_BAND)
    const downBar = cbar('down', 1 - KEY_BAND - KEY_GAP_BAND - BAR_LEN - BAND_GAP)

    let data: Record<string, unknown>[]
    if (style === 'bar') {
      data = [
        bars(down, enrich.querySize.down, -1, 'down', downColor),
        bars(up, enrich.querySize.up, 1, 'up', upColor)
      ]
    } else {
      data = [
        ...stems(down, enrich.querySize.down, -1, 'down', downColor),
        ...stems(up, enrich.querySize.up, 1, 'up', upColor),
        dots(down, enrich.querySize.down, -1, 'down', halves.down, down.length ? downBar : null),
        dots(up, enrich.querySize.up, 1, 'up', halves.up, up.length ? upBar : null)
      ]
    }

    // Symmetric x range with absolute-valued ticks (left side isn't shown as negative) — over EVERY
    // term, not just the chosen groups', so choosing a group never rescales the axis.
    const M = Math.max(1e-6, ...all.map(mag))
    const step = niceStep(M)
    const kmax = Math.max(1, Math.ceil(M / step))
    const tickvals: number[] = []
    for (let k = -kmax; k <= kmax; k++) tickvals.push(k * step)
    const bound = kmax * step
    const xTitle = style === 'bar' ? '−log p.adj' : gsea ? 'NES' : 'gene ratio'
    // The right margin: the dot style's key and colourbars, wide enough for the key's heading
    // ("lead genes" overran a fixed 66px) and its counts, as measured.
    const TITLE_FONT = `${PLOT_TEXT.axisTitle}px ${plotFontCss()}`
    const TICK_FONT = `${PLOT_TEXT.tick}px ${plotFontCss()}`
    const keyed = style === 'dot' && !legendOff
    const marginR = keyed
      ? Math.ceil(
          Math.max(
            66,
            KEY_X - 10 + measureText(KEY_HEADING, TITLE_FONT) + 6,
            KEY_X + 16 + Math.max(0, ...keyCounts.map((v) => measureText(String(v), TICK_FONT))) + 6
          )
        )
      : PLAIN_RIGHT
    // The labels get what the plot can spare, past the right margin (chrome.ts labelTextBudget).
    const L = termLabels(g, labelTextBudget(figW, marginR), p)
    // A term's tick in its hover state. The category values (tickvals) stay the full term names.
    const termTick = (term: string, active = false, anyActive = false): string =>
      L.tick(L.fit(term), catOf.get(term), active, anyActive)
    // The left margin over every term (not only the chosen groups'), so choosing one keeps the
    // plot in place.
    const margin = margins(
      L.marginLeft(yOrder(all).map((t) => ({ fitted: L.fit(t), category: catOf.get(t) }))),
      legend,
      marginR
    )
    const lay: Record<string, unknown> = {
      ...frame(p, title),
      barmode: 'overlay',
      bargap: 0.35,
      margin,
      shapes: keyed ? sizeKey.shapes : [],
      xaxis: {
        ...axisBase(p),
        zeroline: true,
        zerolinecolor: p.axis,
        range: [-bound * 1.04, bound * 1.04],
        tickvals,
        ticktext: tickvals.map((v) => fmtAbs(Math.abs(v))),
        showgrid: true
      },
      yaxis: {
        ...termAxis(p, {
          tickvals: order,
          ticktext: order.map((t) => termTick(t)),
          // Fixed to the rows: a hovered (enlarged) dot on the top or bottom term grew an autorange
          // and pushed every row. The dots draw past it (cliponaxis).
          range: [-0.6, order.length - 0.4]
        }),
        type: 'category',
        categoryorder: 'array',
        categoryarray: order
      },
      annotations: [
        axisTitle(comparison ? `${xTitle} · ${comparison}` : xTitle, legendBudget, margin, p),
        ...(keyed ? sizeKey.notes : []),
        ...legend.annotations
      ]
    }
    return {
      data,
      layout: lay,
      labels: [] as PlotLabel[],
      labelColor: p.text,
      // Bold a term's label while its bar / dot is hovered or pinned (their ids are the hover
      // texts), or — where the result names them (GSEA) — one of its genes is.
      boldTicks: {
        // the term itself, hovered or selected (all its genes are) — not any one of its genes,
        // which many terms share
        genesByTick: order.map((term) => idsByTerm.get(term) ?? []),
        tickLabel: (i: number, active: boolean, anyActive: boolean) =>
          termTick(order[i], active, anyActive),
        // its group's chip bolds with it, as the ridge's
        categoryByTick: order.map((term) => catOf.get(term)),
        legendItemText: legend.itemText,
        // a label hovers / selects its term, as its dot or bar does (a term on both sides
        // answers as its first)
        idByTick: order.map((term) => idsByTerm.get(term)?.[0] ?? null)
      },
      genesById,
      minWidth: minFigureWidth(marginR)
    }
  }, [
    enrich,
    style,
    title,
    mode,
    legendBudget,
    heightBudget,
    figW,
    onlyCats,
    legendOff,
    measure,
    comparison,
    upColor,
    downColor,
    noneColor,
    groupIndex,
    inGroupOrder,
    categorical,
    byCategory,
    catRank
  ])

  const pinIdsOf = useCallback((id: string) => genesById?.get(id) ?? null, [genesById])

  return (
    // Measured (for the legend's wrap width) and otherwise invisible — the chart fills it as before.
    // Never narrower than the labels' and the plot's minimums: a narrower tile scrolls sideways
    // (its body already does) rather than squeezing the plot to nothing.
    <div ref={boxRef} style={{ width: '100%', height: '100%', minWidth }}>
      <PlotlyChart
        data={data}
        layout={layout}
        labels={labels}
        labelColor={labelColor}
        labelsAbove
        boldTicks={boldTicks}
        // its own note when nothing is enriched (chrome.ts emptyLayout)
        emptyNote={false}
        onAnnotationClick={onAnnotationClick}
        // a click on a term's dot or bar selects its genes, in every plot
        pinIdsOf={pinIdsOf}
        // Its control bar would sit over the category chips (top right); drag-zoom and
        // double-click reset still work without it.
        modeBar={false}
      />
    </div>
  )
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
