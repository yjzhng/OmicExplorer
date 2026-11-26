/**
 * The plots' pointer interactions with genes: hovering a point (or a tick label that stands for an
 * id) shares it as the linked hover; a click pins it (or the genes it stands for), a double-click
 * clears the pins; a legend click pins its group; a clickable annotation reaches the view. Bound
 * once per graph div (bindPointer), reading the chart's current props through `ctx`.
 */
import { type PlotlyGraphDiv } from 'plotly.js-strict-dist-min'

import { BIN_IDS } from '../densityBins'
import { hoverFocus, legendClear, legendSelect } from '../traceFocus'
import { useSelection } from '../useSelection'
import { at, traceIds, type Trace } from './highlight'
import { type GuideState } from './guideDrag'

/** What the pointer handlers read from the chart, each time (its props can change). */
export interface PointerContext {
  /** the genes an own id (an enrichment term) stands for — see PlotlyChartProps.pinIdsOf */
  pinIdsOf: () => ((id: string) => string[] | null | undefined) | undefined
  /** ms a hover waits before the other plots light it (PlotlyChartProps.linkDelay) */
  linkDelay: () => number | undefined
  /** the bold-tick config, for a tick label that stands for an id (its `idByTick`) */
  boldTicks: () => { idByTick?: (string | null)[]; axis?: 'x' | 'y' } | undefined
  /** a clickable annotation was clicked (its name) */
  onAnnotation: (name: string) => void
}

/** Show `cursor` over the plot's drag layers (inline style beats their cursor-* class) — a pointer
 *  over a clickable gene point, a resize cursor over a guide; '' gives pan / zoom theirs back. */
export function setPlotCursor(el: PlotlyGraphDiv, cursor: string): void {
  el.querySelectorAll('.nsewdrag').forEach((d) => {
    ;(d as SVGElement & { style: CSSStyleDeclaration }).style.cursor = cursor
  })
}

/** Bind the gene hover / click / legend handlers to a graph div. `guide` is the threshold guides'
 *  state (bindGuides): while one is hovered or dragged, the point beneath isn't hovered or picked. */
