/** Focus for a heatmap, linked with every other plot. The lit genes and samples stay at full
 *  strength and every other cell is veiled:
 *  - hovering a cell lights its row and column (its gene and its sample, or comparison), and tells
 *    the other plots — the gene through the cell's uniqID (`customdata`, which PlotlyChart's own
 *    hover and click read: a click pins it), the sample through the sample link (`sampleKeys`);
 *  - a gene hovered in another plot lights its row here, a sample (or a condition) hovered in
 *    another plot lights its columns, and the pinned genes light their rows while anything is
 *    pinned that this heatmap shows.
 *  A track trace sharing the sample axis (the abundance heatmap's condition bar) follows the lit
 *  samples: in each track the cells in a lit sample's group stay lit (`focusKeys`) and the rest
 *  are veiled; hovering a track cell lights that sample.
 *
 *  The veil is plain divs laid between Plotly's plot and its hover layer, placed in pixels from
 *  the axes' own scales — a rectangle per veiled block. Nothing in Plotly is redrawn on a hover (a
 *  shapes relayout redraws every shape, the condition bar's separators included, and lags on a
 *  large heatmap). Pass `(el) => bindHeatmapFocus(el, veil, opts)` as PlotlyChart's
 *  `onGraphMount`; trace 0 is the main heatmap. */
import Plotly, { type PlotlyGraphDiv, type PlotlyMouseEvent } from 'plotly.js-dist-min'

import { truncateLabel } from './plotAxes'
import { sampleMatches, samplesKey, useSampleHover } from './sampleLink'
import { useSelection } from './useSelection'

type Trace = {
  x?: unknown[]
  y?: unknown[]
  xaxis?: string
  yaxis?: string
  /** a track's group per cell, as its z is laid out: cells in a lit sample's group in a track
   *  stay lit with it — its whole condition group, not just its own cell */
  meta?: { focusKeys?: string[][] }
}
/** Plotly's laid-out axis: its pixel offset/length in the paper, and linear → pixel. */
type Axis = { _offset: number; _length: number; l2p: (v: number) => number; range?: number[] }
/** A span along one axis, in category positions (a cell spans i − ½ … i + ½). */
type Span = [number, number]
/** A span in paper pixels. */
type Px = [number, number]

export interface HeatmapFocusOptions {
  /** genes along x (landscape) rather than y */
  landscape: boolean
  /** each gene's uniqID, in the main heatmap's gene order */
  geneIds: string[]
  /** each sample's link key (sampleKey), in the main heatmap's sample order — none for an axis
   *  that isn't samples (the fold-change heatmap's comparisons) */
  sampleKeys?: string[]
  /** the gene axis's labels, in the main heatmap's gene order: its ticks are drawn here, every
   *  `tickPx` px of the axis as laid out (and zoomed); while genes are lit their labels are laid
   *  over the axis in bold (`labelInk` on `labelBg`, so a thinned-out gene shows too) and the
   *  axis's own labels dim to GENE_TICK_DIM */
  geneLabels: string[]
  tickPx: number
  labelInk: string
  labelBg: string
}

/** The gene ticks for an axis `len` px long showing positions `lo` … `hi`: every `step`-th gene,
 *  as many as fit at `tickPx` each, plus the lit genes (thinned the same way if they don't all
 *  fit), with any unlit tick closer than a step to a lit one dropped so the two can't overlap. */
export function geneTicks(
  lo: number,
  hi: number,
  len: number,
  tickPx: number,
  lit: Set<number>
): { ticks: number[]; lit: Set<number> } {
  const fit = Math.max(1, Math.floor(len / tickPx))
  const step = Math.max(1, Math.ceil((hi - lo + 1) / fit))
  const shown = [...lit].filter((i) => i >= lo && i <= hi).sort((a, b) => a - b)
  const litStep = Math.max(1, Math.ceil(shown.length / fit))
  const bold = new Set(shown.filter((_, k) => k % litStep === 0))
  // the positions closer than a step to a lit tick
  const near = new Set<number>()
  for (const b of bold) for (let i = b - step + 1; i < b + step; i++) near.add(i)
  const ticks = [...bold]
  for (let i = lo; i <= hi; i++) if (i % step === 0 && !near.has(i)) ticks.push(i)
  return { ticks: ticks.sort((a, b) => a - b), lit: bold }
}

