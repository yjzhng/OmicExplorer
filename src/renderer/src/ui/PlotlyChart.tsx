import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import Plotly, { type PlotlyGraphDiv } from 'plotly.js-dist-min'

import { Spinner } from './Spinner'
import { useSelection } from './useSelection'

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
  /** gap in px between the marker edge and the label (default 4). Lower = label sits closer. */
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

// Softened so a gene's existing highlight stays visible alongside the hovered/pinned
// one, rather than the plot fading almost to nothing (linked-selection is additive).
const DIM_OPACITY = 0.28
/** Dim applied to EVERY point while a threshold guide is hovered/dragged, so the lines read clearly
 *  against a faded cloud — same strength as the point-hover dim. */
const GUIDE_DIM = DIM_OPACITY
/** Marks the emphasis trace so it can be found again on the live graph div. */
const OVERLAY_FLAG = '__oeOverlay'
/** Selected points are redrawn a few px larger in an overlay trace (see buildOverlay). */
const EMPH_BUMP = 3

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
 * whichever neighbours came later in the same trace. Slightly enlarged and fully
 * opaque, keeping each point's own colour (no outline).
 */
function buildOverlay(data: unknown[], active: Set<string>): Trace | null {
  const x: unknown[] = []
  const y: unknown[] = []
  const size: number[] = []
  const color: (string | number)[] = []
  const text: string[] = []
  // uniqID per overlay point, so a click on the (larger, on-top) emphasis marker can toggle the right
  // gene (see the click handler; the base dot underneath is smaller so its hit area misses the edge).
  const cd: string[] = []
  // A gene often appears in several traces at the SAME spot (its effect group AND a "Selected"/"GOI"
  // emphasis trace), so overlay each id+position ONCE — otherwise it stacks, doubling the marker and
  // label. Keying by position (not id alone) still emphasises a gene that legitimately appears at
  // MULTIPLE spots — e.g. the same leading-edge gene across several GSEA ridges — at each of them.
  const seen = new Set<string>()
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
      if (seen.has(posKey)) return
      seen.add(posKey)
      x.push(xk)
      y.push(yk)
      cd.push(id)
      size.push(at(t.marker?.size, k, 6) + EMPH_BUMP)
      // Numeric → keep the raw value so the overlay's colorscale maps it; else the
      // point's own colour string.
      color.push(
        numeric ? at(mk?.color as number[], k, 0) : at(mk?.color as string | string[], k, '#888')
      )
      // Carry the point's own label so the emphasised gene is named in place — this is
      // what surfaces a name on hover in the scatter/etc. A trace can opt out (bubble,
      // whose gene names already sit on the axis) via __oeNoLabel.
      text.push(
        (t as { __oeNoLabel?: boolean }).__oeNoLabel
          ? ''
          : at(t.text as string | string[] | undefined, k, '')
      )
    })
  }
  if (!x.length) return null
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
    // Selected/hovered gene names in black so they read as the emphasised labels.
    textfont: { size: 10, color: '#000' },
    cliponaxis: false,
    // The underlying point still answers hover; the overlay stays inert to avoid doubled tooltips.
    hoverinfo: 'skip',
    showlegend: false,
    marker: { size, color, opacity: 1, line: { width: 0 }, ...(cmap ?? {}) }
  }
}

/**
 * Apply the active feature selection to a rendered plot by restyling opacity in
 * place (never a full re-render). Marker traces dim non-selected points; line
 * traces (one series per feature) dim the whole trace. Traces without customdata
 * (guides, PCA) are left untouched. Restores from `bases` (see snapshotBases).
 */
