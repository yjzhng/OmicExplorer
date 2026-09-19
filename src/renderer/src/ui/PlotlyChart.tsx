import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { createPortal } from 'react-dom'
import Plotly, { type PlotlyGraphDiv } from 'plotly.js-dist-min'

import { applyPlotAxes, PlotAxesContext } from './plotAxes'
import { DEFAULT_HIGHLIGHT, type ResolvedHighlight } from './pointStyle'
import { Spinner } from './Spinner'
import { PALETTES } from './theme'
import { useSelection } from './useSelection'
import { useUiTheme } from './useUiTheme'

/** A point the chart may label. The collision layer places the highest-priority ones that
 *  fit without overlapping, in the CURRENT view — so zooming in reveals more of them. */
export interface PlotLabel {
  x: number
  y: number
  text: string
  /** higher = labelled first when labels compete for space (e.g. −log10 p, |log2FC|) */
  priority: number
  /** marker RADIUS in px (default 4). The label is offset by this + a margin, and every dot is
   *  treated as an obstacle of this radius — so labels of large markers clear their stroke. */
  radius?: number
  /** gap in px between the marker edge and the label (default 2). Lower = label sits closer. */
  margin?: number
  /** font size in px (default 9). Also drives the collision box's width/height estimate. */
  fontSize?: number
  /** feature uniqID — when a linked selection is active, labels whose id isn't selected fade. */
  id?: string
}

interface PlotlyChartProps {
  data: unknown[]
  layout?: Record<string, unknown>
  style?: CSSProperties
  /** Points eligible for collision-managed labelling (scatter/volcano/MA significant genes). */
  labels?: PlotLabel[]
  /** Label text colour (the view's theme text colour). */
  labelColor?: string
  /** Look of the selection emphasis (overlay bump/ring/name) and of the dimmed cloud — a point
   *  plot's per-tile highlight config, resolved. Defaults to the shared DEFAULT_HIGHLIGHT. */
  emphasis?: ResolvedHighlight
  /** Restrict collision-managed labels to positions ABOVE the marker (centred / up-left / up-right)
   *  — labels slide sideways but never drop below or beside the dot. Used by the enrichment ridge. */
  labelsAbove?: boolean
  /** y-axis tick labels to bold when a linked-selected (hovered/pinned) gene belongs to that tick.
   *  `genesByTick[i]` are the genes associated with tick i; `ticktext[i]` is its (possibly rich-text)
   *  label. Applied imperatively on hover so it doesn't reset zoom. Optionally also re-texts the
   *  per-category legend items (each a separate annotation tagged `__oeLegendCat`) so the entries for
   *  the active ticks' categories bold: `categoryByTick[i]` is tick i's category, and
   *  `legendItemText(cat, active)` returns one legend item's text. */
  boldTicks?: {
    genesByTick: string[][]
    /** full tick text for tick i given its state: `active` (a hovered gene is in it) and
     *  `anyActive` (something is hovered) — so non-active ticks can be muted while one is active. */
    tickLabel: (index: number, active: boolean, anyActive: boolean) => string
    /** which axis carries the gene ticks (default 'y'; the bubble puts genes on 'x' in landscape). */
    axis?: 'x' | 'y'
    categoryByTick?: (string | undefined)[]
    /** one legend item's text for the same state, so the active category's entry stands out. */
    legendItemText?: (category: string, active: boolean, anyActive: boolean) => string
  }
  /** Escape hatch for bespoke imperative interactions (e.g. the STRING network's neighbour
   *  highlight): called with the live graph div after each render; return a cleanup run before the
   *  next render and on unmount. Prefer the built-in linked-selection for gene highlighting. */
  onGraphMount?: (el: PlotlyGraphDiv) => (() => void) | void
  /** Draggable threshold guides drawn as `layout.shapes`. A custom drag (not Plotly's built-in
   *  shape editing) constrains each guide to ONE axis so a line never slants, shows a resize
   *  cursor on hover, follows the cursor smoothly, and commits the new value via `onGuide`. */
  guides?: GuideDrag[]
  /** Called with a guide's new value ONCE, on release (`done:true`) — the drag itself only moves the
   *  line(s) and previews the value in a tooltip; re-classification happens on this commit. The view
   *  maps `key` to its own threshold field. */
  onGuide?: (key: string, value: number, done: boolean) => void
}

/** One draggable guide line/curve. `value` is the field it controls (the drag baseline); `key`
 *  routes the new value back through `onGuide`. */
export interface GuideDrag {
  /** index into `layout.shapes` of the line/path to drag */
  shapeIndex: number
  /** the data axis the value lives on; the drag is constrained to it (so a line can't slant) */
  axis: 'x' | 'y'
  /** 'line' moves x0/x1 (or y0/y1) together; 'path' translates the whole curve along the axis;
   *  'point' is a LOCALIZED handle (a short marker) hit-tested by 2-D proximity, moved along its
   *  axis; 'curve' is a path grabbed ANYWHERE and reshaped so it passes through the current mouse
   *  point (the SAM `b` handle) — `solve` maps the mouse point to the new value, `render` rebuilds the
   *  path for the live preview (re-sampled, so it matches the committed shape exactly). */
  kind: 'line' | 'path' | 'point' | 'curve' | 'corner'
  /** 'curve' only: map the current mouse DATA point to the field's new (cropped) value. */
  solve?: (mouseX: number, mouseY: number) => number
  /** 'curve' only: rebuild the full path for a given value, for the live drag preview. */
  render?: (value: number) => string
  /** 'corner' only: a 2-D handle grabbed at the shape's (x0,y0) that adjusts TWO fields at once.
   *  `cornerVisual` returns the relayout updates to move every affected shape live; `cornerCommit`
   *  applies the threshold change on release; `cornerLabel` is the drag tooltip. */
  cornerVisual?: (mouseX: number, mouseY: number) => Record<string, unknown>
  cornerCommit?: (mouseX: number, mouseY: number) => void
  cornerLabel?: (mouseX: number, mouseY: number) => string
  /** CSS cursor while hovering/dragging this guide (e.g. 'ew-resize', 'ns-resize') */
  cursor: string
  /** optional position-dependent cursor (data mouse point → CSS cursor), overriding `cursor` — used
   *  by the SAM curve to show a 45° cursor matching the branch's slope (↘ right, ↗ left). */
  cursorFn?: (mouseX: number, mouseY: number) => string
  /** current value of the field this guide controls — the baseline the drag delta is added to */
  value: number
  /** opaque tag the view uses to route the new value (e.g. the threshold field name) */
  key: string
  /** optional paired shape that mirrors this one about the axis origin (moved to −value while this
   *  guide drags) — used for the symmetric fold-change lines so both track together live. */
  mirrorShapeIndex?: number
  /** optional paired shape moved to the SAME value while this guide drags — used when one logical
   *  line is drawn as two segments (e.g. the volcano's stat line split around the middle gap). */
  syncShapeIndex?: number
  /** 'point' handles only: the CROSS-axis extent is paper-referenced (so the tick can straddle a
   *  plot-edge axis into the margin, which a data-ref shape would clip). The drag-axis coordinate is
   *  still data; only hit-testing the cross-axis centre reads paper. */
  crossPaper?: boolean
  /** label for the drag tooltip previewing the value being set (defaults to the rounded number). */
  format?: (value: number) => string
}

/** Padding (px) between a parked tooltip's text and its box; gap between the point and the box. */
const TIP_PAD = 6
const TIP_GAP = 12

/** Plotly's per-point hover record, as far as parking needs it (internal but long-stable). */
type HoverPt = {
  x?: unknown
  y?: unknown
  pointNumber?: number
  xaxis?: { _offset: number; d2p: (v: unknown) => number }
  yaxis?: { _offset: number; d2p: (v: unknown) => number }
  fullData?: { marker?: { size?: number | number[] } }
}

/**
 * Move Plotly's hover tooltip(s) from beside the hovered point to just BELOW it, centred, so the
 * tooltip never covers the point's own label (drawn above it) or its neighbours' to the sides.
 * Plotly draws each tooltip as `g.hovertext` (a callout `path` plus `text.nums`) and positions the
 * group by transform — this rewrites the transform and the callout into a plain rounded box around
 * the text. The point's pixel position comes from Plotly's own hover record (its axes' data→pixel
 * maps), so the box tracks the point, not the cursor. Kept inside the plot area; flipped above
 * the point only when there's no room below. Several tooltips (hovermode 'x') stack downward.
 * Called from a MutationObserver on the hover layer (see bindHoverParking), so it runs after
 * EVERY tooltip redraw and before the frame paints — never a flash beside the point.
 */
function parkHoverLabels(el: PlotlyGraphDiv, mouseX: number, mouseY: number): void {
  const gd = el as unknown as {
    _fullLayout?: { _size?: { l: number; t: number; w: number; h: number } }
    _hoverdata?: HoverPt[]
  }
  const size = gd._fullLayout?._size
  if (!size) return
  const groups = (el as unknown as Element).querySelectorAll?.('g.hoverlayer g.hovertext')
  if (!groups || !groups.length) return
  // The hovered point's centre and radius (its marker, plus the emphasis overlay's bump + ring
  // when it's the selected one — always assume it, a few px of extra gap costs nothing).
  const pt = gd._hoverdata?.[0]
  let px = mouseX
  let py = mouseY
  let r = 6
  if (pt?.xaxis && pt.yaxis && pt.x !== undefined && pt.y !== undefined) {
    const x = pt.xaxis._offset + pt.xaxis.d2p(pt.x)
    const y = pt.yaxis._offset + pt.yaxis.d2p(pt.y)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      px = x
      py = y
    }
    const ms = pt.fullData?.marker?.size
    const d = Array.isArray(ms) ? ms[pt.pointNumber ?? 0] : ms
    if (typeof d === 'number') r = d / 2
  }
  const boxes: Array<{ g: SVGGElement; w: number; h: number; bx: number; by: number }> = []
  groups.forEach((node) => {
    const g = node as SVGGElement
    const text = g.querySelector('text.nums') as SVGTextElement | null
    const path = g.querySelector('path')
    if (!text || !path) return
    // Left-align the text at the group origin (Plotly may have anchored it end/middle for a
    // left-pointing callout), then measure it.
    text.setAttribute('text-anchor', 'start')
    text.setAttribute('x', '0')
    text.querySelectorAll('tspan').forEach((ts) => {
      if (ts.hasAttribute('x')) ts.setAttribute('x', '0')
    })
    const bb = text.getBBox()
    const w = bb.width + 2 * TIP_PAD
    const h = bb.height + 2 * TIP_PAD
    // A plain rounded box around the text, in the group's coordinates (no callout pointer).
    const bx = bb.x - TIP_PAD
    const by = bb.y - TIP_PAD
    const rr = 4
    path.setAttribute(
      'd',
      `M${bx + rr},${by}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - 2 * rr}` +
        `a${rr},${rr} 0 0 1 -${rr},${rr}h-${w - 2 * rr}a${rr},${rr} 0 0 1 -${rr},-${rr}` +
        `v-${h - 2 * rr}a${rr},${rr} 0 0 1 ${rr},-${rr}z`
    )
    boxes.push({ g, w, h, bx, by })
  })
  const total = boxes.reduce((a, b) => a + b.h, 0) + Math.max(0, boxes.length - 1) * 4
  const L = size.l
  const R = size.l + size.w
  const T = size.t
  const B = size.t + size.h
  // Below the point unless that runs off the plot bottom; then above it instead.
  let y = py + r + TIP_GAP
  if (y + total > B) y = py - r - TIP_GAP - total
  y = Math.max(T, y)
  for (const b of boxes) {
    // Centred under the point, slid back inside the plot's sides.
    const x = Math.min(Math.max(px - b.w / 2, L), R - b.w)
    // Translate so the box's top-left corner lands at (x, y).
    b.g.setAttribute('transform', `translate(${x - b.bx},${y - b.by})`)
    y += b.h + 4
  }
}

