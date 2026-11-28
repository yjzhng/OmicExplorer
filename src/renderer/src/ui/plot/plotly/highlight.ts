/** Linked-selection highlighting: which traces and points stand for the selected genes, the
 *  emphasis overlay drawn over them, and the in-place restyle that fades the rest. */
import Plotly, { type PlotlyGraphDiv } from 'plotly.js-strict-dist-min'
import { truncateLabel } from '../plotAxes'
import { AUTO, CLEAR } from '../../color/ColorPicker'
import { DEFAULT_HIGHLIGHT, type ResolvedHighlight } from '../pointStyle'
import { DENSITY_OF, type BinnedTraces } from '../densityBins'
import { hasGlTraces, toGlOverlay, toGlTraces } from '../glTraces'
import { PALETTES } from '../../app/theme'
import { useUiTheme } from '../../app/useUiTheme'

/** Dim applied to EVERY point while a threshold guide is hovered/dragged, so the lines read clearly
 *  against a faded cloud — same strength as the default point-hover dim. */
const GUIDE_DIM = DEFAULT_HIGHLIGHT.dim
/** Marks the emphasis trace so it can be found again on the live graph div. */
export const OVERLAY_FLAG = '__oeOverlay'
/** A trace may carry its OWN highlight look (a point plot's per-group settings) under this key;
 *  traces without one use the chart's `emphasis` prop. */
const EMPH_KEY = '__oeEmph'
/** That trace's highlight look, or the chart-wide one. */
const emphOf = (t: Trace, fallback: ResolvedHighlight): ResolvedHighlight =>
  ((t as Record<string, unknown>)[EMPH_KEY] as ResolvedHighlight | undefined) ?? fallback

export type Trace = Record<string, unknown> & {
  textfont?: unknown
  customdata?: unknown
  mode?: unknown
  opacity?: number
  x?: unknown
  y?: unknown
  text?: unknown
  marker?: {
    opacity?: number | number[]
    size?: number | number[]
    color?: string | number | (string | number)[]
    line?: { width?: number | number[]; color?: string | string[] }
    symbol?: string | string[]
    // Diverging/continuous colour map (e.g. the bubble's log2FC scale).
    colorscale?: unknown
    cmid?: number
    cmin?: number
    cmax?: number
  }
}

/** Reproduce a colorscale trace's exact normalization so an overlay of a SUBSET of its
 *  points maps the same values to the same colours (Plotly would otherwise re-fit
 *  cmin/cmax to the subset). Mirrors Plotly's symmetric range when `cmid` is set. */
function colorScaleOf(mk: NonNullable<Trace['marker']>): Record<string, unknown> {
  const nums = ((mk.color as (string | number)[]) ?? []).filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v)
  )
  let cmin = mk.cmin
  let cmax = mk.cmax
  if ((cmin == null || cmax == null) && nums.length) {
    let lo = Math.min(...nums)
    let hi = Math.max(...nums)
    if (mk.cmid != null) {
      const r = Math.max(Math.abs(lo - mk.cmid), Math.abs(hi - mk.cmid))
      lo = mk.cmid - r
      hi = mk.cmid + r
    }
    cmin = cmin ?? lo
    cmax = cmax ?? hi
  }
  return { colorscale: mk.colorscale, cmid: mk.cmid, cmin, cmax }
}

/** A colour stop's [r, g, b] (hex #rgb/#rrggbb or rgb()/rgba()); null for anything else. */
function rgbOf(c: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1]
    const n = parseInt(h, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(c)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
}

/** A colour-scaled trace's colour lookup: value → the colour Plotly draws it in, for a scale given
 *  as explicit [position, colour] stops over the trace's own cmin/cmax (as colorScaleOf resolves
 *  them). Null when the scale is a named one (e.g. 'Viridis') — the overlay then reuses the scale
 *  itself instead. Resolving per trace is what keeps two differently-scaled traces (the enrichment
 *  dots' Reds for up, Blues for down) each in their own colours when emphasised. */