function applyHighlight(
  el: PlotlyGraphDiv,
  data: unknown[],
  active: Set<string>,
  bases: BaseOpacity[],
  applied: { current: string[] },
  dimAll = false
): void {
  // A chart in a hidden tab is still mounted and still subscribed to the selection.
  // Restyling it would cost as much as a visible one for nothing, so skip — and leave
  // `applied` untouched so the work happens when the tab is shown again.
  if (el.offsetParent === null) return
  // A restyle is a full redraw of that trace, so first work out which traces would
  // actually LOOK different. Moving the hover between two genes leaves every trace
  // that contains neither one already-dimmed and unchanged — on a dashboard of
  // seven plots that turns N redraws per mouse move into (usually) one.
  // Marker traces dim WHOLESALE (a scalar opacity), not per point: the selected points
  // are redrawn opaque by the overlay on top anyway. That makes the big traces depend
  // only on *whether* something is selected, so moving the hover from one gene to the
  // next leaves them untouched and only the handful of overlay points get restyled —
  // the cost stops scaling with the size of the dataset.
  const sigs = data.map((raw) => {
    const t = raw as Trace
    const ids = traceIds(t)
    // __oeNoOverlay traces carry ids for click/hover linking but manage their own emphasis (e.g. the
    // STRING node trace), so the generic dim/overlay must leave them alone.
    if (!ids || (t as { __oeNoOverlay?: boolean }).__oeNoOverlay) return ''
    // While a threshold guide is active, fade EVERY point so the lines stand out.
    if (dimAll) return 'gdim'
    if (active.size === 0) return 'off'
    return isLine(t) ? (ids.some((id) => active.has(id)) ? 'on' : 'dim') : 'dim'
  })
  const changed = sigs.some((s, i) => s !== applied.current[i])

  if (changed) {
    data.forEach((raw, i) => {
      const t = raw as Trace
      // '' = a trace that opts out (no ids, or __oeNoOverlay: manages its own emphasis). Skip it —
      // otherwise it falls through to the else branch below and gets dimmed to DIM_OPACITY.
      if (!traceIds(t) || sigs[i] === '' || sigs[i] === applied.current[i]) return
      const base = bases[i] ?? { marker: 0.85, line: 1 }
      const key = isLine(t) ? 'opacity' : 'marker.opacity'
      const on = sigs[i] === 'off' || sigs[i] === 'on'
      const op = sigs[i] === 'gdim' ? GUIDE_DIM : on ? (isLine(t) ? base.line : base.marker) : DIM_OPACITY
      void Plotly.restyle(el, { [key]: op }, [i])
    })
    applied.current = sigs
  }
  // Locate the overlay on the LIVE trace list rather than tracking its index: both Plotly.react and a
  // concurrent selection change can reshuffle gd.data, and a stale index would make deleteTraces throw.
  const live = (el as unknown as { data?: Trace[] }).data ?? []
  const found: number[] = []
  live.forEach((t, i) => {
    if (t && (t as Record<string, unknown>)[OVERLAY_FLAG]) found.push(i)
  })
  // No emphasis overlay while dimming for a guide — everything fades uniformly.
  const top = dimAll ? null : buildOverlay(data, active)
  try {
    // Adding/removing a trace forces a structural redraw of the whole plot, too expensive per mouse
    // move — once the overlay exists, move it by restyling its (tiny) coordinate arrays instead.
    if (found.length === 1 && top) {
      void Plotly.restyle(
        el,
        {
          x: [top.x],
          y: [top.y],
          customdata: [top.customdata ?? []],
          text: [top.text],
          'marker.size': [(top.marker as { size: number[] }).size],
          'marker.color': [(top.marker as { color: (string | number)[] }).color]
        },
        found
      )
    } else if (found.length && !top) {
      Plotly.deleteTraces(el, found)
    } else if (found.length > 1 || (found.length && top)) {
      Plotly.deleteTraces(el, found)
      if (top) Plotly.addTraces(el, top)
    } else if (top) {
      Plotly.addTraces(el, top)
    }
  } catch {
    // A highlight is cosmetic — never let a Plotly hiccup take the panel down.
  }
}

/** Candidate label positions around a marker, tried in preference order (above first, then
 *  the sides, then diagonals) — a lightweight ggrepel: each carries how to place the box in
 *  pixel space (relative to the marker at 0,0, screen-y down) and the matching Plotly anchor. */