/** Watch the hover layer and park each tooltip Plotly draws (parkHoverLabels). Plotly redraws the
 *  tooltip on every mouse move but only emits plotly_hover when the hovered point CHANGES, so an
 *  event-driven move would snap back while the cursor travels within one point; observing the DOM
 *  catches every redraw. The observer's own mutations are discarded (takeRecords) so it can't loop.
 *  The cursor position (the fallback anchor when a hover record has no axes) comes from a native
 *  mousemove on the div. Returns a cleanup that disconnects both. */
function bindHoverParking(el: PlotlyGraphDiv): () => void {
  const layer = (el as unknown as Element).querySelector?.('g.hoverlayer')
  if (!layer) return () => {}
  let mx = 0
  let my = 0
  const onMove = (ev: MouseEvent): void => {
    const rect = el.getBoundingClientRect()
    mx = ev.clientX - rect.left
    my = ev.clientY - rect.top
  }
  el.addEventListener('mousemove', onMove)
  const obs = new MutationObserver(() => {
    parkHoverLabels(el, mx, my)
    obs.takeRecords()
  })
  obs.observe(layer, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['transform', 'd']
  })
  return () => {
    obs.disconnect()
    el.removeEventListener('mousemove', onMove)
  }
}

/** Perpendicular pixel distance from point (px,py) to segment (ax,ay)-(bx,by). */
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** Parse a Plotly path string ("Mx,yLx,y…") into [x,y] data points. */
function parseShapePath(d: string): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  const re = /([-\d.eE+]+),([-\d.eE+]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) pts.push([Number(m[1]), Number(m[2])])
  return pts
}

/** Dim applied to EVERY point while a threshold guide is hovered/dragged, so the lines read clearly
 *  against a faded cloud — same strength as the default point-hover dim. */
const GUIDE_DIM = DEFAULT_HIGHLIGHT.dim
/** Marks the emphasis trace so it can be found again on the live graph div. */
const OVERLAY_FLAG = '__oeOverlay'

type Trace = Record<string, unknown> & {
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

interface BaseOpacity {
  marker: number
  line: number
}

/** Read a possibly-per-point attribute at point `k`. */
const at = <T,>(v: T | T[] | undefined, k: number, fallback: T): T =>
  Array.isArray(v) ? ((v[k] ?? fallback) as T) : (v ?? fallback)

/** A trace is highlightable if it carries a per-point uniqID array in `customdata`. */
function traceIds(t: Trace): string[] | null {
  return Array.isArray(t.customdata) ? (t.customdata as string[]) : null
}
// A trace that draws a line is one series per feature → dim it wholesale (line +
// its markers together). Pure marker traces dim per point.
const isLine = (t: Trace): boolean => typeof t.mode === 'string' && t.mode.includes('lines')

/** Snapshot each trace's configured opacity BEFORE any restyle. Plotly reuses the
 *  passed trace objects as gd.data and restyle mutates them in place, so reading the
 *  "base" opacity back off a trace after a dim would return the dimmed value — the
 *  reset must restore from this snapshot instead. */
function snapshotBases(data: unknown[]): BaseOpacity[] {
  return data.map((raw) => {
    const t = raw as Trace
    // A view may set a per-point marker.opacity array; the hover restore needs a scalar
    // base (restyle would otherwise treat an array as a per-trace value list). Views that
    // want per-point emphasis use marker.color/size instead, which this layer never touches.
    const mo = t.marker?.opacity
    return { marker: typeof mo === 'number' ? mo : 0.85, line: t.opacity ?? 1 }
  })
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
  // uniqID per overlay point, so a click on the (larger, on-top) emphasis marker can toggle the right
  // gene (see the click handler; the base dot underneath is smaller so its hit area misses the edge).
  const cd: string[] = []
  // A gene often appears in several traces at the SAME spot (its effect group AND a "Selected"
  // emphasis trace), so overlay each id+position ONCE — otherwise it stacks, doubling the marker and
  // label. Keying by position (not id alone) still emphasises a gene that legitimately appears at
  // MULTIPLE spots — e.g. the same leading-edge gene across several GSEA ridges — at each of them.
  // posKey → index in the arrays: a point drawn by several traces is emphasised once.
  const seen = new Map<string, number>()
  // When the emphasised points come from a colorscale trace (the bubble's diverging
  // log2FC map), reuse that scale + range so the enlarged point keeps the SAME colour.
  let cmap: Record<string, unknown> | null = null
  for (const raw of data) {
    const t = raw as Trace
    const ids = traceIds(t)
    if (
      !ids ||
      isLine(t) ||
      (t as { __oeNoOverlay?: boolean }).__oeNoOverlay ||
      !Array.isArray(t.x) ||
      !Array.isArray(t.y)
    )
      continue
    const mk = t.marker
    const numeric = Array.isArray(mk?.color) && typeof (mk.color as unknown[])[0] === 'number'
    if (numeric && mk && !cmap) cmap = colorScaleOf(mk)
    ids.forEach((id, k) => {
      if (!active.has(id)) return
      const xk = (t.x as unknown[])[k]
      const yk = (t.y as unknown[])[k]
      const posKey = `${id}|${String(xk)}|${String(yk)}`
      // Sized from the SMALLEST marker drawn at this spot — the cloud's own dot — plus the bump,
      // so emphasis is the same size on every plot regardless of any larger view-level marker.
      const sz = at(t.marker?.size, k, 6) + emph.bump
      const prev = seen.get(posKey)
      if (prev != null) {
        size[prev] = Math.min(size[prev], sz)
        // …but COLOURED from the LAST trace drawn there: Plotly paints later traces on top, so
        // that is the colour the eye sees (e.g. a view's pinned-genes trace in a geneset's colour
        // over the effect-coloured cloud).
        if (!numeric) color[prev] = at(mk?.color as string | string[], k, color[prev] as string)
        return
      }
      seen.set(posKey, x.length)
      x.push(xk)
      y.push(yk)
      cd.push(id)
      size.push(sz)
      // Numeric → keep the raw value so the overlay's colorscale maps it; else the
      // point's own colour string.
      color.push(
        numeric ? at(mk?.color as number[], k, 0) : at(mk?.color as string | string[], k, '#888')
      )
      // Carry the point's own label so the emphasised gene is named in place — this is
      // what surfaces a name on hover in the scatter/etc. A trace can opt out (bubble,
      // whose gene names already sit on the axis) via __oeNoLabel, and a tile's highlight
      // config can switch the names off altogether.
      text.push(
        !emph.label || (t as { __oeNoLabel?: boolean }).__oeNoLabel
          ? ''
          : at(t.text as string | string[] | undefined, k, '')
      )
    })
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
    // Selected/hovered gene names in the theme's text colour (black was invisible on the dark
    // theme — plots draw on a transparent paper over the dark panel), bold so they read as the
    // emphasised labels.
    textfont: { size: emph.labelSize, color: ink, weight: 700 },
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
      line: { width: emph.ring, color: emph.ringColor ?? ink },
      ...(cmap ?? {})
    }
  }
}

/** Per-trace highlight state for the current selection: '' = opts out (no ids, or manages its
 *  own emphasis); 'off' = nothing selected (resting look); 'on' = highlighted (a line series that
 *  holds a selected feature, or a marker trace made ONLY of selected points — a view's own
 *  "Selected" trace, a legend-clicked group); 'dim' = faded; 'gdim' = faded for a guide drag.
 *  Marker traces dim WHOLESALE (a scalar opacity), never per point: the selected points are drawn
 *  opaque by the overlay on top, so a trace's state depends only on WHETHER something is selected —
 *  moving the hover from one gene to the next changes nothing but the overlay. */
function traceSigs(data: unknown[], active: Set<string>, dimAll: boolean): string[] {
  return data.map((raw) => {
    const t = raw as Trace
    const ids = traceIds(t)
    if (!ids || (t as { __oeNoOverlay?: boolean }).__oeNoOverlay) return ''
    if (dimAll) return 'gdim'
    if (active.size === 0) return 'off'
    if (isLine(t)) return ids.some((id) => active.has(id)) ? 'on' : 'dim'
    return ids.length && ids.every((id) => active.has(id)) ? 'on' : 'dim'
  })
}

/** The opacity a trace renders at in a given highlight state. A highlighted MARKER trace is fully
 *  opaque — not its resting value (typically 0.85) — so a highlighted group never looks
 *  translucent. A highlighted LINE trace keeps its resting opacity: 'on' there only means "not
 *  dimmed" (a line trace can be a merged multi-series background at 0.22 holding every gene, and
 *  the emphasised series' own look — width, colour — is the view's), so it must not light up. */
function opacityFor(sig: string, line: boolean, base: BaseOpacity, dim: number): number {
  if (sig === 'gdim') return GUIDE_DIM
  if (sig === 'off') return line ? base.line : base.marker
  if (sig === 'on') return line ? base.line : 1
  return dim
}

/**
 * Layout with every categorical axis pinned strictly categorical. Plotly re-types an axis whenever a
 * trace's x/y data is restyled (as the overlay's is on each hover/pin), and with the default
 * `autotypenumbers: 'convert types'` numeric-looking category strings ("2.5", "10") then flip an
 * explicitly `type: 'category'` axis to linear — even spacing collapses to numeric spacing, and
 * the flip sticks through later renders. 'strict' keeps such strings categorical through any
 * restyle (verified against plotly.js 2.35). Applied centrally so no view needs the workaround.
 */