/** A heatmap's gene labels: one per this many px of the gene axis (9px type, so a clear gap). */
export const GENE_TICK_PX = 16
/** …and how faint the axis's own labels go while a gene is lit (an opacity). */
export const GENE_TICK_DIM = 0.35

/** ms a heatmap's hover must rest on a cell before the other plots follow it (PlotlyChart's
 *  `linkDelay` for the gene, the sample link here): a sweep across thousands of rows would
 *  otherwise redraw every open plot per row; its own focus stays immediate. */
export const LINK_DELAY = 100

/** The runs of 0 … n−1 not in `lit`, as spans (all of it when nothing is lit). */
function unlitRuns(n: number, lit: (j: number) => boolean): Span[] {
  const out: Span[] = []
  let start = -1
  for (let j = 0; j <= n; j++) {
    const off = j < n && !lit(j)
    if (off && start < 0) start = j
    if (!off && start >= 0) {
      out.push([start - 0.5, j - 0.5])
      start = -1
    }
  }
  return out
}

/** A span's pixels on an axis, cut to the axis (a zoomed axis shows only part of it). */
function toPx(ax: Axis, s: Span): Px | null {
  const a = ax.l2p(s[0]) + ax._offset
  const b = ax.l2p(s[1]) + ax._offset
  const lo = Math.max(Math.min(a, b), ax._offset)
  const hi = Math.min(Math.max(a, b), ax._offset + ax._length)
  return hi > lo ? [lo, hi] : null
}

/** The whole of an axis, in pixels. */
const whole = (ax: Axis): Px => [ax._offset, ax._offset + ax._length]

/** The veil's layer: plain divs under Plotly's top layer (the hover labels), over the plot
 *  itself — a rectangle per veiled block, and a thin `ink` outline round each focused block (the
 *  hovered cell, a selected row, a sample hovered elsewhere), reused draw to draw. Null when the
 *  plot isn't laid out. */
function makeVeil(
  el: PlotlyGraphDiv,
  veil: string,
  ink: string
): {
  draw: (rects: Array<[Px, Px]>, outlines?: Array<[Px, Px]>) => void
  remove: () => void
} | null {
  const svgs = el.querySelectorAll<SVGSVGElement>('.svg-container > svg.main-svg')
  const top = svgs[svgs.length - 1]
  if (!top?.parentNode) return null
  const layer = document.createElement('div')
  // its own compositing layer, so redrawing it doesn't repaint the heatmap image beneath
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;will-change:transform'
  top.parentNode.insertBefore(layer, top)
  const fills: HTMLDivElement[] = []
  const lines: HTMLDivElement[] = []
  const place = (pool: HTMLDivElement[], css: string, rects: Array<[Px, Px]>): void => {
    rects.forEach(([[x0, x1], [y0, y1]], i) => {
      let d = pool[i]
      if (!d) {
        d = document.createElement('div')
        d.style.cssText = css
        layer.appendChild(d)
        pool.push(d)
      }
      d.style.left = `${x0}px`
      d.style.top = `${y0}px`
      d.style.width = `${x1 - x0}px`
      d.style.height = `${y1 - y0}px`
      d.style.display = ''
    })
    for (let i = rects.length; i < pool.length; i++) pool[i].style.display = 'none'
  }
  const draw = (rects: Array<[Px, Px]>, outlines: Array<[Px, Px]> = []): void => {
    place(fills, `position:absolute;background:${veil}`, rects)
    // drawn after the veil's, so an outline sits on top of any veil it borders
    place(lines, `position:absolute;box-sizing:border-box;border:1px solid ${ink}`, outlines)
  }
  return { draw, remove: () => layer.remove() }
}