const GAP = 4
type Side = {
  box: (w: number, h: number, g: number) => { x0: number; x1: number; y0: number; y1: number }
  ann: (g: number) => Record<string, unknown>
}
const SIDES: Side[] = [
  // above
  { box: (w, h, g) => ({ x0: -w / 2, x1: w / 2, y0: -g - h, y1: -g }), ann: (g) => ({ xanchor: 'center', yanchor: 'bottom', xshift: 0, yshift: g }) },
  // below
  { box: (w, h, g) => ({ x0: -w / 2, x1: w / 2, y0: g, y1: g + h }), ann: (g) => ({ xanchor: 'center', yanchor: 'top', xshift: 0, yshift: -g }) },
  // right
  { box: (w, h, g) => ({ x0: g, x1: g + w, y0: -h / 2, y1: h / 2 }), ann: (g) => ({ xanchor: 'left', yanchor: 'middle', xshift: g, yshift: 0 }) },
  // left
  { box: (w, h, g) => ({ x0: -g - w, x1: -g, y0: -h / 2, y1: h / 2 }), ann: (g) => ({ xanchor: 'right', yanchor: 'middle', xshift: -g, yshift: 0 }) },
  // up-right
  { box: (w, h, g) => ({ x0: g, x1: g + w, y0: -g - h, y1: -g }), ann: (g) => ({ xanchor: 'left', yanchor: 'bottom', xshift: g, yshift: g }) },
  // up-left
  { box: (w, h, g) => ({ x0: -g - w, x1: -g, y0: -g - h, y1: -g }), ann: (g) => ({ xanchor: 'right', yanchor: 'bottom', xshift: -g, yshift: g }) },
  // down-right
  { box: (w, h, g) => ({ x0: g, x1: g + w, y0: g, y1: g + h }), ann: (g) => ({ xanchor: 'left', yanchor: 'top', xshift: g, yshift: -g }) },
  // down-left
  { box: (w, h, g) => ({ x0: -g - w, x1: -g, y0: g, y1: g + h }), ann: (g) => ({ xanchor: 'right', yanchor: 'top', xshift: -g, yshift: -g }) }
]
/** Subset that keeps the label ABOVE the marker (box bottom never crosses below it): centred
 *  above, then nudged up-right / up-left. Used for the enrichment ridge, where a label must sit
 *  over its baseline dot and only slide sideways to dodge neighbours — never drop below the ridge. */
const ABOVE_SIDES: Side[] = [SIDES[0], SIDES[4], SIDES[5]]

/** Greedy collision-free label placement for the current view. Reads the live plot geometry
 *  (`_fullLayout._size` + linear axis ranges) so labels are laid out in PIXEL space; each label
 *  tries the eight positions around its marker (above → sides → diagonals) and takes the first
 *  that clears the plot edges and every already-placed box. Labels come pre-sorted by priority,
 *  so the most important genes win the space — and because only points inside the current range
 *  are considered, zooming in frees room and surfaces more of them. */