function strictCategoryAxes(layout: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...layout }
  for (const key of Object.keys(layout)) {
    if (!/^[xy]axis\d*$/.test(key)) continue
    const ax = layout[key] as { type?: unknown; autotypenumbers?: unknown } | undefined
    if (ax && ax.type === 'category' && ax.autotypenumbers === undefined)
      out[key] = { ...ax, autotypenumbers: 'strict' }
  }
  return out
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
  if (ax.length !== bx.length) return false
  for (let i = 0; i < ax.length; i++)
    if (ax[i] !== bx[i] || ay[i] !== by[i] || as[i] !== bs[i]) return false
  return true
}

/** The restyle payload that moves the (single, permanent) overlay trace to a new set of points. */
function overlayRestyle(top: Trace): Record<string, unknown[]> {
  const mk = top.marker as Record<string, unknown> & { line?: { color?: string; width?: number } }
  const u: Record<string, unknown[]> = {
    x: [top.x],
    y: [top.y],
    customdata: [top.customdata ?? []],
    text: [top.text],
    'marker.size': [mk.size],
    'marker.color': [mk.color],
    'marker.line.color': [mk.line?.color],
    'marker.line.width': [mk.line?.width]
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
function decorateData(
  data: unknown[],
  active: Set<string>,
  bases: BaseOpacity[],
  dimAll: boolean,
  emph: ResolvedHighlight
): { traces: unknown[]; sigs: string[] } {
  const sigs = traceSigs(data, active, dimAll)
  const traces = data.map((raw, i) => {
    const t = raw as Trace
    if (!sigs[i]) return raw
    const op = opacityFor(sigs[i], isLine(t), bases[i] ?? { marker: 0.85, line: 1 }, emph.dim)
    return isLine(t)
      ? { ...t, opacity: op }
      : { ...t, marker: { ...(t.marker ?? {}), opacity: op } }
  })
  traces.push(buildOverlay(data, dimAll ? new Set() : active, emph))
  return { traces, sigs }
}

/**
 * Apply the active feature selection to a rendered plot in place (never a full re-render): move
 * the overlay to the selected points FIRST — so there is never a frame with the cloud dimmed and
 * nothing drawn on top — then restyle the opacity of the traces whose state changed (see
 * traceSigs). Traces without customdata (guides, PCA) are left untouched.
 */
function applyHighlight(
  el: PlotlyGraphDiv,
  data: unknown[],
  active: Set<string>,
  bases: BaseOpacity[],
  applied: { current: string[] },
  dimAll: boolean,
  emph: ResolvedHighlight
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
      const op = opacityFor(sigs[i], isLine(t), bases[i] ?? { marker: 0.85, line: 1 }, emph.dim)
      void Plotly.restyle(el, { [isLine(t) ? 'opacity' : 'marker.opacity']: op }, [i])
    })
    applied.current = sigs
  }
}

/** Candidate label positions around a marker, tried in preference order (above first, then
 *  the sides, then diagonals) — a lightweight ggrepel: each carries how to place the box in
 *  pixel space (relative to the marker at 0,0, screen-y down) and the matching Plotly anchor. */
const GAP = 2
/** A label gets a leader line back to its dot when EITHER
 *   - it's AMBIGUOUS: some OTHER dot (any dot the plot draws, not just label candidates) sits
 *     about as close to the label box as the labelled dot does — within LEADER_SLACK px of that
 *     gap — so a reader could attach the name to the wrong point. Only dots within LEADER_RANGE
 *     px of the labelled dot are considered: a dot on the far side of a wide label isn't a
 *     plausible alternative; or
 *   - it's FAR: the label's anchor sits more than LEADER_FAR × its default offset from the dot
 *     (a label slid along a plot edge), where the eye no longer pairs the two on its own. */
const LEADER_SLACK = 4
const LEADER_RANGE = 40
const LEADER_FAR = 1.5
type Side = {
  box: (w: number, h: number, g: number) => { x0: number; x1: number; y0: number; y1: number }
  ann: (g: number) => Record<string, unknown>
}
const SIDES: Side[] = [
  // above
  {
    box: (w, h, g) => ({ x0: -w / 2, x1: w / 2, y0: -g - h, y1: -g }),
    ann: (g) => ({ xanchor: 'center', yanchor: 'bottom', xshift: 0, yshift: g })
  },
  // below
  {
    box: (w, h, g) => ({ x0: -w / 2, x1: w / 2, y0: g, y1: g + h }),
    ann: (g) => ({ xanchor: 'center', yanchor: 'top', xshift: 0, yshift: -g })
  },
  // right
  {
    box: (w, h, g) => ({ x0: g, x1: g + w, y0: -h / 2, y1: h / 2 }),
    ann: (g) => ({ xanchor: 'left', yanchor: 'middle', xshift: g, yshift: 0 })
  },
  // left
  {
    box: (w, h, g) => ({ x0: -g - w, x1: -g, y0: -h / 2, y1: h / 2 }),
    ann: (g) => ({ xanchor: 'right', yanchor: 'middle', xshift: -g, yshift: 0 })
  },
  // up-right
  {
    box: (w, h, g) => ({ x0: g, x1: g + w, y0: -g - h, y1: -g }),
    ann: (g) => ({ xanchor: 'left', yanchor: 'bottom', xshift: g, yshift: g })
  },
  // up-left
  {
    box: (w, h, g) => ({ x0: -g - w, x1: -g, y0: -g - h, y1: -g }),
    ann: (g) => ({ xanchor: 'right', yanchor: 'bottom', xshift: -g, yshift: g })
  },
  // down-right
  {
    box: (w, h, g) => ({ x0: g, x1: g + w, y0: g, y1: g + h }),
    ann: (g) => ({ xanchor: 'left', yanchor: 'top', xshift: g, yshift: -g })
  },
  // down-left
  {
    box: (w, h, g) => ({ x0: -g - w, x1: -g, y0: g, y1: g + h }),
    ann: (g) => ({ xanchor: 'right', yanchor: 'top', xshift: -g, yshift: -g })
  }
]
/** Subset that keeps the label ABOVE the marker (box bottom never crosses below it): centred
 *  above, then nudged up-right / up-left. Used for the enrichment ridge, where a label must sit
 *  over its baseline dot and only slide sideways to dodge neighbours — never drop below the ridge. */
const ABOVE_SIDES: Side[] = [SIDES[0], SIDES[4], SIDES[5]]

/** Which candidates get a label (local density — see below) and, for those, greedy collision-free
 *  placement for the current view. Reads the live plot geometry
 *  (`_fullLayout._size` + linear axis ranges) so labels are laid out in PIXEL space; each label
 *  tries the eight positions around its marker (above → sides → diagonals) and takes the first
 *  that clears the plot edges and every already-placed box. Labels come pre-sorted by priority,
 *  so the most important genes win the space — and because only points inside the current range
 *  are considered, zooming in frees room and surfaces more of them. */
/** The ONE rule for a collision-managed gene label's visibility, used both when labels are placed
 *  (after a render) and when they're adjusted in place (on a selection change) — the two passes
 *  must agree or a re-render flashes the other state until the next selection event:
 *   - an ACTIVE gene's (pinned or hovered) label is hidden: the overlay names it, bold, at the
 *     point, and a second label for it reads as a duplicate;
 *   - while anything is active (pinned OR hovered), every other gene's label is hidden too, so
 *     only the selection stays named and the tooltip sits on a clear cloud. Nothing active →
 *     everything shows. */
function labelOpacity(id: string | undefined, active: Set<string>): number {
  if (!id) return 1
  return active.size > 0 ? 0 : 1
}