export function bindPointer(el: PlotlyGraphDiv, ctx: PointerContext, guide: GuideState): void {
  const idAt = (e: {
    points?: Array<{ customdata?: unknown; curveNumber?: number }>
  }): string | null => {
    const pt = e.points?.[0]
    const cd = pt?.customdata
    if (typeof cd === 'string') return cd
    // A mark hovered as a whole (a filled ridge, hovered on its fill) carries no per-point
    // data: its trace's own id (`__oeId`), if it has one.
    const t =
      pt?.curveNumber != null
        ? (el as unknown as { data?: Trace[] }).data?.[pt.curveNumber]
        : undefined
    const own = (t as { __oeId?: unknown } | undefined)?.__oeId
    return typeof own === 'string' ? own : null
  }
  const setDragCursor = (cursor: string): void => setPlotCursor(el, cursor)
  // The hover this chart set, until cleared. A redraw while hovering (a plot that re-texts its
  // labels on hover — the enrichment terms) drops Plotly's hovered point WITHOUT a
  // plotly_unhover, so if the cursor has already moved off, nothing would clear the hover and
  // the rest of the plot stayed dimmed. A native mousemove checks Plotly's hover state after
  // its own handling and clears an orphaned hover.
  let ownHover: string | null = null
  // a hover held back from the other plots (linkDelay), until it fires or is replaced
  let linkTimer: ReturnType<typeof setTimeout> | undefined
  let moveRaf = 0
  el.addEventListener('mousemove', () => {
    if (!ownHover) return
    cancelAnimationFrame(moveRaf)
    moveRaf = requestAnimationFrame(() => {
      const hd = (el as unknown as { _hoverdata?: unknown[] })._hoverdata
      if (!ownHover || (hd && hd.length)) return
      clearTimeout(linkTimer)
      if (useSelection.getState().hoverId === ownHover) useSelection.getState().clearHover()
      ownHover = null
      setDragCursor('')
    })
  })
  el.on('plotly_hover', (e) => {
    if (guide.over) return // over a threshold line — don't highlight the point beneath it
    // A mark that's neither a gene's nor a sample's highlights its group (traceFocus).
    hoverFocus(el, e.points?.[0]?.curveNumber ?? null)
    const id = idAt(e)
    if (id) {
      ownHover = id
      // a group's own id (a term, a cluster) carries its genes, in focus everywhere
      const share = (): void =>
        useSelection.getState().setHover(id, ctx.pinIdsOf()?.(id) ?? undefined)
      clearTimeout(linkTimer)
      const delay = ctx.linkDelay()
      if (delay) linkTimer = setTimeout(() => ownHover === id && share(), delay)
      else share()
      setDragCursor('pointer')
    }
  })
  el.on('plotly_unhover', () => {
    hoverFocus(el, null)
    clearTimeout(linkTimer)
    ownHover = null
    useSelection.getState().clearHover()
    setDragCursor('')
  })
  // Hovering a tick LABEL that stands for an id (boldTicks.idByTick — an enrichment term's), or a
  // shape that does (its `__oeId` — an enrichment module's bar), hovers that id, as hovering its
  // mark does; the click fallback below then selects it. Plotly's SVG takes no pointer events, so
  // they're hit-tested from the div's own mousemove: the tick under the cursor, mapped back to its
  // index through its datum; the shape by its box.
  let labelHover: string | null = null
  let labelRaf = 0
  const tickIdAt = (clientX: number, clientY: number): string | null => {
    const bt = ctx.boldTicks()
    const ids = bt?.idByTick
    if (!ids) return null
    const ax = bt.axis ?? 'y'
    const axis = (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout?.[
      `${ax}axis`
    ] as { tickvals?: unknown[]; _categories?: unknown[]; type?: string } | undefined
    if (!axis?.tickvals) return null
    // A label's whole row, not just its text: across from its start to the plot's edge (its square
    // and the gap after it too — a y label's), and along its axis half-way to its neighbours' —
    // the nearest label taking a point, as crowded labels overlap.
    const nodes = [...el.querySelectorAll(`.${ax}tick text`)]
    const rects = nodes.map((n) => n.getBoundingClientRect())
    const mid = (r: DOMRect): number =>
      ax === 'y' ? (r.top + r.bottom) / 2 : (r.left + r.right) / 2
    const mids = rects.map(mid).sort((a, b) => a - b)
    let pitch = Infinity
    for (let k = 1; k < mids.length; k++) pitch = Math.min(pitch, mids[k] - mids[k - 1] || Infinity)
    const xa = (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout?.xaxis as
      { _offset: number } | undefined
    const plotLeft = xa
      ? (el as unknown as HTMLElement).getBoundingClientRect().left + xa._offset
      : 0
    let best = -1
    let bestD = Infinity
    rects.forEach((r, k) => {
      const [along, across] = ax === 'y' ? [clientY, clientX] : [clientX, clientY]
      const [lo, hi] =
        ax === 'y' ? [r.left - 2, xa ? plotLeft : r.right + 2] : [r.top - 2, r.bottom + 2]
      if (across < lo || across > hi) return
      const half = ax === 'y' ? r.height / 2 : r.width / 2
      const reach = Math.max(half + 1, Number.isFinite(pitch) ? pitch / 2 : 0)
      const d = Math.abs(along - mid(r))
      if (d <= reach && d < bestD) {
        bestD = d
        best = k
      }
    })
    if (best < 0) return null
    // the tick's linear position → its value (a category's name) → its index in tickvals
    const x = (nodes[best] as unknown as { __data__?: { x?: number } }).__data__?.x
    if (x == null) return null
    const v = axis.type === 'category' ? axis._categories?.[x] : x
    const i = axis.tickvals.indexOf(v)
    return i >= 0 ? (ids[i] ?? null) : null
  }
  // A shape standing for an id: one in pixels across from the paper's edge (xsizemode 'pixel'),
  // in data along y, or in px about a y anchor (ysizemode 'pixel') — as the enrichment module bars are drawn (chrome.ts moduleBars).
  type IdShape = {
    __oeId?: unknown
    xanchor?: number
    x0?: number
    x1?: number
    y0?: number
    y1?: number
    ysizemode?: string
    yanchor?: number
  }
  const idShapes = (): IdShape[] =>
    (
      ((el as unknown as { layout?: { shapes?: unknown[] } }).layout?.shapes ?? []) as IdShape[]
    ).filter((s) => typeof s?.__oeId === 'string')
  const shapeIdAt = (clientX: number, clientY: number): string | null => {
    const shapes = idShapes()
    if (!shapes.length) return null
    const fl = (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout
    type Ax = { _offset: number; _length: number; l2p: (v: number) => number }
    const xa = fl?.xaxis as Ax | undefined
    const ya = fl?.yaxis as Ax | undefined
    if (!xa || !ya) return null
    const box = (el as unknown as HTMLElement).getBoundingClientRect()
    const px = clientX - box.left
    const py = clientY - box.top
    for (const s of shapes) {
      const ax = xa._offset + (s.xanchor ?? 0) * xa._length
      // The bars are narrow: one takes the room around it — its gap on either side, and on to the
      // plot's edge when it sits just off it (an enrichment module's bar, beside the labels) — and
      // a few px past its ends.
      const x0 = ax + Math.min(s.x0 ?? 0, s.x1 ?? 0)
      const x1 = ax + Math.max(s.x0 ?? 0, s.x1 ?? 0)
      const right = x1 <= ax && ax - x1 <= 8 ? ax : x1 + 4
      if (px < x0 - 4 || px > right) continue
      // in data along y, or (ysizemode 'pixel') in px about its yanchor, up positive
      const pixel = s.ysizemode === 'pixel'
      const base = pixel ? ya._offset + ya.l2p(s.yanchor ?? 0) : 0
      const ya0 = pixel ? base - (s.y0 ?? 0) : ya._offset + ya.l2p(s.y0 ?? 0)
      const ya1 = pixel ? base - (s.y1 ?? 0) : ya._offset + ya.l2p(s.y1 ?? 0)
      if (py >= Math.min(ya0, ya1) - 2 && py <= Math.max(ya0, ya1) + 2) return s.__oeId as string
    }
    return null
  }
  // A pointer over a label or bar that stands for an id. They sit over the axes' own drag handles
  // (the margins' .drag rects, a resize cursor each, by class) — the inline style beats it there,
  // as setPlotCursor does over the plot; the plot's own (.nsewdrag) is the point hover's.
  const labelCursor = (on: boolean): void => {
    ;(el as unknown as HTMLElement).style.cursor = on ? 'pointer' : ''
    el.querySelectorAll('.drag:not(.nsewdrag)').forEach((d) => {
      ;(d as SVGElement & { style: CSSStyleDeclaration }).style.cursor = on ? 'pointer' : ''
    })
  }
  el.addEventListener('mousemove', (ev) => {
    if (!ctx.boldTicks()?.idByTick && !idShapes().length) return
    const { clientX, clientY } = ev
    cancelAnimationFrame(labelRaf)
    labelRaf = requestAnimationFrame(() => {
      // a bar first: a label's row reaches the plot's edge, past the bars
      const id = shapeIdAt(clientX, clientY) ?? tickIdAt(clientX, clientY)
      if (id === labelHover) return
      const sel = useSelection.getState()
      if (labelHover && sel.hoverId === labelHover) sel.clearHover()
      labelHover = id
      if (id) sel.setHover(id, ctx.pinIdsOf()?.(id) ?? undefined)
      labelCursor(!!id)
    })
  })
  el.addEventListener('mouseleave', () => {
    cancelAnimationFrame(labelRaf)
    if (!labelHover) return
    if (useSelection.getState().hoverId === labelHover) useSelection.getState().clearHover()
    labelHover = null
    labelCursor(false)
  })
  // One selection toggle per click, whichever path finds the gene. plotly_click is exact, but
  // it only fires while Plotly still holds the hovered point — and the plots that change on
  // hover (the enrichment ridge bolds its labels, the STRING network adds highlight traces)
  // could lose it between the hover and the click, so a click went unregistered. The
  // native-click fallback below then resolves the gene from the click POSITION, not from
  // hover state. `plotlyClickAt` marks a click plotly_click already handled (a timestamp,
  // not a flag, so a stale value can't swallow a later click).
  let plotlyClickAt = -Infinity
  // Pin a clicked point: the genes it stands for (pinIdsOf — an enrichment term's; none
  // known = nothing, never the term's own id as if it were a gene), else the point's own id
  // (a gene).
  const pinPoint = (id: string): void => {
    const genes = ctx.pinIdsOf()?.(id)
    if (genes) useSelection.getState().togglePins(genes)
    else useSelection.getState().togglePin(id)
  }
  el.on('plotly_click', (e) => {
    if (guide.dragging) return // a guide drag, not a gene click
    const id = idAt(e)
    if (id) {
      plotlyClickAt = performance.now()
      pinPoint(id)
    }
  })
  // The gene point under a click, from the live figure: the nearest point of any trace that
  // carries uniqIDs, within its marker radius plus a few px. Null when none is that close.
  const pointAt = (clientX: number, clientY: number): string | null => {
    const gdx = el as unknown as {
      data?: Trace[]
      _fullLayout?: Record<string, unknown>
      getBoundingClientRect: () => DOMRect
    }
    const fl = gdx._fullLayout
    if (!fl) return null
    const box = gdx.getBoundingClientRect()
    type Ax = { _offset: number; d2p?: (v: unknown) => number; l2p: (v: number) => number }
    const axisOf = (ref: unknown, kind: 'x' | 'y'): Ax | undefined => {
      const id = typeof ref === 'string' ? ref : kind
      return fl[`${kind}axis${id.slice(1)}`] as Ax | undefined
    }
    let best: string | null = null
    let bestD = Infinity
    for (const t of gdx.data ?? []) {
      const tt = t as Trace & {
        xaxis?: string
        yaxis?: string
        visible?: unknown
        marker?: { size?: unknown }
      }
      if (tt.visible === false || typeof tt.mode !== 'string' || !tt.mode.includes('markers'))
        continue
      const ids = traceIds(t)
      const xs = tt.x as unknown[] | undefined
      const ys = tt.y as unknown[] | undefined
      const xa = axisOf(tt.xaxis, 'x')
      const ya = axisOf(tt.yaxis, 'y')
      if (!ids || !Array.isArray(xs) || !Array.isArray(ys) || !xa || !ya) continue
      const toPx = (a: Ax, v: unknown): number =>
        a.d2p ? a.d2p(v) : typeof v === 'number' ? a.l2p(v) : NaN
      for (let k = 0; k < ids.length; k++) {
        if (typeof ids[k] !== 'string') continue
        const dx = box.left + xa._offset + toPx(xa, xs[k]) - clientX
        const dy = box.top + ya._offset + toPx(ya, ys[k]) - clientY
        const d = Math.hypot(dx, dy)
        const reach = at(tt.marker?.size as number | number[] | undefined, k, 6) / 2 + 4
        if (d <= reach && d < bestD) {
          bestD = d
          best = ids[k]
        }
      }
    }
    return best
  }
  // The own-id region under a click (a filled mark hovered as a whole — a STRING cluster's
  // hull, carrying `__oeId`): the topmost whose filled outline contains the point. By
  // position, not hover state — a view that redraws on hover (STRING's highlight) drops
  // Plotly's hovered fill before the click lands.
  const regionAt = (clientX: number, clientY: number): string | null => {
    const gdx = el as unknown as {
      data?: Trace[]
      _fullLayout?: Record<string, unknown>
      getBoundingClientRect: () => DOMRect
    }
    const fl = gdx._fullLayout
    if (!fl) return null
    const box = gdx.getBoundingClientRect()
    type Ax = { _offset: number; l2p: (v: number) => number }
    const xa = fl.xaxis as Ax | undefined
    const ya = fl.yaxis as Ax | undefined
    if (!xa || !ya) return null
    const px = clientX - box.left
    const py = clientY - box.top
    const data = gdx.data ?? []
    for (let t = data.length - 1; t >= 0; t--) {
      const tr = data[t] as Trace & { __oeId?: unknown; fill?: unknown; visible?: unknown }
      if (typeof tr.__oeId !== 'string' || tr.fill !== 'toself' || tr.visible === false) continue
      const xs = tr.x as number[] | undefined
      const ys = tr.y as number[] | undefined
      if (!Array.isArray(xs) || !Array.isArray(ys)) continue
      // even-odd ray cast over the outline in pixels
      let inside = false
      for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
        const xi = xa._offset + xa.l2p(xs[i])
        const yi = ya._offset + ya.l2p(ys[i])
        const xj = xa._offset + xa.l2p(xs[j])
        const yj = ya._offset + ya.l2p(ys[j])
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
      }
      if (inside) return tr.__oeId
    }
    return null
  }
  el.addEventListener(
    'click',
    (ev) => {
      // A threshold-guide drag just ended — swallow its trailing click so it doesn't select a
      // gene. Do NOT clear the flag here: plotly_click fires later (bubble) in the same dispatch
      // and must stay suppressed too; onDragUp clears the flag on the next tick.
      if (guide.dragging) return
      // Legend clicks are handled by plotly_legendclick — don't double-fire.
      if ((ev.target as Element | null)?.closest?.('.legend')) return
      // Snapshot NOW — the deferred check might run after hover cleared. The hovered gene is
      // the last resort: for pure LINE traces (DR/TR curves) Plotly often fires no
      // plotly_click and there is no marker to hit-test.
      // (this chart's own hover first: one held back by linkDelay isn't shared yet)
      const hoverAtClick = ownHover ?? useSelection.getState().hoverId
      const clickedAt = performance.now()
      const { clientX, clientY } = ev
      // Defer so a (bubble-phase) plotly_click, if any, is recorded first.
      setTimeout(() => {
        if (plotlyClickAt >= clickedAt - 500) return // plotly_click handled this click
        // a label or bar standing for an id (a term's, a module's) by position too: a press there
        // clears the hover (Plotly's axis drag) before the click lands
        const id =
          pointAt(clientX, clientY) ??
          regionAt(clientX, clientY) ??
          shapeIdAt(clientX, clientY) ??
          (ctx.boldTicks()?.idByTick ? tickIdAt(clientX, clientY) : null) ??
          hoverAtClick
        if (id) pinPoint(id)
      }, 0)
    },
    true // capture phase: fires even if Plotly's drag layer stops the bubbling click
  )
  el.on('plotly_doubleclick', () => useSelection.getState().clearPins())
  // Clicking a legend group HIGHLIGHTS its genes (pins them) instead of hiding the trace —
  // returning false suppresses Plotly's default show/hide. Only gene traces (those with a
  // uniqID array in customdata) are intercepted; other legends keep the default behaviour.
  const groupIds = (curve: number): string[] | null => {
    const t = ((el as unknown as { data?: Trace[] }).data ?? [])[curve]
    // a binned bulk's legend stands for ALL its genes, not just the markers left drawn
    const cd = (t as Record<string, unknown> | undefined)?.[BIN_IDS] ?? t?.customdata
    return Array.isArray(cd) && cd.length && typeof cd[0] === 'string' ? (cd as string[]) : null
  }
  const legendEvents = el as unknown as {
    on: (ev: string, cb: (e: { curveNumber: number }) => boolean | void) => void
  }
  // A clickable annotation (captureevents) → the view's handler, by the annotation's name.
  ;(
    el as unknown as {
      on: (
        ev: string,
        cb: (e: { fullAnnotation?: { name?: string }; annotation?: { name?: string } }) => void
      ) => void
    }
  ).on('plotly_clickannotation', (e) => {
    const name = e.fullAnnotation?.name ?? e.annotation?.name
    if (name) ctx.onAnnotation(name)
  })
  legendEvents.on('plotly_legendclick', (e) => {
    const ids = groupIds(e.curveNumber)
    // Any other legend selects its group too (traceFocus) — never Plotly's show/hide.
    if (!ids) return !legendSelect(el, e.curveNumber)
    useSelection.getState().togglePins(ids)
    return false
  })
  legendEvents.on('plotly_legenddoubleclick', (e) => {
    const ids = groupIds(e.curveNumber)
    if (!ids) {
      legendClear(el)
      return false
    }
    useSelection.getState().clearPins()
    return false
  })
}
