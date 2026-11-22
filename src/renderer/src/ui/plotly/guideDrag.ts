/**
 * Dragging a plot's threshold guides (PlotlyChartProps.guides): a custom drag — not Plotly's shape
 * editing — constrained to one axis so a line never slants, following the cursor with a cheap
 * per-shape relayout while a tooltip previews the value, and committing the new value ONCE, on
 * release (one re-classification and one undo step per drag). Hovering a guide fades the points and
 * takes Plotly's hover off the point beneath it.
 */
import Plotly, { type PlotlyGraphDiv } from 'plotly.js-strict-dist-min'

import { useSelection } from '../useSelection'
import { distToSeg, type GuideDrag, parseShapePath } from './guides'
import { setPlotCursor } from './pointer'

/** Shared with the pointer handlers (bindPointer): whether a guide is being dragged (until the
 *  drag's trailing click has passed) or is under the cursor — then the point beneath isn't picked
 *  or hovered. */
export interface GuideState {
  dragging: boolean
  over: boolean
}

/** What the guide drag reads from (and does to) the chart. */
export interface GuideContext {
  /** the current guides */
  guides: () => GuideDrag[] | undefined
  /** commit a guide's new value (PlotlyChartProps.onGuide) */
  onGuide: (key: string, value: number, done: boolean) => void
  /** fade every point while a guide is hovered or dragged (and back) */
  setGuideDim: (on: boolean) => void
  /** whether Plotly's hover is switched off (over a guide) — the chart's render keeps it off */
  hoverSuppressed: { current: boolean }
  /** the drag's value tooltip element */
  tip: () => HTMLDivElement | null
}