/** The outlines of an nX × nY grid's focus: the hovered `cell` [x, y], and a band across the
 *  grid round each run of `rows` (y positions) and of `cols` (x positions). */
function outlineRects(
  ax: Axis,
  ay: Axis,
  nX: number,
  nY: number,
  cell: [number, number] | null,
  cols: Set<number>,
  rows: Set<number>
): Array<[Px, Px]> {
  const out: Array<[Px, Px]> = []
  const add = (sx: Span, sy: Span): void => {
    const px = toPx(ax, sx)
    const py = toPx(ay, sy)
    if (px && py) out.push([px, py])
  }
  if (cell) add([cell[0] - 0.5, cell[0] + 0.5], [cell[1] - 0.5, cell[1] + 0.5])
  // a run of lit positions is a run of the unlit's complement
  for (const sy of unlitRuns(nY, (j) => !rows.has(j))) add([-0.5, nX - 0.5], sy)
  for (const sx of unlitRuns(nX, (j) => !cols.has(j))) add(sx, [-0.5, nY - 0.5])
  return out
}

/** The veiled cells of an nX × nY grid: neither in a lit column nor in a lit row. */
function veilRects(
  ax: Axis,
  ay: Axis,
  nX: number,
  nY: number,
  litX: Set<number>,
  litY: Set<number>
): Array<[Px, Px]> {
  const rects: Array<[Px, Px]> = []
  const ys = unlitRuns(nY, (j) => litY.has(j))
  for (const sx of unlitRuns(nX, (j) => litX.has(j)))
    for (const sy of ys) {
      const px = toPx(ax, sx)
      const py = toPx(ay, sy)
      if (px && py) rects.push([px, py])
    }
  return rects
}

/** The lit genes' bold labels: plain divs over the axis's own labels (which a hover never
 *  relays out — that redraws the axis, lags, and moves its title as the bold labels widen it),
 *  each on the panel colour so it hides the dimmed label it lands on. Same layer place as the
 *  veil's; drawn each at (x, y) — the end of a label's text, at its tick — level, or at −45°. */
function makeLabels(
  el: PlotlyGraphDiv,
  ink: string,
  bg: string,
  angled: boolean
): { draw: (labels: Array<[number, number, string]>) => void; remove: () => void } | null {
  const svgs = el.querySelectorAll<SVGSVGElement>('.svg-container > svg.main-svg')
  const top = svgs[svgs.length - 1]
  if (!top?.parentNode) return null
  const layer = document.createElement('div')
  // its own compositing layer, so redrawing it doesn't repaint the heatmap image beneath
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;will-change:transform'
  top.parentNode.insertBefore(layer, top)
  const pool: HTMLDivElement[] = []
  const draw = (labels: Array<[number, number, string]>): void => {
    labels.forEach(([x, y, text], i) => {
      let d = pool[i]
      if (!d) {
        // a zero-size anchor at the label's end; the text hangs off it to the left
        d = document.createElement('div')
        d.style.cssText = 'position:absolute;width:0;height:0'
        const t = document.createElement('div')
        t.style.cssText =
          `position:absolute;right:0;top:-6px;height:12px;line-height:12px;padding:0 2px;` +
          `white-space:nowrap;font:bold 9px system-ui,sans-serif;color:${ink};background:${bg};` +
          (angled ? 'transform-origin:100% 50%;transform:rotate(-45deg)' : '')
        d.appendChild(t)
        layer.appendChild(d)
        pool.push(d)
      }
      d.style.left = `${x}px`
      d.style.top = `${y}px`
      ;(d.firstChild as HTMLDivElement).textContent = text
      d.style.display = ''
    })
    for (let i = labels.length; i < pool.length; i++) pool[i].style.display = 'none'
  }
  return { draw, remove: () => layer.remove() }
}

/** The sample hover this chart published (cleared on unhover only if it's still this one's). */
const ownSampleHover = new WeakMap<HTMLElement, string>()