function placeLabelAnnotations(
  el: PlotlyGraphDiv,
  labels: PlotLabel[],
  color: string,
  base: unknown[],
  sides: Side[] = SIDES,
  active: Set<string> = new Set(),
  pinned: Set<string> = new Set()
): unknown[] | null {
  const fl = (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout
  if (!fl) return null
  // A pinned gene is never a candidate: the overlay names it, and leaving it out frees its spot
  // for a neighbour. (A merely hovered gene keeps its slot — hidden via labelOpacity — so labels
  // don't re-place on every mouse move.)
  if (pinned.size) labels = labels.filter((lab) => !lab.id || !pinned.has(lab.id))
  const size = fl._size as { l: number; t: number; w: number; h: number } | undefined
  const xa = fl.xaxis as { range?: [number, number] } | undefined
  const ya = fl.yaxis as { range?: [number, number] } | undefined
  if (!size || !xa?.range || !ya?.range) return null
  const [x0, x1] = xa.range
  const [y0, y1] = ya.range
  const dx = x1 - x0 || 1
  const dy = y1 - y0 || 1
  const FS = 9 // default label font size (px); per-label overridable via lab.fontSize
  const MAX = 80 // hard cap so a huge cloud can't spawn thousands of annotations
  const inX = (x: number): boolean => (x0 < x1 ? x >= x0 && x <= x1 : x >= x1 && x <= x0)
  const inY = (y: number): boolean => (y0 < y1 ? y >= y0 && y <= y1 : y >= y1 && y <= y0)
  const L = size.l
  const R = size.l + size.w
  const T = size.t
  const B = size.t + size.h
  const PR = 4 // marker radius to keep labels clear of dots

  // Pass 1: pixel positions of every in-view candidate. These double as MARKER OBSTACLES —
  // a label avoids sitting on ANY dot, which is what pushes labels off a dense cloud onto the
  // side/diagonal positions instead of everything stacking straight up. Priority order is kept.
  const items: Array<{
    lab: PlotLabel
    px: number
    py: number
    w: number
    lh: number
    fs: number
    r: number
  }> = []
  for (const lab of labels) {
    if (!lab.text || !inX(lab.x) || !inY(lab.y)) continue
    const fs = lab.fontSize ?? FS
    const CHAR = fs * 0.58 // rough advance width per character at this font size
    items.push({
      lab,
      fs,
      lh: fs * 1.2,
      px: L + ((lab.x - x0) / dx) * size.w,
      py: T + (1 - (lab.y - y0) / dy) * size.h,
      w: Math.max(lab.text.length * CHAR, CHAR),
      r: lab.radius ?? PR
    })
  }
  // Whether to label at all is decided by LOCAL DENSITY, not by the view's ranking: a label in a
  // crowded region is clutter whatever the gene's score, and an isolated point can carry one
  // legibly. Density is measured in PIXELS over every marker the plot draws (the whole cloud, not
  // just the candidates), so it follows the zoom — zoom into a dense wing and its points thin out
  // and gain labels. The gate is RELATIVE to this plot: a candidate is eligible when its
  // neighbourhood holds at most DENSE_FRAC of the densest neighbourhood any candidate sits in
  // (an absolute count fails both ways — too strict on a big dataset, where a visibly sparse wing
  // still has dozens of points per label-sized square, and moot on a small one). A small absolute
  // floor keeps a uniformly sparse plot labelling freely. Density decides ONLY eligibility: the
  // eligible are placed in the view's own order (most differentiated first), so when space runs
  // out it's the least relevant that go, not the least isolated. Collision testing below (labels
  // may not overlap or cover a marker) then decides WHERE — and prunes what a looser gate lets in.
  const CELL = 12 // px — about a label's height; the neighbourhood is the 3×3 cells around a point
  const DENSE_FRAC = 0.25 // of the peak candidate-neighbourhood density
  const DENSE_FLOOR = 8 // always eligible at or below this many neighbours
  const cells = new Map<string, number>()
  // The same grid also keeps every marker's position + radius, for the leader-line ambiguity test
  // (which must see the whole cloud, grey dots included — not only the label candidates).
  const cellDots = new Map<string, Array<{ px: number; py: number; r: number }>>()
  const cellKey = (px: number, py: number): string =>
    `${Math.floor(px / CELL)},${Math.floor(py / CELL)}`
  const live = (el as unknown as { data?: Trace[] }).data ?? []
  for (const t of live) {
    if (!t || (t as Record<string, unknown>)[OVERLAY_FLAG]) continue
    if (typeof t.mode !== 'string' || !t.mode.includes('markers')) continue
    const xs = t.x as unknown[]
    const ys = t.y as unknown[]
    if (!Array.isArray(xs) || !Array.isArray(ys)) continue
    const ms = t.marker?.size
    for (let k = 0; k < xs.length; k++) {
      const x = xs[k]
      const y = ys[k]
      if (typeof x !== 'number' || typeof y !== 'number' || !inX(x) || !inY(y)) continue
      const mpx = L + ((x - x0) / dx) * size.w
      const mpy = T + (1 - (y - y0) / dy) * size.h
      const key = cellKey(mpx, mpy)
      cells.set(key, (cells.get(key) ?? 0) + 1)
      const d = Array.isArray(ms) ? ms[k] : ms
      const dot = { px: mpx, py: mpy, r: (typeof d === 'number' ? d : 6) / 2 }
      const arr = cellDots.get(key)
      if (arr) arr.push(dot)
      else cellDots.set(key, [dot])
    }
  }
  /** Every drawn marker within LEADER_RANGE (Chebyshev) of a point. */
  const dotsNear = (px: number, py: number): Array<{ px: number; py: number; r: number }> => {
    const reach = Math.ceil(LEADER_RANGE / CELL)
    const cx = Math.floor(px / CELL)
    const cy = Math.floor(py / CELL)
    const found: Array<{ px: number; py: number; r: number }> = []
    for (let i = -reach; i <= reach; i++)
      for (let j = -reach; j <= reach; j++) {
        const arr = cellDots.get(`${cx + i},${cy + j}`)
        if (!arr) continue
        for (const d of arr)
          if (Math.abs(d.px - px) <= LEADER_RANGE && Math.abs(d.py - py) <= LEADER_RANGE)
            found.push(d)
      }
    return found
  }
  const densityAt = (px: number, py: number): number => {
    const cx = Math.floor(px / CELL)
    const cy = Math.floor(py / CELL)
    let n = 0
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) n += cells.get(`${cx + i},${cy + j}`) ?? 0
    return n
  }
  const dens = items.map((it) => densityAt(it.px, it.py))
  const peak = dens.reduce((m, d) => Math.max(m, d), 0)
  const denseMax = Math.max(DENSE_FLOOR, DENSE_FRAC * peak)
  const labelable = items.filter((_, i) => dens[i] <= denseMax)
  // Cap the obstacle set so a very dense cloud stays cheap (nearest-priority dots dominate).
  const obstacles = items.length > 1200 ? items.slice(0, 1200) : items

  // Pass 2: place. Try each side; keep the first whose box fits the plot, misses every placed
  // label, and covers no other marker.
  const placed: Array<{ x0: number; x1: number; y0: number; y1: number }> = []
  const out: Record<string, unknown>[] = []
  for (const it of labelable) {
    if (out.length >= MAX) break
    const { px, py, w } = it
    // Offset the label by the marker's own radius + a margin, so a big dot's label clears its
    // stroke instead of sitting on it.
    const g = it.r + (it.lab.margin ?? GAP)
    // Evaluate ALL eight sides and keep the one with the most clearance from surrounding dots,
    // so labels genuinely fan out instead of every one taking the first-fitting "above". Ties
    // keep the earlier (preferred) side, since we only replace on a strictly better score.
    let best: {
      box: { x0: number; x1: number; y0: number; y1: number }
      ann: Record<string, unknown>
      score: number
    } | null = null
    for (const side of sides) {
      const rb = side.box(w, it.lh, g)
      // A box that would run off the plot area is slid back inside along that edge (and the
      // annotation shifted by the same amount) rather than rejected — a long label on a point
      // near the edge used to lose its centred/outer sides outright and, with neighbours on the
      // remaining side, go unlabelled although it sat alone.
      const slideX = rb.x0 + px < L ? L - (rb.x0 + px) : rb.x1 + px > R ? R - (rb.x1 + px) : 0
      const slideY = rb.y0 + py < T ? T - (rb.y0 + py) : rb.y1 + py > B ? B - (rb.y1 + py) : 0
      const bx0 = px + rb.x0 + slideX
      const bx1 = px + rb.x1 + slideX
      const by0 = py + rb.y0 + slideY
      const by1 = py + rb.y1 + slideY
      if (bx0 < L || bx1 > R || by0 < T || by1 > B) continue // wider than the plot itself
      // Never slide a label so far that it covers its own dot.
      if (slideX || slideY) {
        if (bx0 < px + it.r && bx1 > px - it.r && by0 < py + it.r && by1 > py - it.r) continue
      }
      let bad = false
      for (const b of placed) {
        if (bx0 < b.x1 && bx1 > b.x0 && by0 < b.y1 && by1 > b.y0) {
          bad = true
          break
        }
      }
      if (bad) continue
      // Reject any side covering another marker (each dot uses its OWN radius); otherwise score it
      // by the nearest dot's distance² (its own dot is fine — the offset already clears it).
      let clear = Infinity
      for (const o of obstacles) {
        if (o === it) continue
        if (bx0 < o.px + o.r && bx1 > o.px - o.r && by0 < o.py + o.r && by1 > o.py - o.r) {
          bad = true
          break
        }
        const cdx = Math.max(bx0 - o.px, 0, o.px - bx1)
        const cdy = Math.max(by0 - o.py, 0, o.py - by1)
        const d2 = cdx * cdx + cdy * cdy
        if (d2 < clear) clear = d2
      }
      if (bad) continue
      if (!best || clear > best.score) {
        const ann = side.ann(g) as { xshift: number; yshift: number }
        best = {
          box: { x0: bx0, x1: bx1, y0: by0, y1: by1 },
          // yshift is in screen-up units, the box in screen-down px.
          ann: { ...ann, xshift: ann.xshift + slideX, yshift: ann.yshift - slideY },
          score: clear
        }
      }
    }
    if (!best) continue
    placed.push(best.box)
    // Ambiguity test (see LEADER_SLACK): the gap from a dot's edge to the nearest point of the
    // label box, for the labelled dot and for every other drawn dot near it. If any rival is
    // about as close to the box as the labelled dot — the box may even be approached from a
    // different side — the label gets a leader line: it's drawn in Plotly's arrow form, a
    // headless line from the dot's CENTRE (no standoff, so it unmistakably starts in the dot it
    // belongs to) to the text box, which Plotly clips at the box edge. The arrow's tail is the
    // text's anchor point, so the box is re-expressed anchored at its CENTRE (ax/ay = the centre's
    // offset from the dot, screen-down px): aimed at an edge anchor instead, a label slid along
    // the plot edge would get a line running along its underside rather than into it.
    const { x0: bx0, x1: bx1, y0: by0, y1: by1 } = best.box
    const gapTo = (qx: number, qy: number, qr: number): number =>
      Math.hypot(Math.max(bx0 - qx, 0, qx - bx1), Math.max(by0 - qy, 0, qy - by1)) - qr
    const own = gapTo(px, py, it.r)
    let ambiguous = false
    for (const d of dotsNear(px, py)) {
      if (Math.abs(d.px - px) < 0.5 && Math.abs(d.py - py) < 0.5) continue // the dot itself
      if (gapTo(d.px, d.py, d.r) <= own + LEADER_SLACK) {
        ambiguous = true
        break
      }
    }
    const ann = best.ann as { xshift: number; yshift: number }
    // Anchor offset from the dot centre (the default is g straight out, g·√2 on a diagonal; any
    // slide adds to it) — past LEADER_FAR × the default the label is "far".
    const far = Math.hypot(ann.xshift, ann.yshift) > LEADER_FAR * g
    const pos =
      ambiguous || far
        ? {
            xanchor: 'center',
            yanchor: 'middle',
            xshift: 0,
            yshift: 0,
            showarrow: true,
            ax: (bx0 + bx1) / 2 - px,
            ay: (by0 + by1) / 2 - py,
            arrowhead: 0,
            arrowwidth: 1,
            arrowcolor: color,
            standoff: 0
          }
        : { ...ann, showarrow: false }
    // Tagged with the gene id so the selection handler can adjust visibility without re-placing.
    out.push({
      x: it.lab.x,
      y: it.lab.y,
      text: it.lab.text,
      xref: 'x',
      yref: 'y',
      ...pos,
      font: { size: it.fs, color },
      opacity: labelOpacity(it.lab.id, active),
      __oeLabelId: it.lab.id,
      captureevents: false
    })
  }
  // Reposition any base annotation that opted into container-left alignment: `paper` x=0 is the plot
  // area's left edge, so to reach the figure's true left edge (past the auto-sized y-tick margin) we
  // offset left by the computed margin as a fraction of the plot width. Recomputed here so it tracks
  // automargin / resize / zoom. The flag is stripped from the output.
  const CONTAINER_PAD = 20 // px inset from the figure's left edge so the legend isn't flush against it
  const containerX = size.w > 0 ? -((size.l - CONTAINER_PAD) / size.w) : 0
  const adjBase = base.map((a) => {
    const ann = { ...(a as Record<string, unknown>) }
    if (!ann.__oeAlignContainerLeft) return a
    delete ann.__oeAlignContainerLeft
    ann.xref = 'paper'
    ann.xanchor = 'left'
    ann.x = containerX
    return ann
  })
  return [...adjBase, ...out]
}