/** Bind the guide drag to a graph div; `state` is filled in for bindPointer to read. */
export function bindGuides(el: PlotlyGraphDiv, ctx: GuideContext, state: GuideState): void {
  // Constrained to one axis so a line never slants, follows the cursor smoothly via a cheap
  // per-shape relayout (a tooltip previews the value), and commits the new value ONCE, on
  // release — one re-classification and one undo step per drag, not one per mouse move.
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
    ((el as unknown as { _fullLayout?: { shapes?: Array<Record<string, unknown>> } })._fullLayout
      ?.shapes ?? []) as Array<Record<string, unknown>>
  // Which guide (if any) sits under a client point.
  const guideAt = (clientX: number, clientY: number): GuideDrag | null => {
    const gs = ctx.guides()
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
        // A full-span line's cross-axis extent may be paper-referenced (0–1 across the plot,
        // e.g. the contrast scatter's axis cutoffs): read it as paper, not data.
        const px = (v: number): number =>
          sh.xref === 'paper' ? g.l + v * g.w : g.xa._offset + g.xa.l2p(v)
        const py = (v: number): number =>
          sh.yref === 'paper' ? g.t + (1 - v) * g.h : g.ya._offset + g.ya.l2p(v)
        if (gd.axis === 'x') {
          const lx = g.xa._offset + g.xa.l2p(sh.x0 as number)
          const ey0 = py(sh.y0 as number)
          const ey1 = py(sh.y1 as number)
          const yMin = Math.min(ey0, ey1) - HIT_TOL
          const yMax = Math.max(ey0, ey1) + HIT_TOL
          if (Math.abs(sx - lx) <= HIT_TOL && sy >= yMin && sy <= yMax) return gd
        } else {
          const ly = g.ya._offset + g.ya.l2p(sh.y0 as number)
          const ex0 = px(sh.x0 as number)
          const ex1 = px(sh.x1 as number)
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
      ((clientX - g.rect.left - g.xa._offset) / g.xa._length) * (g.xa.range[1] - g.xa.range[0])
    const my =
      g.ya.range[0] +
      (1 - (clientY - g.rect.top - g.ya._offset) / g.ya._length) * (g.ya.range[1] - g.ya.range[0])
    return gd.cursorFn(mx, my)
  }
  const setGuideDim = ctx.setGuideDim
  const setDragCursor = (cursor: string): void => setPlotCursor(el, cursor)
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
    if (ctx.hoverSuppressed.current === on) return
    ctx.hoverSuppressed.current = on
    if (on) {
      savedHovermode =
        (el as unknown as { _fullLayout?: { hovermode?: unknown } })._fullLayout?.hovermode ??
        'closest'
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
  // The cursor is off the guide (moved off it, left the plot, or released a drag outside): hover,
  // cursor and the cloud's look go back to normal. Each step is a no-op when already undone.
  const endGuideHover = (): void => {
    state.over = false
    prevGuideHover = false
    suppressHover(false)
    setDragCursor('')
    setGuideDim(false)
  }
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
        ((clientX - g.rect.left - g.xa._offset) / g.xa._length) * (g.xa.range[1] - g.xa.range[0]),
      y:
        g.ya.range[0] +
        (1 - (clientY - g.rect.top - g.ya._offset) / g.ya._length) * (g.ya.range[1] - g.ya.range[0])
    }
  }
  const showTip = (clientX: number, clientY: number, text: string): void => {
    const t = ctx.tip()
    if (!t) return
    // Positioned in VIEWPORT coords (the element is portaled to <body>, so it isn't clipped by
    // the tile's overflow or offset by react-grid-layout's transform).
    t.textContent = text
    t.style.left = `${clientX + 12}px`
    t.style.top = `${clientY - 10}px`
    t.hidden = false
  }
  const hideTip = (): void => {
    const t = ctx.tip()
    if (t) t.hidden = true
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
      if (p.guide.syncShapeIndex != null && p.guide.syncRender)
        upd[`shapes[${p.guide.syncShapeIndex}].path`] = p.guide.syncRender(p.value)
    } else if (p.origPath != null) {
      // Translate the captured curve by the vertical delta (uniform y translate).
      const pts = parseShapePath(p.origPath)
      upd[`shapes[${i}].path`] = pts.map(([x, y], k) => `${k ? 'L' : 'M'}${x},${y + p.dy}`).join('')
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
    else ctx.onGuide(drag.guide.key, drag.lastValue, true) // commit once, on release
    drag = null
    // Released outside the plot: no longer over the line, and no mouseleave is still to come.
    const box = el.getBoundingClientRect()
    if (
      ev.clientX < box.left ||
      ev.clientX > box.right ||
      ev.clientY < box.top ||
      ev.clientY > box.bottom
    )
      endGuideHover()
    // Safety: if no trailing click fires (e.g. released off the element), clear the flag on the
    // next tick so a later genuine click still selects. A real trailing click clears it first.
    setTimeout(() => {
      state.dragging = false
    }, 0)
  }
  el.addEventListener(
    'mousedown',
    (ev) => {
      const hit = guideAt(ev.clientX, ev.clientY)
      if (!hit) return
      ev.preventDefault()
      ev.stopPropagation() // block Plotly's own zoom/pan on this gesture
      state.dragging = true // suppress the trailing click's gene-select
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
      state.over = !!hit
      if (hit) {
        suppressHover(true) // over the line → hover focuses the line, not the point beneath it
        setDragCursor(cursorFor(hit, ev.clientX, ev.clientY))
        prevGuideHover = true
        if (useSelection.getState().hoverId) useSelection.getState().clearHover()
        setGuideDim(true) // fade all points so the line stands out
      } else if (prevGuideHover) endGuideHover() // left the guide
    },
    true // capture: run before Plotly's drag-layer hover so we can suppress it
  )
  // Leaving the plot is leaving the guide too. Only a move inside the plot used to end the guide
  // hover, so leaving straight from a line kept the cloud faded and the selection hidden until
  // the cursor came back. (Mid-drag the line follows the cursor anywhere — see onDragUp.)
  el.addEventListener('mouseleave', () => {
    if (!drag) endGuideHover()
  })
}