/** Clear the sample hover a chart published, if it is still that one. */
function clearOwnSample(el: HTMLElement): void {
  const mine = ownSampleHover.get(el)
  if (mine != null && useSampleHover.getState().hover === mine)
    useSampleHover.getState().setHover(null)
  ownSampleHover.delete(el)
}

export function bindHeatmapFocus(
  el: PlotlyGraphDiv,
  veil: string,
  { landscape, geneIds, sampleKeys, geneLabels, tickPx, labelInk, labelBg }: HeatmapFocusOptions
): () => void {
  const ev = el as unknown as {
    on: (e: string, cb: (...a: unknown[]) => void) => void
    removeListener?: (e: string, cb: (...a: unknown[]) => void) => void
  }
  const traces = (el.data ?? []) as Trace[]
  const main = traces[0]
  const veilLayer = main ? makeVeil(el, veil, labelInk) : null
  const labelLayer = main ? makeLabels(el, labelInk, labelBg, landscape) : null
  if (!main || !veilLayer || !labelLayer) {
    veilLayer?.remove()
    labelLayer?.remove()
    return () => {}
  }

  const mx = main.xaxis ?? 'x'
  const my = main.yaxis ?? 'y'
  const nX = main.x?.length ?? 0
  const nY = main.y?.length ?? 0
  const nGenes = landscape ? nX : nY
  const nSamples = landscape ? nY : nX
  const geneAt = new Map<string, number[]>()
  geneIds.forEach((id, i) => geneAt.set(id, [...(geneAt.get(id) ?? []), i]))
  const axis = (id: string): Axis | undefined => {
    const fl = (el as unknown as { _fullLayout?: Record<string, Axis> })._fullLayout
    return fl?.[`${id[0]}axis${id.slice(1)}`]
  }
  // This heatmap's own hover (gene and sample positions; either null on a track or an axis that
  // isn't samples), or null — while set it is the focus, over whatever the other plots hover.
  let own: { gene: number | null; sample: number | null } | null = null

  /** The lit gene and sample positions: the own hover, else the linked hovers; plus the pins. */
  const litSets = (): { genes: Set<number>; samples: Set<number> } => {
    const genes = new Set<number>()
    const samples = new Set<number>()
    const sel = useSelection.getState()
    if (own) {
      if (own.gene != null) genes.add(own.gene)
      if (own.sample != null) samples.add(own.sample)
    } else {
      for (const i of (sel.hoverId && geneAt.get(sel.hoverId)) || []) genes.add(i)
      // a hovered group's member genes (a STRING cluster, an enrichment term) as well
      for (const id of sel.hoverMembers) for (const i of geneAt.get(id) ?? []) genes.add(i)
      const h = useSampleHover.getState().hover
      if (h && sampleKeys) sampleKeys.forEach((k, i) => sampleMatches(h, k) && samples.add(i))
    }
    for (const id of sel.pinnedIds) for (const i of geneAt.get(id) ?? []) genes.add(i)
    return { genes, samples }
  }

  const geneAxisId = landscape ? mx : my
  /** The gene axis as laid out, and the gene positions it shows (zoomed or not). */
  const geneSpan = (): { ga: Axis; lo: number; hi: number } | null => {
    const ga = axis(geneAxisId)
    if (!ga || !geneLabels.length) return null
    const [r0, r1] = ga.range ?? [-0.5, geneLabels.length - 0.5]
    const lo = Math.max(0, Math.ceil(Math.min(r0, r1)))
    const hi = Math.min(geneLabels.length - 1, Math.floor(Math.max(r0, r1)))
    return { ga, lo, hi }
  }
  // The gene ticks last written (a signature), so an unchanged set isn't relaid out. Written
  // after a layout (first draw, zoom, resize) — never on a hover.
  let tickSig = ''
  const drawTicks = (): void => {
    const span = geneSpan()
    if (!span) return
    const { ticks } = geneTicks(span.lo, span.hi, span.ga._length, tickPx, new Set())
    const sig = ticks.join(',')
    if (sig === tickSig) return
    tickSig = sig
    const name = `${geneAxisId[0]}axis${geneAxisId.slice(1)}`
    // the view's layout already has these ticks (it spaced them along the same axis): no relayout
    const vals = (span.ga as { tickvals?: unknown[] }).tickvals
    if (
      Array.isArray(vals) &&
      vals.length === ticks.length &&
      ticks.every((i, k) => vals[k] === geneLabels[i])
    )
      return
    void Plotly.relayout(el, {
      [`${name}.tickmode`]: 'array',
      [`${name}.tickvals`]: ticks.map((i) => geneLabels[i]),
      [`${name}.ticktext`]: ticks.map((i) => truncateLabel(geneLabels[i]))
    })
  }
  /** The lit genes' labels in bold over the axis, its own labels dimmed while any is lit. */
  const drawLabels = (genes: Set<number>): void => {
    const span = geneSpan()
    const cross = axis(landscape ? my : mx)
    const labels: Array<[number, number, string]> = []
    if (span && cross && genes.size)
      for (const i of geneTicks(span.lo, span.hi, span.ga._length, tickPx, genes).lit) {
        const at = span.ga.l2p(i) + span.ga._offset
        const t = truncateLabel(geneLabels[i])
        // portrait: left of the plot, level with the row; landscape: below it, under the column
        labels.push(
          landscape ? [at, cross._offset + cross._length + 8, t] : [cross._offset - 6, at, t]
        )
      }
    labelLayer.draw(labels)
    const dim = labels.length ? String(GENE_TICK_DIM) : ''
    el.querySelectorAll<SVGTextElement>(`.${geneAxisId}tick text`).forEach((t) => {
      if (t.style.opacity !== dim) t.style.opacity = dim
    })
  }

  const render = (): void => {
    const { genes, samples } = litSets()
    drawLabels(genes)
    const rects: Array<[Px, Px]> = []
    const ax = axis(mx)
    const ay = axis(my)
    if (ax && ay && (genes.size || samples.size)) {
      const litX = landscape ? genes : samples
      const litY = landscape ? samples : genes
      rects.push(...veilRects(ax, ay, nX, nY, litX, litY))
      // A track along the sample axis: lit where a lit sample's group is, when samples are lit.
      for (const t of samples.size ? traces.slice(1) : []) {
        const tx = t.xaxis ?? 'x'
        const ty = t.yaxis ?? 'y'
        const ox = axis(tx)
        const oy = axis(ty)
        // the track runs along the sample axis, across its own (one cell per track)
        const along = landscape ? ty === my && tx !== mx : tx === mx && ty !== my
        if (!ox || !oy || !along) continue
        const sampleAx = landscape ? ay : ax
        const crossAx = landscape ? ox : oy
        const keys = t.meta?.focusKeys
        const place = (ss: Span, cs: Px): void => {
          const ps = toPx(sampleAx, ss)
          if (ps) rects.push(landscape ? [cs, ps] : [ps, cs])
        }
        if (!keys) {
          for (const ss of unlitRuns(nSamples, (j) => samples.has(j))) place(ss, whole(crossAx))
          continue
        }
        // keys[track][sample], whichever way the trace lays them out
        const nTracks = landscape ? (keys[0]?.length ?? 0) : keys.length
        const keyAt = (track: number, s: number): string =>
          landscape ? keys[s][track] : keys[track][s]
        for (let i = 0; i < nTracks; i++) {
          const cs = toPx(crossAx, [i - 0.5, i + 0.5])
          if (!cs) continue
          const lit = new Set([...samples].map((s) => keyAt(i, s)))
          for (const ss of unlitRuns(nSamples, (j) => lit.has(keyAt(i, j)))) place(ss, cs)
        }
      }
    }
    // Outlined: the hovered cell (this heatmap's own hover), and — as bands across the grid — the
    // selected genes' rows, and while nothing is hovered here, the genes and samples hovered in
    // another plot (or the sample a track cell here stands over).
    const pinned = new Set<number>()
    for (const id of useSelection.getState().pinnedIds)
      for (const i of geneAt.get(id) ?? []) pinned.add(i)
    const cell = own && own.gene != null && own.sample != null ? [own.gene, own.sample] : null
    const bandGenes = own ? pinned : genes
    const bandSamples: Set<number> = own
      ? new Set(own.gene == null && own.sample != null ? [own.sample] : [])
      : samples
    const outlines =
      ax && ay
        ? outlineRects(
            ax,
            ay,
            nX,
            nY,
            cell && (landscape ? [cell[0], cell[1]] : [cell[1], cell[0]]),
            landscape ? bandGenes : bandSamples,
            landscape ? bandSamples : bandGenes
          )
        : []
    veilLayer.draw(rects, outlines)
  }

  // a sample hover held back from the other plots (LINK_DELAY), until it fires or is replaced
  let sampleTimer: ReturnType<typeof setTimeout> | undefined
  const setOwn = (gene: number | null, sample: number | null): void => {
    if (own && own.gene === gene && own.sample === sample) return
    own = { gene, sample }
    // the sample, to the other plots once the cursor rests (the gene goes through the cell's
    // customdata, held back as long by PlotlyChart's linkDelay)
    const key = sample != null ? sampleKeys?.[sample] : undefined
    clearTimeout(sampleTimer)
    if (!key) clearOwnSample(el)
    else if (ownSampleHover.get(el) !== key)
      sampleTimer = setTimeout(() => {
        ownSampleHover.set(el, key)
        useSampleHover.getState().setHover(key)
      }, LINK_DELAY)
    render()
  }
  const clear = (): void => {
    if (!own) return
    own = null
    clearTimeout(sampleTimer)
    clearOwnSample(el)
    render()
  }
  const onHover = (e: PlotlyMouseEvent): void => {
    const pt = e.points?.[0] as unknown as
      { curveNumber: number; pointNumber: number | number[] } | undefined
    if (!pt || !Array.isArray(pt.pointNumber)) return
    // a heatmap point is [row, column]
    const [r, c] = pt.pointNumber
    if (pt.curveNumber === 0) {
      const g = landscape ? c : r
      const s = landscape ? r : c
      return setOwn(g < nGenes ? g : null, s < nSamples ? s : null)
    }
    // a track cell: the sample it stands over
    setOwn(null, landscape ? r : c)
  }
  ev.on('plotly_hover', onHover as (...a: unknown[]) => void)
  ev.on('plotly_unhover', clear)
  // a zoom, pan or resize moves the cells under a veil placed in pixels, and changes how many
  // gene labels fit
  const relaid = (): void => {
    drawTicks()
    render()
  }
  ev.on('plotly_relayout', relaid)
  ev.on('plotly_afterplot', relaid)
  // plotly_unhover can be skipped when the cursor leaves the plot fast; leaving the div clears too.
  el.addEventListener('mouseleave', clear)
  const unsubSel = useSelection.subscribe((s, prev) => {
    if (s.pinnedIds !== prev.pinnedIds || (!own && s.hoverId !== prev.hoverId)) render()
  })
  const unsubSample = useSampleHover.subscribe((s, prev) => {
    if (!own && s.hover !== prev.hover) render()
  })
  relaid()
  return () => {
    unsubSel()
    unsubSample()
    clearTimeout(sampleTimer)
    clearOwnSample(el)
    ev.removeListener?.('plotly_hover', onHover as (...a: unknown[]) => void)
    ev.removeListener?.('plotly_unhover', clear)
    ev.removeListener?.('plotly_relayout', relaid)
    ev.removeListener?.('plotly_afterplot', relaid)
    el.removeEventListener('mouseleave', clear)
    veilLayer.remove()
    labelLayer.remove()
  }
}

