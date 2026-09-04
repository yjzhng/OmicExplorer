import { useMemo } from 'react'

import type { EnrichData, EnrichTerm } from '../engine'
import { PlotlyChart, type PlotLabel } from './PlotlyChart'
import { axisBase, CATEGORICAL, EFFECT_COLOR, plotBase, PALETTES } from './theme'
import { useUiTheme } from './useUiTheme'

/** Pixel width of `text` at `font` (e.g. 'bold 10px sans-serif'), via a memoised offscreen canvas —
 *  so legend slot widths match the rendered text instead of a char-count estimate. */
let measureCtx: CanvasRenderingContext2D | null = null
function measureText(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * 6 // fallback if 2D context is unavailable
  measureCtx.font = font
  return measureCtx.measureText(text).width
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
 *  lollipop (stem from centre to the dot, so each dot tracks back to its term) with size = hit
 *  count and colour = −log₁₀ FDR on a Reds (up) / Blues (down) ramp. A term enriched in both
 *  directions shows a marker on each side. Ticks read as absolute magnitudes; top = most significant. */
export function EnrichView({
  enrich,
  style = 'dot',
  title
}: {
  enrich: EnrichData
  style?: 'dot' | 'bar' | 'ridge'
  title?: string
}) {
  const mode = useUiTheme((s) => s.mode)

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
      const rows: Row[] = terms.map((t) => ({
        label: `${t.term} (${t.setSize})`,
        dist: t.dist as number[],
        hue: (t.nes ?? 0) >= 0 ? EFFECT_COLOR.up : EFFECT_COLOR.down,
        ref: false,
        hover:
          `<b>${t.term}</b><br>NES ${(t.nes ?? 0).toFixed(2)} • ` +
          `p.adj ${t.pAdjust.toExponential(2)}<br>set ${t.setSize} • ` +
          `median log₂FC ${med(t.dist as number[]).toFixed(2)}`,
        lead: { x: t.leadingDist ?? [], names: t.genes, ids: t.geneIds ?? t.genes },
        category: t.category
      }))
      const globalDist = enrich.ranked && enrich.ranked.length > 1 ? enrich.ranked : null
      if (globalDist) {
        const nDown = terms.filter((t) => (t.nes ?? 0) < 0).length
        rows.splice(nDown, 0, {
          label: `all genes (${globalDist.length})`,
          dist: globalDist,
          hue: EFFECT_COLOR.none,
          ref: true,
          hover:
            `<b>all genes</b> (reference)<br>${globalDist.length} genes • ` +
            `median log₂FC ${med(globalDist).toFixed(2)}`,
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
      // KEGG category → colour (stable order = first appearance, top→bottom). Colour each pathway's
      // y-tick label by its category and show a centred legend above (only categories present).
      const cats: string[] = []
      for (const row of rows) if (row.category && !cats.includes(row.category)) cats.push(row.category)
      const catColor = new Map(cats.map((c, i) => [c, CATEGORICAL[i % CATEGORICAL.length]]))
      // y-tick label for a pathway given its hover state: active → bold in its (category or default)
      // colour; when another pathway is active this one FADES (low-opacity of its own colour, like the
      // STRING legend); otherwise its plain colour.
      const tickLabel = (i: number, active: boolean, anyActive: boolean): string => {
        const row = rows[i]
        const base = row.category ? (catColor.get(row.category) ?? p.text) : p.text
        const col = anyActive && !active ? hexA(base, 0.3) : base
        const inner = active ? `<b>${row.label}</b>` : row.label
        return `<span style="color:${col}">${inner}</span>`
      }
      const ticktext = rows.map((_, i) => tickLabel(i, false, false))
      // One annotation PER category, at a FIXED pixel offset (xshift) from the figure's left edge, so
      // bolding one entry on hover can't shift the others. Each slot is sized for the BOLD width + a
      // padding gap, so a bolded entry grows within its own slot instead of into the next.
      const LEGEND_FS = 10
      const LEGEND_PAD = 12 // px gap between items
      // Legend item text per hover state: active → bold + full colour; muted (something else active)
      // → grey; otherwise full colour. Measured at BOLD width so slots don't overflow.
      const legendItemText = (c: string, active: boolean, anyActive: boolean): string => {
        const base = catColor.get(c) ?? p.text
        const col = anyActive && !active ? hexA(base, 0.3) : base
        return `<span style="color:${col}">■ ${active ? `<b>${c}</b>` : c}</span>`
      }
      let legendX = 0
      const legend = cats.map((c) => {
        const ann = {
          // Align each item's left edge to the figure's left edge (the pathway-label margin) via the
          // shared container-left recompute in PlotlyChart; __oeLegendCat tags it for hover re-texting.
          __oeAlignContainerLeft: true,
          __oeLegendCat: c,
          x: 0,
          xref: 'paper',
          xanchor: 'left',
          xshift: legendX,
          y: 1.0,
          yref: 'paper',
          yanchor: 'bottom',
          showarrow: false,
          text: legendItemText(c, false, false),
          font: { size: LEGEND_FS },
          captureevents: false
        }
        legendX += Math.ceil(measureText(`■ ${c}`, `bold ${LEGEND_FS}px sans-serif`)) + LEGEND_PAD
        return ann
      })
      const lay: Record<string, unknown> = {
        ...plotBase(p),
        showlegend: false,
        title: title ? { text: title, font: { size: 13 } } : undefined,
        margin: { l: 6, r: 12, t: cats.length ? 40 : 24, b: 40 },
        annotations: legend,
        xaxis: {
          ...axisBase(p),
          title: { text: 'log₂FC', font: { size: 11 } },
          zeroline: true,
          zerolinecolor: p.axis,
          showgrid: true
        },
        yaxis: {
          ...axisBase(p),
          tickmode: 'array',
          tickvals: rows.map((_, r) => r * step),
          ticktext,
          automargin: true,
          tickfont: { size: 10 },
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
    const both = [...enrich.up, ...enrich.down]
    const best = new Map<string, number>()
    for (const t of both) best.set(t.term, Math.max(best.get(t.term) ?? 0, negLog(t.pAdjust)))
    const order = [...best.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0])

    const maxCount = Math.max(1, ...both.map((t) => t.count))
    const maxNegLog = Math.max(1e-6, ...both.map((t) => negLog(t.pAdjust)))

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
      x: terms.map((t) => sign * mag(t)),
      y: terms.map((t) => t.term),
      customdata: hover(terms, n, dir),
      hovertemplate: '%{customdata}<extra></extra>',
      marker: {
        size: terms.map((t) => t.count),
        sizemode: 'area',
        sizeref: (2 * maxCount) / 24 ** 2,
        sizemin: 5,
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
      x: terms.map((t) => sign * mag(t)),
      y: terms.map((t) => t.term),
      customdata: hover(terms, n, dir),
      hovertemplate: '%{customdata}<extra></extra>',
      marker: { color: hue }
    })

    // Two short colourbars stacked on the right (dot style): up (Reds) over down (Blues).
    const cbar = (label: string, y: number, anchor: 'top' | 'bottom'): Record<string, unknown> => ({
      title: { text: label, side: 'top' },
      thickness: 9,
      len: 0.46,
      x: 1.01,
      xanchor: 'left',
      y,
      yanchor: anchor
    })

    let data: Record<string, unknown>[]
    if (style === 'bar') {
      data = [
        bars(enrich.down, enrich.querySize.down, -1, 'down', EFFECT_COLOR.down),
        bars(enrich.up, enrich.querySize.up, 1, 'up', EFFECT_COLOR.up)
      ]
    } else {
      data = [
        stems(enrich.down, -1, EFFECT_COLOR.down),
        stems(enrich.up, 1, EFFECT_COLOR.up),
        dots(
          enrich.down,
          enrich.querySize.down,
          -1,
          'down',
          DOWN_SCALE,
          enrich.down.length ? cbar('down', 0, 'bottom') : null
        ),
        dots(
          enrich.up,
          enrich.querySize.up,
          1,
          'up',
          UP_SCALE,
          enrich.up.length ? cbar('up', 1, 'top') : null
        )
      ]
    }

    // Symmetric x range with absolute-valued ticks (left side isn't shown as negative).
    const M = Math.max(1e-6, ...both.map(mag))
    const step = niceStep(M)
    const kmax = Math.max(1, Math.ceil(M / step))
    const tickvals: number[] = []
    for (let k = -kmax; k <= kmax; k++) tickvals.push(k * step)
    const bound = kmax * step
    const xTitle = style === 'bar' ? '−log₁₀ p.adj' : gsea ? 'NES' : 'gene ratio'
    const unit = gsea ? 'sets' : 'genes'
    const heading = title ?? ''

    const empty = enrich.up.length === 0 && enrich.down.length === 0
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: false,
      barmode: 'overlay',
      bargap: 0.35,
      title: heading ? { text: heading, font: { size: 13 } } : undefined,
      margin: { l: 6, r: style === 'dot' ? 66 : 12, t: 44, b: 44 },
      xaxis: {
        ...axisBase(p),
        title: { text: `← down    ${xTitle}    up →`, font: { size: 11 } },
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
        automargin: true,
        tickfont: { size: 10 }
      },
      annotations: empty
        ? [note('No enriched terms', 0.5, 0.5, p.textMuted, 12)]
        : [
            note(`up ▸ ${enrich.querySize.up} ${unit}`, 0.99, 1.05, EFFECT_COLOR.up, 11, 'right'),
            note(`◂ down ${enrich.querySize.down} ${unit}`, 0.01, 1.05, EFFECT_COLOR.down, 11, 'left')
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
      boldTicks: undefined as undefined
    }
  }, [enrich, style, title, mode])

  return (
    <PlotlyChart
      data={data}
      layout={layout}
      labels={labels}
      labelColor={labelColor}
      labelsAbove
      boldTicks={boldTicks}
    />
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