function scaleColorer(mk: NonNullable<Trace['marker']>): ((v: number) => string) | null {
  const cs = mk.colorscale
  if (!Array.isArray(cs) || cs.length < 2) return null
  const stops = (cs as [number, string][]).map(([pos, c]) => ({ pos, rgb: rgbOf(c) }))
  if (stops.some((st) => !st.rgb)) return null
  const { cmin, cmax } = colorScaleOf(mk) as { cmin?: number; cmax?: number }
  if (cmin == null || cmax == null) return null
  return (v) => {
    const t = cmax > cmin ? Math.max(0, Math.min(1, (v - cmin) / (cmax - cmin))) : 0
    let i = 0
    while (i < stops.length - 2 && t > stops[i + 1].pos) i++
    const a = stops[i]
    const b = stops[i + 1]
    const f = b.pos > a.pos ? Math.max(0, Math.min(1, (t - a.pos) / (b.pos - a.pos))) : 0
    const mix = (k: number): number => Math.round(a.rgb![k] + (b.rgb![k] - a.rgb![k]) * f)
    return `rgb(${mix(0)},${mix(1)},${mix(2)})`
  }
}

export interface BaseOpacity {
  marker: number
  line: number
}

/** Read a possibly-per-point attribute at point `k`. */
export const at = <T>(v: T | T[] | undefined, k: number, fallback: T): T =>
  Array.isArray(v) ? ((v[k] ?? fallback) as T) : (v ?? fallback)

/** A trace is highlightable if it carries a per-point uniqID array in `customdata` — ids are strings.
 *  A trace whose customdata holds anything else (a QC bar's counts, its hover bar's quartiles)
 *  carries no genes, and must not fade when a gene is selected. */
export function traceIds(t: Trace): string[] | null {
  const cd = t.customdata
  return Array.isArray(cd) && cd.length > 0 && typeof cd[0] === 'string' ? (cd as string[]) : null
}
// A trace that draws a line is one series per feature → dim it wholesale (line +
// its markers together). Pure marker traces dim per point.
const isLine = (t: Trace): boolean => typeof t.mode === 'string' && t.mode.includes('lines')
// A bar trace carries no overlay (a bar is its own emphasis), so it dims PER BAR: the active bars
// keep their colour, the rest fade.
const isBar = (t: Trace): boolean => (t as { type?: string }).type === 'bar'

/** Snapshot each trace's configured opacity BEFORE any restyle. Plotly reuses the
 *  passed trace objects as gd.data and restyle mutates them in place, so reading the
 *  "base" opacity back off a trace after a dim would return the dimmed value — the
 *  reset must restore from this snapshot instead. */
export function snapshotBases(data: unknown[]): BaseOpacity[] {
  return data.map((raw) => {
    const t = raw as Trace
    // A view may set a per-point marker.opacity array; the hover restore needs a scalar
    // base (restyle would otherwise treat an array as a per-trace value list). Views that
    // want per-point emphasis use marker.color/size instead, which this layer never touches.
    const mo = t.marker?.opacity
    // A bar draws opaque by default (a marker trace's resting look is 0.85).
    return { marker: typeof mo === 'number' ? mo : isBar(t) ? 1 : 0.85, line: t.opacity ?? 1 }
  })
}

/** What a highlight needs from a plot's traces, built ONCE per data (pointIndex) so a hover only
 *  touches the lit genes' own points instead of scanning every point of every trace. */
interface PointIndex {
  /** uniqID → its points as flat [trace, k, trace, k, …] pairs, in trace-then-point order */
  byId: Map<string, number[]>
  /** per trace: its ids (null = carries no genes) */
  ids: (string[] | null)[]
  /** per trace: the overlay's view of it — null when it gets no overlay (see buildOverlay) */
  overlay: ({
    numeric: boolean
    colorer: ((v: number) => string) | null
  } | null)[]
  /** the first numeric-scaled overlay trace's scale (colorScaleOf), carried by the overlay */
  cmap: Record<string, unknown> | null
}

// Keyed by the data array itself: a new plot is a new array, and a restyle only mutates opacity
// (never ids, positions or colours), so an entry stays valid for as long as its array is drawn.
const pointIndexCache = new WeakMap<unknown[], PointIndex>()