/** Focus for a sample-correlation matrix (samples down y and across x, in the same order):
 *  hovering a cell lights its row and its column — the pair it correlates — veils the rest, and
 *  lights both samples in the other plots (one hover for the pair, samplesKey); a sample (or a
 *  condition) hovered in another plot lights its row and column both. Pass as PlotlyChart's
 *  `onGraphMount`; trace 0 is the matrix. */
export function bindCorrFocus(
  el: PlotlyGraphDiv,
  veil: string,
  sampleKeys: string[],
  ink: string
): () => void {
  const ev = el as unknown as {
    on: (e: string, cb: (...a: unknown[]) => void) => void
    removeListener?: (e: string, cb: (...a: unknown[]) => void) => void
  }
  const veilLayer = makeVeil(el, veil, ink)
  if (!veilLayer) return () => {}
  const n = sampleKeys.length
  const axis = (id: string): Axis | undefined =>
    (el as unknown as { _fullLayout?: Record<string, Axis> })._fullLayout?.[id]
  // the hovered cell [row, column], or null — while set it is the focus, over the linked hover
  let own: [number, number] | null = null

  const render = (): void => {
    const ax = axis('xaxis')
    const ay = axis('yaxis')
    const rows = new Set<number>()
    const cols = new Set<number>()
    if (own) {
      rows.add(own[0])
      cols.add(own[1])
    } else {
      const h = useSampleHover.getState().hover
      if (h)
        sampleKeys.forEach((k, i) => {
          if (!sampleMatches(h, k)) return
          rows.add(i)
          cols.add(i)
        })
    }
    // outlined: the hovered cell, else the rows and columns of a sample hovered elsewhere
    veilLayer.draw(
      ax && ay && (rows.size || cols.size) ? veilRects(ax, ay, n, n, cols, rows) : [],
      ax && ay
        ? own
          ? outlineRects(ax, ay, n, n, [own[1], own[0]], new Set(), new Set())
          : outlineRects(ax, ay, n, n, null, cols, rows)
        : []
    )
  }
  // the pair's hover held back from the other plots (LINK_DELAY), until it fires or is replaced
  let pairTimer: ReturnType<typeof setTimeout> | undefined
  const clear = (): void => {
    if (!own) return
    own = null
    clearTimeout(pairTimer)
    clearOwnSample(el)
    render()
  }
  const onHover = (e: PlotlyMouseEvent): void => {
    const pt = e.points?.[0] as unknown as { pointNumber: number | number[] } | undefined
    if (!pt || !Array.isArray(pt.pointNumber)) return
    const [r, c] = pt.pointNumber
    if (own && own[0] === r && own[1] === c) return
    own = [r, c]
    // the pair, to the other plots once the cursor rests
    const pair = [sampleKeys[r], sampleKeys[c]].filter((k): k is string => k != null)
    clearTimeout(pairTimer)
    if (!pair.length) clearOwnSample(el)
    else {
      const key = samplesKey(pair)
      if (ownSampleHover.get(el) !== key)
        pairTimer = setTimeout(() => {
          ownSampleHover.set(el, key)
          useSampleHover.getState().setHover(key)
        }, LINK_DELAY)
    }
    render()
  }
  ev.on('plotly_hover', onHover as (...a: unknown[]) => void)
  ev.on('plotly_unhover', clear)
  ev.on('plotly_relayout', render)
  ev.on('plotly_afterplot', render)
  el.addEventListener('mouseleave', clear)
  const unsubSample = useSampleHover.subscribe((s, prev) => {
    if (!own && s.hover !== prev.hover) render()
  })
  render()
  return () => {
    unsubSample()
    clearTimeout(pairTimer)
    clearOwnSample(el)
    ev.removeListener?.('plotly_hover', onHover as (...a: unknown[]) => void)
    ev.removeListener?.('plotly_unhover', clear)
    ev.removeListener?.('plotly_relayout', render)
    ev.removeListener?.('plotly_afterplot', render)
    el.removeEventListener('mouseleave', clear)
    veilLayer.remove()
  }
}