/** Wire the (native-eventless) legend so hovering a per-gene legend entry drives the linked
 *  hover-highlight — used by DR/TR, whose legend items each stand for ONE gene. Maps the k-th
 *  legend item to the k-th legend-visible trace and, when that trace carries a single uniqID
 *  (all its points are one gene), hover/leave set/clear the selection hover. Group legends
 *  (volcano effects, cluster swatches, …) carry mixed or no ids, so they're left inert.
 *  Returns a cleanup that detaches the listeners. */
function bindLegendHover(el: PlotlyGraphDiv): () => void {
  const items = (el as unknown as Element).querySelectorAll?.('g.legend g.traces')
  if (!items || !items.length) return () => {}
  const live = (el as unknown as { data?: Trace[] }).data ?? []
  const legendTraces = live.filter((t) => {
    const tt = t as Trace & { showlegend?: boolean; visible?: unknown }
    return tt.showlegend !== false && tt.visible !== false
  })
  const uniformId = (t: Trace): string | null => {
    const cd = t.customdata
    if (!Array.isArray(cd) || cd.length === 0) return null
    const first = cd[0]
    if (typeof first !== 'string') return null
    for (const v of cd) if (v !== first) return null
    return first
  }
  const cleanups: Array<() => void> = []
  items.forEach((node, k) => {
    const t = legendTraces[k]
    const id = t ? uniformId(t) : null
    if (!id) return
    const enter = (): void => useSelection.getState().setHover(id)
    const leave = (): void => useSelection.getState().clearHover()
    node.addEventListener('mouseenter', enter)
    node.addEventListener('mouseleave', leave)
    ;(node as HTMLElement).style.cursor = 'pointer'
    cleanups.push(() => {
      node.removeEventListener('mouseenter', enter)
      node.removeEventListener('mouseleave', leave)
    })
  })
  return () => {
    for (const c of cleanups) c()
  }
}