function pointIndex(data: unknown[]): PointIndex {
  const hit = pointIndexCache.get(data)
  if (hit) return hit
  const byId = new Map<string, number[]>()
  const ids: (string[] | null)[] = []
  const overlay: PointIndex['overlay'] = []
  let cmap: Record<string, unknown> | null = null
  data.forEach((raw, i) => {
    const t = raw as Trace
    const tIds = traceIds(t)
    ids.push(tIds)
    overlay.push(null)
    if (!tIds) return
    tIds.forEach((id, k) => {
      const pts = byId.get(id)
      if (pts) pts.push(i, k)
      else byId.set(id, [i, k])
    })
    if (
      isLine(t) ||
      // A bar is its own emphasis (it dims/brightens in place); a dot drawn over it reads as a
      // stray marker.
      isBar(t) ||
      (t as { __oeNoOverlay?: boolean }).__oeNoOverlay ||
      // A trace that answers a selection by its opacity alone (a DR line's points): it fades and
      // brightens like a line, with no emphasis dots drawn over it.
      (t as { __oeDimOnly?: boolean }).__oeDimOnly ||
      !Array.isArray(t.x) ||
      !Array.isArray(t.y)
    )
      return
    const mk = t.marker
    const scaled = Array.isArray(mk?.color) && typeof (mk.color as unknown[])[0] === 'number'
    // A scale of explicit stops → each point's own colour, resolved on ITS trace's scale; only a
    // named scale falls back to carrying the (first such trace's) scale on the overlay.
    const colorer = scaled && mk ? scaleColorer(mk) : null
    const numeric = scaled && !colorer
    if (numeric && mk && !cmap) cmap = colorScaleOf(mk)
    overlay[i] = { numeric, colorer }
  })
  const idx = { byId, ids, overlay, cmap }
  pointIndexCache.set(data, idx)
  return idx
}

/** The active genes' points, as [trace, k] pairs in trace-then-point order (the order a scan of
 *  every trace would meet them in). */