function placeLabelAnnotations(
  el: PlotlyGraphDiv,
  labels: PlotLabel[],
  color: string,
  base: unknown[],
  sides: Side[] = SIDES,
  active?: Set<string>
): unknown[] | null {
  const fl = (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout
  if (!fl) return null
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
  // Cap the obstacle set so a very dense cloud stays cheap (nearest-priority dots dominate).
  const obstacles = items.length > 1200 ? items.slice(0, 1200) : items

  // Pass 2: place. Try each side; keep the first whose box fits the plot, misses every placed
  // label, and covers no other marker.
  const placed: Array<{ x0: number; x1: number; y0: number; y1: number }> = []
  const out: Record<string, unknown>[] = []
  for (const it of items) {
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
      const bx0 = px + rb.x0
      const bx1 = px + rb.x1
      const by0 = py + rb.y0
      const by1 = py + rb.y1
      if (bx0 < L || bx1 > R || by0 < T || by1 > B) continue // off the plot area
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
      if (!best || clear > best.score)
        best = { box: { x0: bx0, x1: bx1, y0: by0, y1: by1 }, ann: side.ann(g), score: clear }
    }
    if (!best) continue
    placed.push(best.box)
    // When a selection is active, labels whose gene isn't selected fade — so the picked genes'
    // labels stand out. Tagged with the gene id so the selection handler can retint without re-placing.
    const faded = !!active && active.size > 0 && !!it.lab.id && !active.has(it.lab.id)
    out.push({
      x: it.lab.x,
      y: it.lab.y,
      text: it.lab.text,
      xref: 'x',
      yref: 'y',
      showarrow: false,
      ...best.ann,
      font: { size: it.fs, color },
      opacity: faded ? 0.2 : 1,
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
  labelsAbove,
  boldTicks,
  onGraphMount,
  guides,
  onGuide
}: PlotlyChartProps) {
  const ref = useRef<HTMLDivElement>(null)
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
  // Detaches the current legend-hover listeners (rebound after each render, since Plotly
  // rebuilds the legend DOM).
  const legendCleanupRef = useRef<() => void>(() => {})

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
        return R.relayout(el, { 'yaxis.automargin': false, 'margin.l': Math.ceil(l * BOLD_MARGIN_PAD) + 2 })
      })
      .then(() => scheduleLabels()) // legend container-left position depends on the final margin
      .catch(() => {})
  }, [scheduleLabels])

  // Mirror the latest `data` into the ref the once-bound hover/selection handlers read.
  useEffect(() => {
    dataRef.current = data
  }, [data])

  useEffect(() => {
    const el = ref.current as PlotlyGraphDiv | null
    if (!el) return
    let cancelled = false
    // Snapshot base opacities from this render's fresh (un-dimmed) trace objects.
    basesRef.current = snapshotBases(data)
    // New traces carry no highlight yet, so the next apply must not skip them.
    appliedRef.current = []
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
      data,
      {
        autosize: true,
        margin: { l: 55, r: 20, t: 30, b: 45 },
        ...layout,
        // If a guide is under the cursor when this render fires (e.g. a drag's commit), keep hover
        // disabled so the re-render doesn't reset hovermode and let a point tooltip flash back.
        ...(hoverSuppressedRef.current ? { hovermode: false } : {})
      },
      { responsive: true, displaylogo: false }
    ).then(() => {
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
        type Geom = { rect: DOMRect; l: number; t: number; w: number; h: number; xa: PxAxis; ya: PxAxis }
        type PxAxis = { _offset: number; _length: number; range: [number, number]; l2p: (v: number) => number }
        const geom = (): Geom | null => {
          const fl = (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout
          const size = fl?._size as { l: number; t: number; w: number; h: number } | undefined
          const xa = fl?.xaxis as PxAxis | undefined
          const ya = fl?.yaxis as PxAxis | undefined
          if (!size || !xa?.l2p || !ya?.l2p) return null
          return { rect: el.getBoundingClientRect(), ...size, xa, ya }
        }
        const liveShapes = (): Array<Record<string, unknown>> =>
          ((el as unknown as { _fullLayout?: { shapes?: Array<Record<string, unknown>> } })._fullLayout
            ?.shapes ?? []) as Array<Record<string, unknown>>
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
          const mx = g.xa.range[0] + ((clientX - g.rect.left - g.xa._offset) / g.xa._length) * (g.xa.range[1] - g.xa.range[0])
          const my = g.ya.range[0] + (1 - (clientY - g.rect.top - g.ya._offset) / g.ya._length) * (g.ya.range[1] - g.ya.range[0])
          return gd.cursorFn(mx, my)
        }
        // Fade every point while a guide is hovered/dragged (and restore the selection-based highlight
        // on release). Gated so it only restyles on the true/false transitions.
        const setGuideDim = (on: boolean): void => {
          if (guideDimRef.current === on) return
          guideDimRef.current = on
          applyHighlight(el, dataRef.current, activeRef.current, basesRef.current, appliedRef, on)
        }
        const relayoutSafe = (u: Record<string, unknown>): void => {
          try {
            void (Plotly as unknown as { relayout: (e: PlotlyGraphDiv, u: Record<string, unknown>) => Promise<unknown> }).relayout(el, u)
          } catch {
            /* cosmetic */
          }
        }
        // Clear any Plotly hover label (e.g. from a point the cursor passed on the way to a guide) —
        // once we stopPropagation moves to Plotly it never gets the "left the point" event itself.
        const clearHoverLabel = (): void => {
          try {
            ;(Plotly as unknown as { Fx: { unhover: (e: PlotlyGraphDiv) => void } }).Fx.unhover(el)
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
            savedHovermode = (el as unknown as { _fullLayout?: { hovermode?: unknown } })._fullLayout?.hovermode ?? 'closest'
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
        let visPending:
          | { guide: GuideDrag; value: number; origPath: string | null; dy: number; raw?: Record<string, unknown> }
          | null = null
        // Client → data conversion (linear axes).
        const toData = (clientX: number, clientY: number): { x: number; y: number } | null => {
          const g = geom()
          if (!g) return null
          return {
            x: g.xa.range[0] + ((clientX - g.rect.left - g.xa._offset) / g.xa._length) * (g.xa.range[1] - g.xa.range[0]),
            y: g.ya.range[0] + (1 - (clientY - g.rect.top - g.ya._offset) / g.ya._length) * (g.ya.range[1] - g.ya.range[0])
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
            showTip(ev.clientX, ev.clientY, drag.guide.cornerLabel ? drag.guide.cornerLabel(pt.x, pt.y) : '')
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
            showTip(ev.clientX, ev.clientY, drag.guide.format ? drag.guide.format(value) : value.toFixed(2))
            return
          }
          const dPixX = ev.clientX - drag.startX
          const dPixY = ev.clientY - drag.startY
          const dDataX = ((g.xa.range[1] - g.xa.range[0]) * dPixX) / g.xa._length
          const dDataY = ((g.ya.range[1] - g.ya.range[0]) * -dPixY) / g.ya._length
          const value = drag.startValue + (drag.guide.axis === 'x' ? dDataX : dDataY)
          drag.lastValue = value
          scheduleVisual(drag.guide, value, drag.origPath, dDataY)
          showTip(ev.clientX, ev.clientY, drag.guide.format ? drag.guide.format(value) : value.toFixed(2))
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
          if (drag.guide.kind === 'corner') drag.guide.cornerCommit?.(drag.cornerMX, drag.cornerMY)
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
              origPath: hit.kind === 'path' || hit.kind === 'curve' ? String(sh?.path ?? '') : null,
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
      // This render reset the y-tick labels to their base (unbolded) text — force the next selection
      // apply to re-bold by clearing the last-applied signature.
      boldSigRef.current = ''
      // Freeze the left margin with bold headroom so hover-bolding a label can't move it.
      reserveBoldMargin()
      applyHighlight(el, dataRef.current, activeRef.current, basesRef.current, appliedRef, guideDimRef.current)
      scheduleLabels()
      // Rebind legend-hover (the legend DOM was just (re)built).
      rebindDom()
      // (Re)run any bespoke imperative mount (network neighbour highlight), tearing down the prior.
      mountCleanupRef.current?.()
      mountCleanupRef.current = onGraphMountRef.current?.(el) ?? null
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [data, layout, scheduleLabels, rebindDom, reserveBoldMargin])

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
        applyHighlight(el, dataRef.current, active, basesRef.current, appliedRef, guideDimRef.current)
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
        // Fade collision-managed gene labels whose id isn't in the PINNED selection (and restore them
        // when nothing is pinned), retinting in place so labels don't re-place. Hover is excluded so
        // moving the mouse doesn't dim every other label.
        const liveAnns = (el as unknown as { layout?: { annotations?: unknown[] } }).layout
          ?.annotations
        if (Array.isArray(liveAnns)) {
          const pinned = pinnedRef.current
          const upd: Record<string, unknown> = {}
          liveAnns.forEach((a, i) => {
            const lid = (a as { __oeLabelId?: string }).__oeLabelId
            if (typeof lid !== 'string') return
            const op = pinned.size > 0 && !pinned.has(lid) ? 0.2 : 1
            if ((a as { opacity?: number }).opacity !== op) upd[`annotations[${i}].opacity`] = op
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
          guideDimRef.current
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
    scheduleLabels()
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