/** Thin React wrapper over plotly.js-dist-min (bundled locally — CSP-safe, no CDN). */
export function PlotlyChart({
  data,
  layout,
  style,
  labels,
  labelColor,
  emphasis = DEFAULT_HIGHLIGHT,
  labelsAbove,
  boldTicks,
  onGraphMount,
  guides,
  onGuide
}: PlotlyChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  // The tile's per-axis overrides (title, fonts, range, ticks, …), merged over the view's layout
  // at render (see plotAxes.ts). Provided by the tile so no view has to thread it.
  const axes = useContext(PlotAxesContext)
  // Floating tooltip that previews a guide's value while it's being dragged.
  const tipRef = useRef<HTMLDivElement>(null)
  // Buffering: show a spinner until the FIRST Plotly render resolves, then never again (updates
  // to an already-drawn chart shouldn't flash a spinner). No delay — the tile's DeferredMount
  // spinner is torn down the moment this mounts, so showing ours immediately keeps the buffering
  // continuous through the (sometimes slow) Plotly draw instead of leaving a blank gap.
  const [ready, setReady] = useState(false)

  // Latest data/active read imperatively so event handlers bind once (no stale closures).
  // Init-only here; kept current via the effect below (ref writes during render are unsafe).
  const dataRef = useRef(data)
  // Base opacities captured per render (Plotly mutates the trace objects on restyle).
  const basesRef = useRef<BaseOpacity[]>([])
  // Per-trace signature of the highlight last pushed to Plotly (see applyHighlight).
  const appliedRef = useRef<string[]>([])
  // The highlight look every apply site draws with; mirrored from the prop (see the effect below).
  const emphRef = useRef<ResolvedHighlight>(emphasis)

  // Selection is read IMPERATIVELY (not via a useSelection hook) so a hover anywhere doesn't
  // re-render every mounted chart — with many charts on a dashboard that made every hover
  // laggy. The affected traces are restyled directly instead (mirrors DataTableView's paint).
  const activeRef = useRef<Set<string>>(new Set())
  // Just the PINNED (click-selected) ids — used to fade non-selected gene labels. Kept separate from
  // `activeRef` (which also folds in the transient hover) so a hover doesn't dim every other label.
  const pinnedRef = useRef<Set<string>>(new Set())
  // True while a threshold guide is hovered/dragged → applyHighlight fades every point (read by all
  // apply sites so a concurrent selection change keeps the cloud dimmed).
  const guideDimRef = useRef(false)
  // True while the cursor is over a guide (hover OR drag) → Plotly hover is disabled so it can't
  // focus/tooltip the point beneath the line. Read by the render effect so a commit's re-render
  // keeps hover suppressed instead of resetting hovermode.
  const hoverSuppressedRef = useRef(false)
  // y-tick bolding (enrichment ridge): kept in a ref so the once-bound selection handler sees the
  // latest without rebinding; `boldSig` is the last-applied bold pattern to skip redundant relayouts.
  const boldTicksRef = useRef(boldTicks)
  const boldSigRef = useRef('')
  // Bespoke imperative interaction (network neighbour highlight): kept in a ref so re-mounts see the
  // latest; `mountCleanup` runs the previous mount's teardown before re-mounting / on unmount.
  const onGraphMountRef = useRef(onGraphMount)
  const mountCleanupRef = useRef<(() => void) | null>(null)
  // Guide-drag config + callback, kept in refs so the once-bound drag handlers always see the latest
  // (the guide `value` baselines update every render as the threshold changes).
  const guidesRef = useRef(guides)
  const onGuideRef = useRef(onGuide)

  // Collision-managed gene labels. Pre-sorted by priority (most important first); the placement
  // pass keeps as many as fit the current view. Read imperatively from refs so the (once-bound)
  // relayout/resize handlers always see the latest without rebinding.
  const sortedLabels = useMemo(
    () => (labels ? [...labels].sort((a, b) => b.priority - a.priority) : undefined),
    [labels]
  )
  // Init-only; kept in sync via the label effect below (writing refs during render is unsafe).
  const labelsRef = useRef(sortedLabels)
  const labelColorRef = useRef(labelColor)
  const labelsAboveRef = useRef(labelsAbove)
  // Annotations the VIEW put in `layout` (e.g. cluster arrows) — labels are appended to these,
  // never replacing them.
  const baseAnnotsRef = useRef<unknown[]>([])
  const labelRaf = useRef(0)
  /** True from the start of a Plotly.react until it resolves (see the react effect). */
  const reactPendingRef = useRef(false)
  // Detaches the current legend-hover listeners (rebound after each render, since Plotly
  // rebuilds the legend DOM).
  const legendCleanupRef = useRef<() => void>(() => {})
  // Detaches the tooltip-parking observer (rebound with the legend, in case a render rebuilt the
  // svg framework and with it the hover layer).
  const hoverParkCleanupRef = useRef<() => void>(() => {})

  const placeLabels = useCallback((): void => {
    const el = ref.current as PlotlyGraphDiv | null
    const labs = labelsRef.current
    if (!el || !labs) return // this chart opted out of auto-labels
    const merged = placeLabelAnnotations(
      el,
      labs,
      labelColorRef.current ?? '#888',
      baseAnnotsRef.current,
      labelsAboveRef.current ? ABOVE_SIDES : SIDES,
      activeRef.current,
      pinnedRef.current
    )
    if (merged) {
      // Only annotations change here (never the axis range), so this can't recurse into the
      // relayout handler, which reacts to xaxis/yaxis keys. (`relayout` isn't in the minified
      // type defs, hence the cast.)
      try {
        void (
          Plotly as unknown as {
            relayout: (el: PlotlyGraphDiv, u: Record<string, unknown>) => Promise<unknown>
          }
        ).relayout(el, { annotations: merged })
      } catch {
        /* labels are cosmetic — never take the panel down */
      }
    }
  }, [])
  const scheduleLabels = useCallback((): void => {
    cancelAnimationFrame(labelRaf.current)
    labelRaf.current = requestAnimationFrame(placeLabels)
  }, [placeLabels])

  // (Re)attach the legend-hover listeners. Plotly rebuilds the legend DOM on render, resize, and
  // zoom, so this runs after each of those.
  const rebindDom = useCallback((): void => {
    const el = ref.current as PlotlyGraphDiv | null
    if (!el) return
    legendCleanupRef.current()
    legendCleanupRef.current = bindLegendHover(el)
    hoverParkCleanupRef.current()
    hoverParkCleanupRef.current = bindHoverParking(el)
  }, [])

  // With bold-on-hover tick labels, bolding a label makes it wider — automargin would then re-measure
  // and the left margin would jump. So once automargin has sized the base (non-bold) labels, pin the
  // left margin a bit wider (headroom for the bold weight) and turn automargin OFF, so hovering can't
  // move the margin. Re-run after each render (which resets automargin ON via the passed layout).
  const BOLD_MARGIN_PAD = 1.12
  const reserveBoldMargin = useCallback((): void => {
    const el = ref.current as PlotlyGraphDiv | null
    // Only the y-axis (enrichment) case needs the left-margin reserve; an x-axis gene tick (bubble
    // landscape) relies on automargin and must not have its left margin pinned.
    if (!el || !boldTicksRef.current || (boldTicksRef.current.axis ?? 'y') !== 'y') return
    const R = Plotly as unknown as {
      relayout: (e: PlotlyGraphDiv, u: Record<string, unknown>) => Promise<unknown>
    }
    const readL = (): number | undefined =>
      (el as unknown as { _fullLayout?: { _size?: { l: number } } })._fullLayout?._size?.l
    // MUST measure from automargin each time (idempotent). Plotly.react's minimal diff compares the
    // new layout to the LAST one it was given, not the live gd state — so our prior imperative pin
    // survives a re-render, and reading the current margin would compound it (runaway growth). So
    // first force automargin ON with a small base margin to measure the true required width for the
    // base (non-bold) labels, then pin a bit wider with automargin OFF so hover-bolding can't move it.
    void R.relayout(el, { 'yaxis.automargin': true, 'margin.l': 6 })
      .then(() => {
        const l = readL()
        if (!l || !(l > 0)) return undefined
        return R.relayout(el, {
          'yaxis.automargin': false,
          'margin.l': Math.ceil(l * BOLD_MARGIN_PAD) + 2
        })
      })
      .then(() => scheduleLabels()) // legend container-left position depends on the final margin
      .catch(() => {})
  }, [scheduleLabels])

  // Mirror the latest `data` / highlight look into the refs the once-bound hover/selection
  // handlers read.
  useEffect(() => {
    dataRef.current = data
  }, [data])
  useEffect(() => {
    emphRef.current = emphasis
  }, [emphasis])

  useEffect(() => {
    const el = ref.current as PlotlyGraphDiv | null
    if (!el) return
    let cancelled = false
    // A placement scheduled while this render is in flight would measure the OLD plot and could
    // land after it — the render's own completion schedules the (only) placement instead.
    reactPendingRef.current = true
    // Snapshot base opacities from this render's fresh (un-dimmed) trace objects.
    basesRef.current = snapshotBases(data)
    // Render with the current highlight already baked in (dims + overlay), so this pass shows the
    // final look at once; record the baked state so the in-place apply below skips those traces.
    const baked = decorateData(
      data,
      activeRef.current,
      basesRef.current,
      guideDimRef.current,
      emphasis
    )
    appliedRef.current = baked.sigs
    // Remember any view-owned annotations so the label pass appends to (not replaces) them. Clone
    // each object: Plotly mutates the layout we pass it (and strips unknown keys like our
    // __oeAlignContainerLeft flag), which would otherwise break re-placement on zoom/resize.
    baseAnnotsRef.current = Array.isArray(layout?.annotations)
      ? (layout!.annotations as unknown[]).map((a) =>
          a && typeof a === 'object' ? { ...(a as Record<string, unknown>) } : a
        )
      : []
    void Plotly.react(
      el,
      baked.traces,
      {
        autosize: true,
        margin: { l: 55, r: 20, t: 30, b: 45 },
        ...strictCategoryAxes(applyPlotAxes(layout ?? {}, axes, data)),
        // If a guide is under the cursor when this render fires (e.g. a drag's commit), keep hover
        // disabled so the re-render doesn't reset hovermode and let a point tooltip flash back.
        ...(hoverSuppressedRef.current ? { hovermode: false } : {})
      },
      { responsive: true, displaylogo: false }
    )
      .then(() => {
        if (cancelled) return
        // Bind linked-selection events once per graph div (idempotent).
        const div = el as PlotlyGraphDiv & { __oeBound?: boolean }
        if (!div.__oeBound) {
          div.__oeBound = true
          // Set while a threshold-guide drag is in progress (and until the trailing click), so the
          // gene-select handlers don't treat the drag's mouseup/click as a point selection.
          let guideDragging = false
          // Set while the cursor is over a threshold guide, so hovering it doesn't highlight the gene
          // point beneath (plotly_hover still fires for the point under the line).
          let overGuide = false
          const idAt = (e: { points?: Array<{ customdata?: unknown }> }): string | null => {
            const cd = e.points?.[0]?.customdata
            return typeof cd === 'string' ? cd : null
          }
          // Show a pointer cursor over a clickable gene point (any point carrying a uniqID), so it
          // reads as "click to select". Applied to Plotly's drag layers (inline style beats their
          // cursor-* class); cleared on unhover so pan/zoom cursors return.
          const setDragCursor = (cursor: string): void => {
            el.querySelectorAll('.nsewdrag').forEach((d) => {
              ;(d as SVGElement & { style: CSSStyleDeclaration }).style.cursor = cursor
            })
          }
          el.on('plotly_hover', (e) => {
            if (overGuide) return // over a threshold line — don't highlight the point beneath it
            const id = idAt(e)
            if (id) {
              useSelection.getState().setHover(id)
              setDragCursor('pointer')
            }
          })
          el.on('plotly_unhover', () => {
            useSelection.getState().clearHover()
            setDragCursor('')
          })
          // Plotly reliably fires plotly_click for MARKER points. For pure LINE traces (DR/TR
          // curves) it often doesn't, so a native-click fallback pins whatever gene is currently
          // hovered — guarded by `clickHandled` so a marker click never toggles twice.
          let clickHandled = false
          el.on('plotly_click', (e) => {
            if (guideDragging) return // a guide drag, not a gene click
            const id = idAt(e)
            if (id) {
              clickHandled = true
              useSelection.getState().togglePin(id)
            }
          })
          el.addEventListener(
            'click',
            (ev) => {
              // A threshold-guide drag just ended — swallow its trailing click so it doesn't select a
              // gene. Do NOT clear the flag here: plotly_click fires later (bubble) in the same dispatch
              // and must stay suppressed too; onDragUp clears the flag on the next tick.
              if (guideDragging) return
              // Legend clicks are handled by plotly_legendclick — don't double-fire.
              if ((ev.target as Element | null)?.closest?.('.legend')) return
              // Snapshot the hovered gene NOW — the deferred check might run after hover cleared.
              const hoverAtClick = useSelection.getState().hoverId
              // Defer so a (bubble-phase) plotly_click, if any, sets the flag first.
              setTimeout(() => {
                if (clickHandled) {
                  clickHandled = false
                  return
                }
                if (hoverAtClick) useSelection.getState().togglePin(hoverAtClick)
              }, 0)
            },
            true // capture phase: fires even if Plotly's drag layer stops the bubbling click
          )
          el.on('plotly_doubleclick', () => useSelection.getState().clearPins())
          // Clicking a legend group HIGHLIGHTS its genes (pins them) instead of hiding the trace —
          // returning false suppresses Plotly's default show/hide. Only gene traces (those with a
          // uniqID array in customdata) are intercepted; other legends keep the default behaviour.
          const groupIds = (curve: number): string[] | null => {
            const cd = ((el as unknown as { data?: Trace[] }).data ?? [])[curve]?.customdata
            return Array.isArray(cd) && cd.length && typeof cd[0] === 'string'
              ? (cd as string[])
              : null
          }
          const legendEvents = el as unknown as {
            on: (ev: string, cb: (e: { curveNumber: number }) => boolean | void) => void
          }
          legendEvents.on('plotly_legendclick', (e) => {
            const ids = groupIds(e.curveNumber)
            if (!ids) return true // non-gene legend → default (show/hide)
            useSelection.getState().togglePins(ids)
            return false
          })
          legendEvents.on('plotly_legenddoubleclick', (e) => {
            const ids = groupIds(e.curveNumber)
            if (!ids) return true
            useSelection.getState().clearPins()
            return false
          })
          // Re-place labels whenever the VIEW RANGE changes (zoom / pan / autorange reset), so a
          // zoomed-in view surfaces labels that were crowded out at full extent. Match only range keys
          // ('xaxis.range[0]', 'yaxis.autorange', …) — NOT our own cosmetic writes (yaxis.ticktext,
          // annotations[i].text, margin.l), which would otherwise re-run placement and clobber the
          // hover bolding we just applied to the ticks/legend.
          ;(
            el as unknown as { on: (ev: string, cb: (ed: Record<string, unknown>) => void) => void }
          ).on('plotly_relayout', (ed) => {
            if (Object.keys(ed ?? {}).some((k) => k.includes('range'))) {
              scheduleLabels()
              rebindDom() // ticks (and legend) re-render on zoom/pan → reattach hover listeners
            }
          })

          // ── draggable threshold guides (custom drag; see `guides`/`onGuide`) ───────────────
          // Constrained to one axis so a line never slants, follows the cursor smoothly via a cheap
          // per-shape relayout, and commits the new value throttled to ~300ms so the plot
          // re-classifies live without a full rebuild on every mouse move.
          const HIT_TOL = 6 // px proximity that counts as "over" a guide
          type Geom = {
            rect: DOMRect
            l: number
            t: number
            w: number
            h: number
            xa: PxAxis
            ya: PxAxis
          }
          type PxAxis = {
            _offset: number
            _length: number
            range: [number, number]
            l2p: (v: number) => number
          }
          const geom = (): Geom | null => {
            const fl = (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout
            const size = fl?._size as { l: number; t: number; w: number; h: number } | undefined
            const xa = fl?.xaxis as PxAxis | undefined
            const ya = fl?.yaxis as PxAxis | undefined
            if (!size || !xa?.l2p || !ya?.l2p) return null
            return { rect: el.getBoundingClientRect(), ...size, xa, ya }
          }
          const liveShapes = (): Array<Record<string, unknown>> =>
            ((el as unknown as { _fullLayout?: { shapes?: Array<Record<string, unknown>> } })
              ._fullLayout?.shapes ?? []) as Array<Record<string, unknown>>
          // Which guide (if any) sits under a client point.
          const guideAt = (clientX: number, clientY: number): GuideDrag | null => {
            const gs = guidesRef.current
            if (!gs?.length) return null
            const g = geom()
            if (!g) return null
            const sx = clientX - g.rect.left
            const sy = clientY - g.rect.top
            const [left, top, right, bottom] = [g.l, g.t, g.l + g.w, g.t + g.h]
            const shapes = liveShapes()
            for (const gd of gs) {
              const sh = shapes[gd.shapeIndex]
              if (!sh) continue
              if (gd.kind === 'line') {
                // Constrain the grab zone to the line's actual SEGMENT extent (its endpoints), not the
                // whole axis — so the hidden parts of a cropped line (e.g. the volcano's bracket segments)
                // aren't draggable.
                if (gd.axis === 'x') {
                  const lx = g.xa._offset + g.xa.l2p(sh.x0 as number)
                  const ey0 = g.ya._offset + g.ya.l2p(sh.y0 as number)
                  const ey1 = g.ya._offset + g.ya.l2p(sh.y1 as number)
                  const yMin = Math.min(ey0, ey1) - HIT_TOL
                  const yMax = Math.max(ey0, ey1) + HIT_TOL
                  if (Math.abs(sx - lx) <= HIT_TOL && sy >= yMin && sy <= yMax) return gd
                } else {
                  const ly = g.ya._offset + g.ya.l2p(sh.y0 as number)
                  const ex0 = g.xa._offset + g.xa.l2p(sh.x0 as number)
                  const ex1 = g.xa._offset + g.xa.l2p(sh.x1 as number)
                  const xMin = Math.min(ex0, ex1) - HIT_TOL
                  const xMax = Math.max(ex0, ex1) + HIT_TOL
                  if (Math.abs(sy - ly) <= HIT_TOL && sx >= xMin && sx <= xMax) return gd
                }
              } else if (gd.kind === 'corner') {
                // A 2-D handle grabbed at the shape's (x0,y0) — the bracket corner (±fc, statMin).
                const cx = g.xa._offset + g.xa.l2p(sh.x0 as number)
                const cy = g.ya._offset + g.ya.l2p(sh.y0 as number)
                if (Math.hypot(sx - cx, sy - cy) <= HIT_TOL + 4) return gd
              } else if (gd.kind === 'point') {
                // Localized marker (a short tick): grab it only NEAR its centre, in 2-D. The cross-axis
                // extent may be paper-referenced (a tick straddling a plot-edge axis) — read that
                // centre from paper, and the drag-axis centre from data.
                const mx = ((sh.x0 as number) + (sh.x1 as number)) / 2
                const my = ((sh.y0 as number) + (sh.y1 as number)) / 2
                const xPaper = gd.crossPaper && gd.axis === 'y'
                const yPaper = gd.crossPaper && gd.axis === 'x'
                const cx = xPaper ? g.l + mx * g.w : g.xa._offset + g.xa.l2p(mx)
                const cy = yPaper ? g.t + (1 - my) * g.h : g.ya._offset + g.ya.l2p(my)
                if (Math.hypot(sx - cx, sy - cy) <= HIT_TOL + 4) return gd
              } else if (sx >= left && sx <= right && sy >= top && sy <= bottom) {
                const pts = parseShapePath(String(sh.path ?? ''))
                let min = Infinity
                for (let i = 1; i < pts.length && min > HIT_TOL; i++) {
                  const ax = g.xa._offset + g.xa.l2p(pts[i - 1][0])
                  const ay = g.ya._offset + g.ya.l2p(pts[i - 1][1])
                  const bx = g.xa._offset + g.xa.l2p(pts[i][0])
                  const by = g.ya._offset + g.ya.l2p(pts[i][1])
                  min = Math.min(min, distToSeg(sx, sy, ax, ay, bx, by))
                }
                if (min <= HIT_TOL) return gd
              }
            }
            return null
          }
          // Resolve a guide's cursor at a client point (position-dependent via cursorFn, e.g. the SAM
          // curve's 45° cursor that follows the branch).
          const cursorFor = (gd: GuideDrag, clientX: number, clientY: number): string => {
            if (!gd.cursorFn) return gd.cursor
            const g = geom()
            if (!g) return gd.cursor
            const mx =
              g.xa.range[0] +
              ((clientX - g.rect.left - g.xa._offset) / g.xa._length) *
                (g.xa.range[1] - g.xa.range[0])
            const my =
              g.ya.range[0] +
              (1 - (clientY - g.rect.top - g.ya._offset) / g.ya._length) *
                (g.ya.range[1] - g.ya.range[0])
            return gd.cursorFn(mx, my)
          }
          // Fade every point while a guide is hovered/dragged (and restore the selection-based highlight
          // on release). Gated so it only restyles on the true/false transitions.
          const setGuideDim = (on: boolean): void => {
            if (guideDimRef.current === on) return
            guideDimRef.current = on
            applyHighlight(
              el,
              dataRef.current,
              activeRef.current,
              basesRef.current,
              appliedRef,
              on,
              emphRef.current
            )
          }
          const relayoutSafe = (u: Record<string, unknown>): void => {
            try {
              void (
                Plotly as unknown as {
                  relayout: (e: PlotlyGraphDiv, u: Record<string, unknown>) => Promise<unknown>
                }
              ).relayout(el, u)
            } catch {
              /* cosmetic */
            }
          }
          // Clear any Plotly hover label (e.g. from a point the cursor passed on the way to a guide) —
          // once we stopPropagation moves to Plotly it never gets the "left the point" event itself.
          const clearHoverLabel = (): void => {
            try {
              ;(Plotly as unknown as { Fx: { unhover: (e: PlotlyGraphDiv) => void } }).Fx.unhover(
                el
              )
            } catch {
              /* cosmetic */
            }
          }
          // Hovering the line takes focus off the point beneath it: while over a guide, disable Plotly
          // hover entirely (it can't focus/tooltip a point, and a redraw can't re-show a stale label).
          // Restored to the saved mode when the cursor leaves the guide.
          let savedHovermode: unknown
          const suppressHover = (on: boolean): void => {
            if (hoverSuppressedRef.current === on) return
            hoverSuppressedRef.current = on
            if (on) {
              savedHovermode =
                (el as unknown as { _fullLayout?: { hovermode?: unknown } })._fullLayout
                  ?.hovermode ?? 'closest'
              relayoutSafe({ hovermode: false })
              clearHoverLabel()
            } else {
              relayoutSafe({ hovermode: savedHovermode ?? 'closest' })
            }
          }

          // Active drag state + rAF plumbing (persist across events via this closure). The threshold
          // is committed only on RELEASE — during the drag the line(s) follow the cursor imperatively
          // (no re-classification), and a tooltip previews the value being set.
          let drag: {
            guide: GuideDrag
            startX: number
            startY: number
            startValue: number
            origPath: string | null
            lastValue: number
            cornerMX: number
            cornerMY: number
          } | null = null
          let prevGuideHover = false // last frame we set a guide cursor (to know when to release it)
          let visRaf = 0
          let visPending: {
            guide: GuideDrag
            value: number
            origPath: string | null
            dy: number
            raw?: Record<string, unknown>
          } | null = null
          // Client → data conversion (linear axes).
          const toData = (clientX: number, clientY: number): { x: number; y: number } | null => {
            const g = geom()
            if (!g) return null
            return {
              x:
                g.xa.range[0] +
                ((clientX - g.rect.left - g.xa._offset) / g.xa._length) *
                  (g.xa.range[1] - g.xa.range[0]),
              y:
                g.ya.range[0] +
                (1 - (clientY - g.rect.top - g.ya._offset) / g.ya._length) *
                  (g.ya.range[1] - g.ya.range[0])
            }
          }
          const showTip = (clientX: number, clientY: number, text: string): void => {
            const t = tipRef.current
            if (!t) return
            // Positioned in VIEWPORT coords (the element is portaled to <body>, so it isn't clipped by
            // the tile's overflow or offset by react-grid-layout's transform).
            t.textContent = text
            t.style.left = `${clientX + 12}px`
            t.style.top = `${clientY - 10}px`
            t.hidden = false
          }
          const hideTip = (): void => {
            if (tipRef.current) tipRef.current.hidden = true
          }
          const applyVisual = (): void => {
            visRaf = 0
            const p = visPending
            if (!p) return
            const i = p.guide.shapeIndex
            const upd: Record<string, unknown> = p.raw ? { ...p.raw } : {}
            if (p.raw) {
              // Pre-built multi-shape update (corner drag) — apply as-is.
            } else if (p.guide.kind === 'line' || p.guide.kind === 'point') {
              // A 'point' marker is a short segment moved along its axis (both endpoints together),
              // same as a line — only its hit-testing differs.
              const coord = p.guide.axis === 'x' ? 'x' : 'y'
              upd[`shapes[${i}].${coord}0`] = p.value
              upd[`shapes[${i}].${coord}1`] = p.value
              // Symmetric partner (fold-change lines): mirror it about the origin so both track together.
              if (p.guide.mirrorShapeIndex != null) {
                upd[`shapes[${p.guide.mirrorShapeIndex}].${coord}0`] = -p.value
                upd[`shapes[${p.guide.mirrorShapeIndex}].${coord}1`] = -p.value
              }
              // Same-value partner (one line drawn as two segments): move it to the SAME value.
              if (p.guide.syncShapeIndex != null) {
                upd[`shapes[${p.guide.syncShapeIndex}].${coord}0`] = p.value
                upd[`shapes[${p.guide.syncShapeIndex}].${coord}1`] = p.value
              }
            } else if (p.guide.kind === 'curve' && p.guide.render) {
              // Rebuild the whole curve for the new value — re-sampled, so the preview extends toward
              // the asymptote exactly like the committed shape (a captured-path scale would crop flat).
              upd[`shapes[${i}].path`] = p.guide.render(p.value)
            } else if (p.origPath != null) {
              // Translate the captured curve by the vertical delta (uniform y translate).
              const pts = parseShapePath(p.origPath)
              upd[`shapes[${i}].path`] = pts
                .map(([x, y], k) => `${k ? 'L' : 'M'}${x},${y + p.dy}`)
                .join('')
            }
            try {
              void (
                Plotly as unknown as {
                  relayout: (e: PlotlyGraphDiv, u: Record<string, unknown>) => Promise<unknown>
                }
              ).relayout(el, upd)
            } catch {
              /* cosmetic */
            }
          }
          const scheduleVisual = (
            guide: GuideDrag,
            value: number,
            origPath: string | null,
            dy: number,
            raw?: Record<string, unknown>
          ): void => {
            visPending = { guide, value, origPath, dy, raw }
            if (!visRaf) visRaf = requestAnimationFrame(applyVisual)
          }
          const onDragMove = (ev: MouseEvent): void => {
            if (!drag) return
            ev.preventDefault()
            ev.stopPropagation()
            const g = geom()
            if (!g) return
            // A 'corner' handle adjusts TWO fields: the view builds the live multi-shape update and the
            // tooltip from the current mouse DATA point.
            if (drag.guide.kind === 'corner') {
              const pt = toData(ev.clientX, ev.clientY)
              if (!pt) return
              drag.cornerMX = pt.x
              drag.cornerMY = pt.y
              const raw = drag.guide.cornerVisual ? drag.guide.cornerVisual(pt.x, pt.y) : {}
              scheduleVisual(drag.guide, 0, null, 0, raw)
              showTip(
                ev.clientX,
                ev.clientY,
                drag.guide.cornerLabel ? drag.guide.cornerLabel(pt.x, pt.y) : ''
              )
              return
            }
            // A 'curve' reshapes to pass through the CURRENT mouse point: the view's solver turns that
            // point into the new value. Everything else reports an absolute value = baseline + delta.
            if (drag.guide.kind === 'curve' && drag.guide.solve) {
              const pt = toData(ev.clientX, ev.clientY)
              if (!pt) return
              const value = drag.guide.solve(pt.x, pt.y)
              drag.lastValue = value
              scheduleVisual(drag.guide, value, drag.origPath, 0) // visual re-samples via guide.render(value)
              setDragCursor(cursorFor(drag.guide, ev.clientX, ev.clientY)) // 45° cursor follows the branch
              showTip(
                ev.clientX,
                ev.clientY,
                drag.guide.format ? drag.guide.format(value) : value.toFixed(2)
              )
              return
            }
            const dPixX = ev.clientX - drag.startX
            const dPixY = ev.clientY - drag.startY
            const dDataX = ((g.xa.range[1] - g.xa.range[0]) * dPixX) / g.xa._length
            const dDataY = ((g.ya.range[1] - g.ya.range[0]) * -dPixY) / g.ya._length
            const value = drag.startValue + (drag.guide.axis === 'x' ? dDataX : dDataY)
            drag.lastValue = value
            scheduleVisual(drag.guide, value, drag.origPath, dDataY)
            showTip(
              ev.clientX,
              ev.clientY,
              drag.guide.format ? drag.guide.format(value) : value.toFixed(2)
            )
          }
          const onDragUp = (ev: MouseEvent): void => {
            if (!drag) return
            ev.preventDefault()
            ev.stopPropagation()
            document.removeEventListener('mousemove', onDragMove, true)
            document.removeEventListener('mouseup', onDragUp, true)
            hideTip()
            // Don't restore hover here — the cursor is still over the (moved) line, so it stays
            // suppressed; the hover handler restores it when the cursor actually leaves the guide.
            if (drag.guide.kind === 'corner')
              drag.guide.cornerCommit?.(drag.cornerMX, drag.cornerMY)
            else onGuideRef.current?.(drag.guide.key, drag.lastValue, true) // commit once, on release
            drag = null
            // Safety: if no trailing click fires (e.g. released off the element), clear the flag on the
            // next tick so a later genuine click still selects. A real trailing click clears it first.
            setTimeout(() => {
              guideDragging = false
            }, 0)
          }
          el.addEventListener(
            'mousedown',
            (ev) => {
              const hit = guideAt(ev.clientX, ev.clientY)
              if (!hit) return
              ev.preventDefault()
              ev.stopPropagation() // block Plotly's own zoom/pan on this gesture
              guideDragging = true // suppress the trailing click's gene-select
              setGuideDim(true) // keep the cloud faded through the drag
              suppressHover(true) // (already suppressed from hover, but be safe if a drag starts cold)
              clearHoverLabel()
              const sh = liveShapes()[hit.shapeIndex]
              drag = {
                guide: hit,
                startX: ev.clientX,
                startY: ev.clientY,
                startValue: hit.value,
                origPath:
                  hit.kind === 'path' || hit.kind === 'curve' ? String(sh?.path ?? '') : null,
                lastValue: hit.value,
                cornerMX: 0,
                cornerMY: 0
              }
              setDragCursor(cursorFor(hit, ev.clientX, ev.clientY))
              showTip(ev.clientX, ev.clientY, hit.format ? hit.format(hit.value) : '')
              document.addEventListener('mousemove', onDragMove, true)
              document.addEventListener('mouseup', onDragUp, true)
            },
            true // capture: run before Plotly's drag-layer handlers
          )
          // Resize cursor while hovering a guide (only when not dragging or hovering a gene point).
          el.addEventListener(
            'mousemove',
            (ev) => {
              if (drag) return
              const hit = guideAt(ev.clientX, ev.clientY)
              overGuide = !!hit
              if (hit) {
                suppressHover(true) // over the line → hover focuses the line, not the point beneath it
                setDragCursor(cursorFor(hit, ev.clientX, ev.clientY))
                prevGuideHover = true
                if (useSelection.getState().hoverId) useSelection.getState().clearHover()
                setGuideDim(true) // fade all points so the line stands out
              } else if (prevGuideHover) {
                suppressHover(false) // left the guide → hover returns to normal
                setDragCursor('') // back to default (gene hover re-sets its pointer)
                prevGuideHover = false
                setGuideDim(false)
              }
            },
            true // capture: run before Plotly's drag-layer hover so we can suppress it
          )
        }
        reactPendingRef.current = false
        // This render reset the y-tick labels to their base (unbolded) text — force the next selection
        // apply to re-bold by clearing the last-applied signature.
        boldSigRef.current = ''
        // Freeze the left margin with bold headroom so hover-bolding a label can't move it.
        reserveBoldMargin()
        applyHighlight(
          el,
          dataRef.current,
          activeRef.current,
          basesRef.current,
          appliedRef,
          guideDimRef.current,
          emphRef.current
        )
        scheduleLabels()
        // Rebind legend-hover (the legend DOM was just (re)built).
        rebindDom()
        // (Re)run any bespoke imperative mount (network neighbour highlight), tearing down the prior.
        mountCleanupRef.current?.()
        mountCleanupRef.current = onGraphMountRef.current?.(el) ?? null
        setReady(true)
      })
      // A failed render must not leave placement deferred forever.
      .catch(() => {
        reactPendingRef.current = false
      })
    return () => {
      cancelled = true
    }
  }, [data, layout, axes, emphasis, scheduleLabels, rebindDom, reserveBoldMargin])

  // Drive the highlight from the selection store imperatively: subscribe once, restyle the
  // affected traces on change (rAF-coalesced so a mouse sweep is one redraw), WITHOUT
  // re-rendering this React component — so N mounted charts don't all re-render per hover.
  useEffect(() => {
    const el = ref.current as PlotlyGraphDiv | null
    if (!el) return
    let raf = 0
    const apply = (): void => {
      const { hoverId, pinnedIds } = useSelection.getState()
      const active = new Set(pinnedIds)
      if (hoverId) active.add(hoverId)
      activeRef.current = active
      pinnedRef.current = new Set(pinnedIds)
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        applyHighlight(
          el,
          dataRef.current,
          active,
          basesRef.current,
          appliedRef,
          guideDimRef.current,
          emphRef.current
        )
        // Bold the y-tick label of any pathway containing an active (hovered/pinned) gene, and (when
        // provided) rebuild the category legend so the active pathways' categories bold too.
        const bt = boldTicksRef.current
        if (bt) {
          const boldRow = bt.genesByTick.map((g) => g.some((x) => active.has(x)))
          const anyActive = boldRow.some(Boolean)
          const sig = boldRow.map((b) => (b ? '1' : '0')).join('')
          if (sig !== boldSigRef.current) {
            boldSigRef.current = sig
            const tt = boldRow.map((on, i) => bt.tickLabel(i, on, anyActive))
            const update: Record<string, unknown> = { [`${bt.axis ?? 'y'}axis.ticktext`]: tt }
            // Legend: re-text each per-category item (separate annotations, fixed positions) so the
            // active category's entry stands out and the others mute — without shifting them.
            const legendItemText = bt.legendItemText
            if (legendItemText && bt.categoryByTick) {
              const activeCats = new Set<string>()
              boldRow.forEach((b, i) => {
                const c = bt.categoryByTick![i]
                if (b && c) activeCats.add(c)
              })
              baseAnnotsRef.current.forEach((a, idx) => {
                const cat = (a as Record<string, unknown>)?.__oeLegendCat
                if (typeof cat === 'string')
                  update[`annotations[${idx}].text`] = legendItemText(
                    cat,
                    activeCats.has(cat),
                    activeCats.size > 0
                  )
              })
            }
            try {
              void (
                Plotly as unknown as {
                  relayout: (el: PlotlyGraphDiv, u: Record<string, unknown>) => Promise<unknown>
                }
              ).relayout(el, update)
            } catch {
              /* cosmetic */
            }
          }
        }
        // Collision-managed gene labels, adjusted in place (so they don't re-place) by the same
        // rule the placement pass uses (see labelOpacity).
        const liveAnns = (el as unknown as { layout?: { annotations?: unknown[] } }).layout
          ?.annotations
        if (Array.isArray(liveAnns)) {
          const upd: Record<string, unknown> = {}
          liveAnns.forEach((a, i) => {
            const lid = (a as { __oeLabelId?: string }).__oeLabelId
            if (typeof lid !== 'string') return
            const op = labelOpacity(lid, active)
            // Also write the value onto the live object so a placement that lands between this
            // read and the relayout can't leave the two out of step.
            if ((a as { opacity?: number }).opacity !== op) {
              ;(a as { opacity?: number }).opacity = op
              upd[`annotations[${i}].opacity`] = op
            }
          })
          if (Object.keys(upd).length) {
            try {
              void (
                Plotly as unknown as {
                  relayout: (el: PlotlyGraphDiv, u: Record<string, unknown>) => Promise<unknown>
                }
              ).relayout(el, upd)
            } catch {
              /* cosmetic */
            }
          }
        }
      })
    }
    apply()
    const unsub = useSelection.subscribe(apply)
    return () => {
      cancelAnimationFrame(raf)
      unsub()
    }
  }, [])

  // Plotly's `plotly_unhover` doesn't reliably fire when the cursor leaves the plot
  // (e.g. exits fast), which would leave points stuck dimmed. Clear on native leave.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onLeave = (): void => useSelection.getState().clearHover()
    el.addEventListener('mouseleave', onLeave)
    return () => el.removeEventListener('mouseleave', onLeave)
  }, [])

  // Plotly's `responsive:true` only reacts to window resize, not container resize.
  // In the reconfigurable dashboard a tile resizes without the window changing, so
  // observe the element and tell Plotly to re-fit (rAF-debounced against drag churn).
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (el.offsetParent === null) return
        Plotly.Plots.resize(el)
        // Also the moment a hidden tab is revealed (0×0 → sized): flush the highlight
        // that was skipped while it was hidden.
        applyHighlight(
          el as unknown as PlotlyGraphDiv,
          dataRef.current,
          activeRef.current,
          basesRef.current,
          appliedRef,
          guideDimRef.current,
          emphRef.current
        )
        // The plot area changed size — labels must be re-placed against the new geometry, and the
        // legend/tick DOM re-rendered, so reattach their hover listeners.
        scheduleLabels()
        rebindDom()
      })
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [scheduleLabels, rebindDom])

  // Re-place labels when the candidate set or colour changes (a new comparison, theme flip, or
  // a selection that reshuffles which genes are pre-labelled by their own traces). Sync the refs
  // the (once-bound) handlers read, then schedule a placement.
  useEffect(() => {
    labelsRef.current = sortedLabels
    labelColorRef.current = labelColor
    labelsAboveRef.current = labelsAbove
    // New candidates usually arrive together with new data: that render places them when it
    // completes (see the react effect). Placing now too would measure the outgoing plot.
    if (!reactPendingRef.current) scheduleLabels()
  }, [sortedLabels, labelColor, labelsAbove, scheduleLabels])

  // Keep the (once-bound) selection handler's view of the bold-tick config current.
  useEffect(() => {
    boldTicksRef.current = boldTicks
    boldSigRef.current = '' // config changed → re-evaluate on the next selection apply
  }, [boldTicks])

  useEffect(() => {
    onGraphMountRef.current = onGraphMount
  }, [onGraphMount])

  useEffect(() => {
    guidesRef.current = guides
    onGuideRef.current = onGuide
  }, [guides, onGuide])

  useEffect(() => {
    const el = ref.current as PlotlyGraphDiv | null
    return () => {
      cancelAnimationFrame(labelRaf.current)
      legendCleanupRef.current()
      hoverParkCleanupRef.current()
      mountCleanupRef.current?.()
      if (el) {
        el.removeAllListeners?.('plotly_hover')
        el.removeAllListeners?.('plotly_unhover')
        el.removeAllListeners?.('plotly_click')
        el.removeAllListeners?.('plotly_doubleclick')
        el.removeAllListeners?.('plotly_legendclick')
        el.removeAllListeners?.('plotly_legenddoubleclick')
        el.removeAllListeners?.('plotly_relayout')
        Plotly.purge(el)
      }
    }
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={ref} style={{ width: '100%', height: '100%', ...style }} />
      {!ready && <Spinner />}
      {/* Drag preview: portaled to <body> so the tile's overflow can't crop it. Positioned
          imperatively (viewport coords) while a guide is being dragged. */}
      {createPortal(<div ref={tipRef} hidden style={tipStyle} />, document.body)}
    </div>
  )
}

/** Floating tooltip for the guide-drag value preview (positioned imperatively during a drag). */
const tipStyle: CSSProperties = {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: 2000,
  background: 'rgba(20,20,20,0.85)',
  color: '#fff',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap'
}