function activePoints(idx: PointIndex, active: Set<string>): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const id of active) {
    const pts = idx.byId.get(id)
    if (pts) for (let j = 0; j < pts.length; j += 2) out.push([pts[j], pts[j + 1]])
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

/**
 * Redraw the active points as one extra trace appended after all the others.
 * Plotly paints traces in array order, so this is what puts the selection *above*
 * the dimmed cloud — restyling the point in place would leave it painted under
 * whichever neighbours came later in the same trace. Enlarged by `emph.bump`, fully
 * opaque, keeping each point's own colour, ringed and named per `emph`.
 */
function buildOverlay(data: unknown[], active: Set<string>, emph: ResolvedHighlight): Trace {
  const ink = PALETTES[useUiTheme.getState().mode].text
  const x: unknown[] = []
  const y: unknown[] = []
  const size: number[] = []
  const color: (string | number)[] = []
  const text: string[] = []
  // Per-point, since each source trace may carry its own highlight look (see EMPH_KEY): the ring's
  // width and the name's size travel with the point, not with the overlay.
  const ringW: number[] = []
  const ringC: string[] = []
  const fontSize: number[] = []
  // …and the name's colour: the look's own, else (automatic — a point plot's) the point's colour;
  // a look with none (any other chart) names it in the theme text.
  const textC: string[] = []
  // each point's look, and whether it's its own group's (see the merge of repeats below)
  const emAt: ResolvedHighlight[] = []
  const ownAt: boolean[] = []
  const nameColor = (em: ResolvedHighlight, c: string | number): string =>
    em.labelColor === undefined
      ? ink
      : em.labelColor !== AUTO
        ? em.labelColor
        : typeof c === 'string' && c !== CLEAR
          ? c
          : ink
  // each point's own symbol, so an emphasised point keeps its shape (a bubble's hollow, not
  // significant circle stays hollow — an open symbol strokes in the marker colour)
  const symbol: string[] = []
  // uniqID per overlay point, so a click on the (larger, on-top) emphasis marker can toggle the right
  // gene (see the click handler; the base dot underneath is smaller so its hit area misses the edge).
  const cd: string[] = []
  // A gene often appears in several traces at the SAME spot (its effect group AND a "Selected"
  // emphasis trace), so overlay each id+position ONCE — otherwise it stacks, doubling the marker and
  // label. Keying by position (not id alone) still emphasises a gene that legitimately appears at
  // MULTIPLE spots — e.g. the same leading-edge gene across several GSEA ridges — at each of them.
  // posKey → index in the arrays: a point drawn by several traces is emphasised once.
  const seen = new Map<string, number>()
  const idx = pointIndex(data)
  // When the emphasised points come from a colorscale trace (the bubble's diverging
  // log2FC map), reuse that scale + range so the enlarged point keeps the SAME colour.
  const cmap = idx.cmap
  // Only the active genes' own points (via the index), in the order a scan of every trace meets them.
  for (const [i, k] of active.size ? activePoints(idx, active) : []) {
    const info = idx.overlay[i]
    if (!info) continue
    const t = data[i] as Trace
    const id = (idx.ids[i] as string[])[k]
    const mk = t.marker
    const { colorer, numeric } = info
    const em = emphOf(t, emph)
    // the trace carries its own look (a point plot's group), not just the chart's
    const own = !!(t as Record<string, unknown>)[EMPH_KEY]
    const xk = (t.x as unknown[])[k]
    const yk = (t.y as unknown[])[k]
    const posKey = `${id}|${String(xk)}|${String(yk)}`
    // An explicit emphasis size wins; otherwise size from the SMALLEST marker drawn at this spot
    // — the cloud's own dot — plus the bump, so emphasis is the same size on every plot
    // regardless of any larger view-level marker.
    const sz = em.size ?? renderedSize(t.marker, k) + em.bump
    const prev = seen.get(posKey)
    if (prev != null) {
      // The point's own group look wins over the chart-wide one of a trace drawn on top of it (a
      // selected gene group's trace carries none): its selected size, outline and name are what
      // the group's settings say — the smaller size kept only between looks of the same standing.
      if (own && !ownAt[prev]) {
        ownAt[prev] = true
        emAt[prev] = em
        size[prev] = sz
        ringW[prev] = em.ring
        ringC[prev] = em.ringColor ?? ink
        fontSize[prev] = em.labelSize
      } else if (own === ownAt[prev]) size[prev] = Math.min(size[prev], sz)
      // …but COLOURED from the LAST trace drawn there: Plotly paints later traces on top, so
      // that is the colour the eye sees (e.g. a view's pinned-genes trace in a geneset's colour
      // over the effect-coloured cloud).
      if (colorer) color[prev] = colorer(at(mk?.color as number[], k, 0))
      else if (!numeric) color[prev] = at(mk?.color as string | string[], k, color[prev] as string)
      textC[prev] = nameColor(emAt[prev], color[prev])
      continue
    }
    seen.set(posKey, x.length)
    x.push(xk)
    y.push(yk)
    cd.push(id)
    size.push(sz)
    ringW.push(em.ring)
    ringC.push(em.ringColor ?? ink)
    fontSize.push(em.labelSize)
    emAt.push(em)
    ownAt.push(own)
    symbol.push(at(mk?.symbol, k, 'circle'))
    // Numeric → keep the raw value so the overlay's colorscale maps it; else the
    // point's own colour string.
    color.push(
      colorer
        ? colorer(at(mk?.color as number[], k, 0))
        : numeric
          ? at(mk?.color as number[], k, 0)
          : at(mk?.color as string | string[], k, '#888')
    )
    textC.push(nameColor(em, color[color.length - 1]))
    // Carry the point's own label so the emphasised gene is named in place — this is
    // what surfaces a name on hover in the scatter/etc. A trace can opt out (bubble,
    // whose gene names already sit on the axis) via __oeNoLabel, and a tile's highlight
    // config can switch the names off altogether.
    text.push(
      !em.label || (t as { __oeNoLabel?: boolean }).__oeNoLabel
        ? ''
        : truncateLabel(at(t.text as string | string[] | undefined, k, ''))
    )
  }
  return {
    [OVERLAY_FLAG]: true,
    x,
    y,
    customdata: cd,
    type: 'scatter',
    // markers+text so the selected point is both enlarged and named.
    mode: 'markers+text',
    text,
    textposition: 'top center',
    // Selected/hovered gene names, bold so they read as the emphasised labels: in the theme's text
    // colour (black was invisible on the dark theme — plots draw on a transparent paper over the
    // dark panel), or in a point plot's, their point's colour (or the one set — see nameColor).
    textfont: { size: fontSize, color: textC, weight: 700 },
    cliponaxis: false,
    // The underlying point still answers hover; the overlay stays inert to avoid doubled tooltips.
    hoverinfo: 'skip',
    showlegend: false,
    // Own colour, fully opaque, enlarged, and ringed in the text colour: the ring is what makes a
    // pinned point obvious among neighbours of the same effect colour (the cloud is only dimmed).
    marker: {
      size,
      color,
      opacity: 1,
      line: { width: ringW, color: ringC },
      symbol,
      ...(cmap ?? {})
    }
  }
}

/** The pixel diameter Plotly actually draws point `k` at. A marker's `size` is only that diameter by
 *  default: with `sizeref` / `sizemode: 'area'` (a bubble sized by a count — enrichment dots) it's a
 *  data value Plotly maps to pixels, and copying it raw drew the emphasis marker many times too big.
 *  Plotly's own rule (scatter's bubble-size function): radius = max(f(size / 2), sizemin), with
 *  f = √(v / sizeref) by area, else v / sizeref — so a plain marker comes out as its size again. */
function renderedSize(marker: Trace['marker'] | undefined, k: number): number {
  const mk = marker as
    { size?: number | number[]; sizeref?: number; sizemode?: string; sizemin?: number } | undefined
  const v = at(mk?.size, k, 6)
  const ref = mk?.sizeref || 1
  const base = mk?.sizemode === 'area' ? Math.sqrt(v / 2 / ref) : v / 2 / ref
  return 2 * Math.max(Number.isFinite(base) && base > 0 ? base : 0, mk?.sizemin ?? 0)
}

/** Per-trace highlight state for the current selection: '' = opts out (no ids, or manages its
 *  own emphasis); 'off' = nothing selected (resting look); 'on' = highlighted (a line series that
 *  holds a selected feature, or a marker trace made ONLY of selected points — a view's own
 *  "Selected" trace, a legend-clicked group); 'dim' = faded; 'gdim' = faded for a guide drag.
 *  Marker traces dim WHOLESALE (a scalar opacity), never per point: the selected points are drawn
 *  opaque by the overlay on top, so a trace's state depends only on WHETHER something is selected —
 *  moving the hover from one gene to the next changes nothing but the overlay. */
function traceSigs(data: unknown[], active: Set<string>, dimAll: boolean): string[] {
  const idx = pointIndex(data)
  // Each trace's active points (via the index — only the active genes' own points are visited).
  const lit: number[][] = data.map(() => [])
  if (!dimAll) for (const [i, k] of activePoints(idx, active)) lit[i].push(k)
  // Traces flagged __oeOwnIds carry ids of their own (an enrichment plot's terms, not genes): they
  // react only when the active set holds one of THEIRS — a gene selected elsewhere, which none of
  // them can match, would otherwise dim the whole plot.
  const ownTouched = data.some(
    (raw, i) => (raw as { __oeOwnIds?: boolean }).__oeOwnIds && lit[i].length > 0
  )
  return data.map((raw, i) => {
    const t = raw as Trace
    const ids = idx.ids[i]
    if (!ids || (t as { __oeNoOverlay?: boolean }).__oeNoOverlay) return ''
    if (dimAll) return 'gdim'
    if (active.size === 0) return 'off'
    if ((t as { __oeOwnIds?: boolean }).__oeOwnIds && !ownTouched) return 'off'
    if (isLine(t)) return lit[i].length ? 'on' : 'dim'
    // A bar trace's state is which of its bars are active (see isBar), so a hover moving from one
    // bar to the next restyles it.
    if (isBar(t)) return `bar:${lit[i].join(',')}`
    return lit[i].length === ids.length ? 'on' : 'dim'
  })
}

/** The opacity a trace renders at in a given highlight state. A highlighted MARKER trace is fully
 *  opaque — not its resting value (typically 0.85) — so a highlighted group never looks
 *  translucent. A highlighted LINE trace keeps its resting opacity: 'on' there only means "not
 *  dimmed" (a line trace can be a merged multi-series background at 0.22 holding every gene, and
 *  the emphasised series' own look — width, colour — is the view's), so it must not light up. */
/** A trace's opacity in its highlight state: a scalar, or — for a bar trace with something active
 *  — one per bar (the active ones fully opaque, the rest dimmed). */
function traceOpacity(
  t: Trace,
  sig: string,
  active: Set<string>,
  base: BaseOpacity,
  dim: number
): number | number[] {
  if (sig.startsWith('bar:')) return (traceIds(t) ?? []).map((id) => (active.has(id) ? 1 : dim))
  return opacityFor(sig, isLine(t), base, dim)
}

function opacityFor(sig: string, line: boolean, base: BaseOpacity, dim: number): number {
  if (sig === 'gdim') return GUIDE_DIM
  if (sig === 'off') return line ? base.line : base.marker
  if (sig === 'on') return line ? base.line : 1
  return dim
}

/** A binned trace's density (densityBins) in its source trace's highlight state: the trace-level
 *  opacity that scales its resting look (already at the points' opacity) to the dimmed one. */
function densityOpacity(sig: string, base: BaseOpacity, dim: number): number {
  return Math.min(1, opacityFor(sig, false, base, dim) / (base.marker || 1))
}

/** Whether two overlay traces would draw the same thing (so the restyle can be skipped — a restyle
 *  of x/y is a redraw of that trace, and on every mouse move over an unaffected plot it's waste). */
function sameOverlay(a: Trace | undefined, b: Trace): boolean {
  if (!a) return false
  const ax = a.x as unknown[]
  const bx = b.x as unknown[]
  const ay = a.y as unknown[]
  const by = b.y as unknown[]
  const as = (a.marker as { size?: number[] })?.size ?? []
  const bs = (b.marker as { size?: number[] })?.size ?? []
  // the names too: which are culled moves with the zoom and the hovered gene (cullOverlayNames)
  const aText = (a.text ?? []) as string[]
  const bText = (b.text ?? []) as string[]
  if (ax.length !== bx.length) return false
  for (let i = 0; i < ax.length; i++)
    if (ax[i] !== bx[i] || ay[i] !== by[i] || as[i] !== bs[i] || aText[i] !== bText[i]) return false
  return true
}

/** The restyle payload that moves the (single, permanent) overlay trace to a new set of points. */
function overlayRestyle(top: Trace): Record<string, unknown[]> {
  const mk = top.marker as Record<string, unknown> & {
    line?: { color?: string | string[]; width?: number | number[] }
  }
  const u: Record<string, unknown[]> = {
    x: [top.x],
    y: [top.y],
    customdata: [top.customdata ?? []],
    text: [top.text],
    'marker.size': [mk.size],
    'marker.color': [mk.color],
    'marker.line.color': [mk.line?.color],
    'marker.line.width': [mk.line?.width],
    'marker.symbol': [mk.symbol ?? 'circle'],
    'textfont.size': [(top.textfont as { size?: unknown } | undefined)?.size],
    'textfont.color': [(top.textfont as { color?: unknown } | undefined)?.color]
  }
  // A colorscale (bubble) travels with the points so numeric colours map the same way.
  for (const key of ['colorscale', 'cmid', 'cmin', 'cmax'])
    if (mk[key] !== undefined) u[`marker.${key}`] = [mk[key]]
  return u
}

/**
 * The traces actually handed to Plotly.react: the view's traces with the CURRENT highlight already
 * applied (each trace at its 'on'/'dim'/resting opacity) plus the emphasis overlay as a permanent
 * last trace. Rendering the highlight in the same pass as the plot means a re-render never shows an
 * intermediate frame (a fresh undimmed cloud, then a dimmed cloud without its overlay), and because
 * the overlay always exists, every later hover/pin change is an in-place restyle — never a
 * structural add/remove. Returns the sigs it baked in, so the first in-place apply can skip them.
 */
export function decorateData(
  data: unknown[],
  active: Set<string>,
  bases: BaseOpacity[],
  dimAll: boolean,
  emph: ResolvedHighlight,
  gl: boolean,
  binned: BinnedTraces = { traces: data, density: new Map() }
): { traces: unknown[]; sigs: string[] } {
  const sigs = traceSigs(data, active, dimAll)
  // What's drawn: the view's traces, a very dense bulk as its density (densityBins) — the same
  // index for each view trace, the densities appended. The highlight state still comes from `data`.
  const traces = (gl ? toGlTraces(binned.traces) : binned.traces).map((raw, i) => {
    const t = raw as Trace
    const src = (t as Record<string, unknown>)[DENSITY_OF]
    if (typeof src === 'number') {
      const dt = data[src] as Trace
      return sigs[src]
        ? {
            ...t,
            opacity: densityOpacity(
              sigs[src],
              bases[src] ?? { marker: 0.85, line: 1 },
              emphOf(dt, emph).dim
            )
          }
        : raw
    }
    if (!sigs[i]) return raw
    const op = traceOpacity(
      t,
      sigs[i],
      active,
      bases[i] ?? { marker: 0.85, line: 1 },
      emphOf(t, emph).dim
    )
    return isLine(t)
      ? { ...t, opacity: op }
      : { ...t, marker: { ...(t.marker ?? {}), opacity: op } }
  })
  const overlay = buildOverlay(data, dimAll ? new Set() : active, emph)
  // Over a WebGL cloud the overlay must be WebGL too, or it draws underneath (see toGlOverlay).
  traces.push(hasGlTraces(traces) ? toGlOverlay(overlay) : overlay)
  return { traces, sigs }
}

/** After a zoom / pan / reset, show again any point Plotly left hidden that's back in view.
 *  While a plot carries an unclipped trace (the selection overlay, `cliponaxis: false`), Plotly
 *  hides the points outside the zoomed range with `display="none"` — on every trace in the
 *  subplot, not just that one — and after zooming back out some stayed hidden: only the genes
 *  seen while zoomed came back, until a full redraw (a hover elsewhere moving this plot's overlay)
 *  restored the rest. This re-checks every hidden point against the live ranges and unhides the
 *  ones now inside. Deferred a frame so it runs after Plotly's own redraw. */
export function repaintPoints(el: PlotlyGraphDiv): void {
  requestAnimationFrame(() => {
    const fl = (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout
    const xr = (fl?.xaxis as { range?: [number, number] } | undefined)?.range
    const yr = (fl?.yaxis as { range?: [number, number] } | undefined)?.range
    if (!xr || !yr) return
    const inside = (v: unknown, r: [number, number]): boolean =>
      typeof v === 'number' && v >= Math.min(r[0], r[1]) && v <= Math.max(r[0], r[1])
    el.querySelectorAll('.scatterlayer path.point[display="none"]').forEach((node) => {
      const d = (node as unknown as { __data__?: { x?: unknown; y?: unknown } }).__data__
      if (d && inside(d.x, xr) && inside(d.y, yr)) node.removeAttribute('display')
    })
  })
}

/** Which lit genes the overlay names first: the hovered one, then the view's label priority. */
export interface OverlayNames {
  /** gene id → its label priority (PlotLabel.priority; higher first) */
  priority: Map<string, number>
  /** the hovered gene, always named */
  first: string | null
}

/** Cull the overlay's names by the label crowding rule: in order (the hovered gene, then by the
 *  view's label priority — most differentiated first), a name is kept only if its box clears every
 *  name already kept. One name or a few in open space all show; a highlighted group of hundreds
 *  is named where there's room, not in a pile. */
function cullOverlayNames(el: PlotlyGraphDiv, top: Trace, names: OverlayNames): void {
  const text = top.text as string[] | undefined
  if (!Array.isArray(text) || text.filter(Boolean).length < 2) return
  const fl = (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout
  type Ax = { _offset: number; d2p?: (v: unknown) => number; l2p: (v: number) => number }
  const xa = fl?.xaxis as Ax | undefined
  const ya = fl?.yaxis as Ax | undefined
  if (!xa || !ya) return
  const toPx = (a: Ax, v: unknown): number =>
    a._offset + (a.d2p ? a.d2p(v) : typeof v === 'number' ? a.l2p(v) : NaN)
  const ids = (top.customdata ?? []) as string[]
  const xs = top.x as unknown[]
  const ys = top.y as unknown[]
  const sizes = (top.marker?.size ?? []) as number[]
  const fonts = ((top.textfont as { size?: number[] } | undefined)?.size ?? []) as number[]
  const rank = (i: number): number =>
    ids[i] === names.first ? Infinity : (names.priority.get(ids[i]) ?? -Infinity)
  const order = text
    .map((_, i) => i)
    .filter((i) => text[i])
    .sort((a, b) => rank(b) - rank(a) || a - b)
  const kept: Array<[number, number, number, number]> = []
  for (const i of order) {
    const px = toPx(xa, xs[i])
    const py = toPx(ya, ys[i])
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue
    // 'top center': centred over the marker, its baseline just above it
    const fs = fonts[i] ?? 9
    const w = text[i].length * fs * 0.62
    const bottom = py - (sizes[i] ?? 6) / 2 - 1
    const box: [number, number, number, number] = [
      px - w / 2,
      px + w / 2,
      bottom - fs * 1.2,
      bottom
    ]
    if (kept.some((k) => box[0] < k[1] && box[1] > k[0] && box[2] < k[3] && box[3] > k[2]))
      text[i] = ''
    else kept.push(box)
  }
}

/**
 * Apply the active feature selection to a rendered plot in place (never a full re-render): move
 * the overlay to the selected points FIRST — so there is never a frame with the cloud dimmed and
 * nothing drawn on top — then restyle the opacity of the traces whose state changed (see
 * traceSigs). Traces without customdata (guides, PCA) are left untouched.
 */
export function applyHighlight(
  el: PlotlyGraphDiv,
  data: unknown[],
  active: Set<string>,
  bases: BaseOpacity[],
  applied: { current: string[] },
  dimAll: boolean,
  emph: ResolvedHighlight,
  names?: OverlayNames
): void {
  // A chart in a hidden tab is still mounted and still subscribed to the selection.
  // Restyling it would cost as much as a visible one for nothing, so skip — and leave
  // `applied` untouched so the work happens when the tab is shown again.
  if (el.offsetParent === null) return
  try {
    // The overlay is the last trace decorateData appended; locate it on the LIVE list by its flag
    // rather than by index (a concurrent react could reshuffle gd.data). Re-add it only if a view
    // bypassed decorateData somehow.
    const live = (el as unknown as { data?: Trace[] }).data ?? []
    const idx = live.findIndex((t) => t && (t as Record<string, unknown>)[OVERLAY_FLAG])
    const top = buildOverlay(data, dimAll ? new Set() : active, emph)
    if (names) cullOverlayNames(el, top, names)
    if (idx < 0) Plotly.addTraces(el, top)
    else if (!sameOverlay(live[idx], top)) void Plotly.restyle(el, overlayRestyle(top), [idx])
  } catch {
    // A highlight is cosmetic — never let a Plotly hiccup take the panel down.
  }
  // A restyle is a full redraw of that trace, so only touch the traces whose state changed.
  const sigs = traceSigs(data, active, dimAll)
  if (sigs.some((sg, i) => sg !== applied.current[i])) {
    data.forEach((raw, i) => {
      const t = raw as Trace
      if (!sigs[i] || sigs[i] === applied.current[i]) return
      const op = traceOpacity(
        t,
        sigs[i],
        active,
        bases[i] ?? { marker: 0.85, line: 1 },
        emphOf(t, emph).dim
      )
      // A per-bar array goes in a one-trace wrapper (a bare array would read as one value per trace).
      void Plotly.restyle(
        el,
        { [isLine(t) ? 'opacity' : 'marker.opacity']: Array.isArray(op) ? [op] : op },
        [i]
      )
      // A binned bulk's density (densityBins) dims along with its markers.
      const live = (el as unknown as { data?: Trace[] }).data ?? []
      const d = live.findIndex((lt) => lt && (lt as Record<string, unknown>)[DENSITY_OF] === i)
      if (d >= 0)
        void Plotly.restyle(
          el,
          {
            opacity: densityOpacity(
              sigs[i],
              bases[i] ?? { marker: 0.85, line: 1 },
              emphOf(t, emph).dim
            )
          },
          [d]
        )
    })
    applied.current = sigs
  }
}
