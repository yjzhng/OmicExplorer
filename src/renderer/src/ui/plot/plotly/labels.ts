/** The plots' collision-managed point labels (a lightweight ggrepel): which candidate labels fit
 *  the current view, where each sits around its dot, and the leader lines back to it. */
import { type PlotlyGraphDiv } from 'plotly.js-strict-dist-min'
import { truncateLabel } from '../plotAxes'
import { BIN_EXTENT, BIN_POINTS } from '../densityBins'
import { PLOT_TEXT } from '../../app/theme'
import { OVERLAY_FLAG, type Trace } from './highlight'

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
  /** this label's text colour (its group's — see labelColorOf); unset = the chart's `labelColor` */
  color?: string
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
export const SIDES: Side[] = [
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
export const ABOVE_SIDES: Side[] = [SIDES[0], SIDES[4], SIDES[5]]

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
export function labelOpacity(id: string | undefined, active: Set<string>, inPlace = false): number {
  if (!id) return 1
  if (inPlace && active.has(id)) return 1
  return active.size > 0 ? 0 : 1
}

/** A collision-managed label's text in its state: bold while its gene is active in place
 *  (labelsInPlace), else as given. */
export const labelText = (
  text: string,
  id: string | undefined,
  active: Set<string>,
  inPlace: boolean
) => (inPlace && id && active.has(id) ? `<b>${text}</b>` : text)

export function placeLabelAnnotations(
  el: PlotlyGraphDiv,
  labels: PlotLabel[],
  color: string,
  base: unknown[],
  sides: Side[] = SIDES,
  active: Set<string> = new Set(),
  pinned: Set<string> = new Set(),
  inPlace = false
): unknown[] | null {
  const fl = (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout
  if (!fl) return null
  // A pinned gene is never a candidate: the overlay names it, and leaving it out frees its spot
  // for a neighbour. (A merely hovered gene keeps its slot — hidden via labelOpacity — so labels
  // don't re-place on every mouse move.)
  if (pinned.size && !inPlace) labels = labels.filter((lab) => !lab.id || !pinned.has(lab.id))
  const size = fl._size as { l: number; t: number; w: number; h: number } | undefined
  const xa = fl.xaxis as { range?: [number, number] } | undefined
  const ya = fl.yaxis as { range?: [number, number] } | undefined
  if (!size || !xa?.range || !ya?.range) return null
  const [x0, x1] = xa.range
  const [y0, y1] = ya.range
  const dx = x1 - x0 || 1
  const dy = y1 - y0 || 1
  const FS = PLOT_TEXT.label // default label font size (px); per-label overridable via lab.fontSize
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
  for (const raw of labels) {
    if (!raw.text || !inX(raw.x) || !inY(raw.y)) continue
    // The plots' gene-name cap (plotAxes LABEL_MAX), so a protein group's joined names or a long
    // description can't sprawl over the cloud; the full name stays in the hover.
    const lab = { ...raw, text: truncateLabel(raw.text) }
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
    // the highlight overlays (this layer's, and a view's own — the STRING network's) redraw marks
    // already counted: counted again, a lit gene's neighbourhood reads twice as dense and its
    // label is dropped at the next placement (a zoom, a resize)
    if (!t || (t as Record<string, unknown>)[OVERLAY_FLAG]) continue
    if ((t as Record<string, unknown>).__oeHoverOverlay) continue
    // a binned bulk (densityBins): its density stands for its points, which still count here (the
    // invisible extent trace repeats a few of them)
    if ((t as Record<string, unknown>)[BIN_EXTENT]) continue
    const binPts = (t as Record<string, unknown>)[BIN_POINTS] as
      { x: unknown[]; y: unknown[]; size?: unknown } | undefined
    if (!binPts && (typeof t.mode !== 'string' || !t.mode.includes('markers'))) continue
    const xs = (binPts?.x ?? t.x) as unknown[]
    const ys = (binPts?.y ?? t.y) as unknown[]
    if (!Array.isArray(xs) || !Array.isArray(ys)) continue
    const ms = binPts ? binPts.size : t.marker?.size
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
            arrowcolor: it.lab.color ?? color,
            standoff: 0
          }
        : { ...ann, showarrow: false }
    // Tagged with the gene id so the selection handler can adjust visibility without re-placing.
    out.push({
      x: it.lab.x,
      y: it.lab.y,
      text: labelText(it.lab.text, it.lab.id, active, inPlace),
      xref: 'x',
      yref: 'y',
      ...pos,
      font: { size: it.fs, color: it.lab.color ?? color },
      opacity: labelOpacity(it.lab.id, active, inPlace),
      __oeLabelId: it.lab.id,
      __oeLabelText: it.lab.text,
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

/** Everything a label placement reads but the live annotations (see placeLabels): the inputs by
 *  identity, the selection by content, and the geometry (`_fullLayout._size`, the axis ranges) by
 *  value. Null before the plot has a geometry (a placement then does nothing either). */
export interface LabelInputs {
  labels: PlotLabel[]
  color: string
  base: unknown[]
  sides: Side[]
  inPlace: boolean
  data: unknown[] | undefined
  traces: number
  active: string
  pinned: string
  geometry: string
}

export function labelInputs(
  el: PlotlyGraphDiv,
  labels: PlotLabel[],
  color: string,
  base: unknown[],
  sides: Side[],
  active: Set<string>,
  pinned: Set<string>,
  inPlace: boolean
): LabelInputs | null {
  const fl = (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout
  const size = fl?._size as { l: number; t: number; w: number; h: number } | undefined
  const xr = (fl?.xaxis as { range?: unknown[] } | undefined)?.range
  const yr = (fl?.yaxis as { range?: unknown[] } | undefined)?.range
  if (!size || !xr || !yr) return null
  const data = (el as unknown as { data?: unknown[] }).data
  return {
    labels,
    color,
    base,
    sides,
    inPlace,
    data,
    // a trace added in place (the overlay, re-added) keeps the array but moves the markers
    traces: data?.length ?? 0,
    active: [...active].sort().join('\0'),
    pinned: [...pinned].sort().join('\0'),
    geometry: [size.l, size.t, size.w, size.h, ...xr, ...yr].join(',')
  }
}

export const sameLabelInputs = (a: LabelInputs, b: LabelInputs): boolean =>
  (Object.keys(a) as (keyof LabelInputs)[]).every((k) => a[k] === b[k])

/** An annotation's drawn state, as far as a placement sets it. */
export function annotKey(a: unknown): string {
  const o = (a ?? {}) as Record<string, unknown>
  return JSON.stringify([
    o.text,
    o.opacity,
    o.x,
    o.y,
    o.xref,
    o.yref,
    o.xanchor,
    o.yanchor,
    o.xshift,
    o.yshift,
    o.showarrow,
    o.ax,
    o.ay
  ])
}

/** Whether the live annotations still draw what a placement set (`snap`, annotKey each). */
export function sameAnnots(live: unknown[] | undefined, snap: string[]): boolean {
  if (!Array.isArray(live) || live.length !== snap.length) return false
  return live.every((a, i) => annotKey(a) === snap[i])
}
