/**
 * Box and lasso selection (the mode bar's select tools), kept on the plot as a region you can move
 * and resize. Plotly draws the box or lasso while you drag; on release it becomes a region of the
 * chart's own — Plotly's selection is cleared at once, since while one stands Plotly fades every
 * point outside it on each redraw, fighting the pins' highlight. The region pins the genes inside
 * it, as clicking each would, and follows the region: drag a box's handles (or move either kind by
 * its outline) and the genes leaving it are unpinned, those entering pinned. Genes pinned before
 * (a click) are left alone. A new box or lasso replaces the regions; with Shift held it adds one.
 * The × on a region, a double-click (which clears the pins) or clearing the pins elsewhere removes
 * them. Regions are drawn on an SVG laid over the plot, in data coordinates, so a zoom or pan
 * carries them; nothing of them is in the figure (a copy or export leaves them out).
 */
import { createContext } from 'react'
import Plotly, { type PlotlyGraphDiv } from 'plotly.js-strict-dist-min'

import { useSelection } from '../useSelection'
import { OVERLAY_FLAG, traceIds, type Trace } from './highlight'

/** What the regions read from (and do to) the chart. */
export interface RegionContext {
  /** the genes an own id (an enrichment term) stands for — see PlotlyChartProps.pinIdsOf */
  pinIdsOf: () => ((id: string) => string[] | null | undefined) | undefined
  /** wrap a Plotly call the chart must wait for before it unmounts (PlotlyChart's track) */
  track: <T>(p: Promise<T>) => Promise<T>
}

/** What the plot on show stands for — a tile's context tabs' pick (FacetedPlot's facet key). A
 *  change clears the regions: they were drawn on another context's points, so a plot never
 *  inherits them from the one switched away from. */
export const PlotScopeContext = createContext('')

/** A chart's regions, once bound: `reset` drops them (keeping the pins they made), `unbind`
 *  detaches them. */
export interface Regions {
  reset: () => void
  unbind: () => void
}

type Rect = { kind: 'rect'; xa: string; ya: string; x0: number; x1: number; y0: number; y1: number }
type Path = { kind: 'path'; xa: string; ya: string; xs: number[]; ys: number[] }
type Region = Rect | Path

type Axis = {
  _offset: number
  _length: number
  d2p: (v: unknown) => number
  p2d: (px: number) => number
}

const SVG = 'http://www.w3.org/2000/svg'
/** a resize handle's side (px) */
const HANDLE = 8

/** Bind the regions to a graph div. */
export function bindSelectRegions(el: PlotlyGraphDiv, ctx: RegionContext): Regions {
  const host = el.parentElement
  if (!host) return { reset: () => {}, unbind: () => {} }
  let regions: Region[] = []
  // The genes the regions pinned (not those pinned before): what a region's edit may unpin.
  let owned = new Set<string>()
  let shiftAtDown = false

  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  Object.assign(svg.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    overflow: 'visible'
  })
  const clipId = `oe-region-clip-${Math.random().toString(36).slice(2)}`
  const defs = document.createElementNS(SVG, 'defs')
  const clip = document.createElementNS(SVG, 'clipPath')
  clip.id = clipId
  const clipRect = document.createElementNS(SVG, 'rect')
  clip.appendChild(clipRect)
  defs.appendChild(clip)
  svg.appendChild(defs)
  const layer = document.createElementNS(SVG, 'g')
  svg.appendChild(layer)
  host.appendChild(svg)

  const fullLayout = (): Record<string, unknown> | undefined =>
    (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout
  /** An axis by its id ('x', 'y2') or its layout name ('xaxis', 'yaxis2'). */
  const axis = (id: string): Axis | undefined => {
    const name = id.includes('axis') ? id : `${id[0]}axis${id.slice(1)}`
    const ax = fullLayout()?.[name] as Axis | undefined
    return ax && typeof ax.d2p === 'function' && typeof ax.p2d === 'function' ? ax : undefined
  }
  const elBox = (): DOMRect => (el as unknown as HTMLElement).getBoundingClientRect()
  const hostBox = (): DOMRect => host.getBoundingClientRect()

  // ---- which genes a region holds ----
  const inside = (r: Region, px: number, py: number, xa: Axis, ya: Axis): boolean => {
    if (r.kind === 'rect') {
      const [a, b] = [xa.d2p(r.x0), xa.d2p(r.x1)]
      const [c, d] = [ya.d2p(r.y0), ya.d2p(r.y1)]
      return (
        px >= Math.min(a, b) && px <= Math.max(a, b) && py >= Math.min(c, d) && py <= Math.max(c, d)
      )
    }
    // even-odd ray cast over the outline, in pixels
    let hit = false
    const n = r.xs.length
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = xa.d2p(r.xs[i])
      const yi = ya.d2p(r.ys[i])
      const xj = xa.d2p(r.xs[j])
      const yj = ya.d2p(r.ys[j])
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit
    }
    return hit
  }
  const genesIn = (): Set<string> => {
    const out = new Set<string>()
    if (!regions.length) return out
    const pinIdsOf = ctx.pinIdsOf()
    for (const raw of (el as unknown as { data?: Trace[] }).data ?? []) {
      const t = raw as Trace & { xaxis?: string; yaxis?: string; visible?: unknown }
      if ((t as Record<string, unknown>)[OVERLAY_FLAG] || t.visible === false) continue
      if (typeof t.mode !== 'string' || !t.mode.includes('markers')) continue
      const ids = traceIds(t)
      const xs = t.x as unknown[] | undefined
      const ys = t.y as unknown[] | undefined
      if (!ids || !Array.isArray(xs) || !Array.isArray(ys)) continue
      const tx = t.xaxis ?? 'x'
      const ty = t.yaxis ?? 'y'
      const mine = regions.filter((r) => axis(r.xa) === axis(tx) && axis(r.ya) === axis(ty))
      if (!mine.length) continue
      const xa = axis(tx)
      const ya = axis(ty)
      if (!xa || !ya) continue
      for (let k = 0; k < ids.length; k++) {
        const id = ids[k]
        if (typeof id !== 'string') continue
        const px = xa.d2p(xs[k])
        const py = ya.d2p(ys[k])
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue
        if (!mine.some((r) => inside(r, px, py, xa, ya))) continue
        for (const g of pinIdsOf?.(id) ?? [id]) out.add(g)
      }
    }
    return out
  }
  /** Pin what the regions now hold; unpin what they pinned and no longer hold. */
  const applyPins = (): void => {
    const next = genesIn()
    const sel = useSelection.getState()
    const pinned = new Set(sel.pinnedIds)
    const nowOwned = new Set<string>()
    for (const g of owned) if (!next.has(g)) pinned.delete(g)
    for (const g of next) {
      if (owned.has(g)) nowOwned.add(g)
      else if (!pinned.has(g)) {
        pinned.add(g)
        nowOwned.add(g)
      }
    }
    owned = nowOwned
    sel.setPins([...pinned])
  }
  const clearRegions = (unpin: boolean): void => {
    if (unpin && owned.size) {
      const sel = useSelection.getState()
      const pinned = new Set(sel.pinnedIds)
      for (const g of owned) pinned.delete(g)
      owned = new Set()
      sel.setPins([...pinned])
    }
    owned = new Set()
    regions = []
    draw()
  }

  // ---- drawing ----
  const el2 = <K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, string | number>
  ): SVGElementTagNameMap[K] => {
    const n = document.createElementNS(SVG, tag)
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v))
    return n
  }
  function draw(): void {
    layer.replaceChildren()
    if (!regions.length) return
    // where the graph div sits in the overlay (the host may hold more than the graph)
    const eb = elBox()
    const hb = hostBox()
    const dx = eb.left - hb.left
    const dy = eb.top - hb.top
    const size = fullLayout()?._size as { l: number; t: number; w: number; h: number } | undefined
    if (!size) return
    // the plot area, in the overlay's pixels
    const pl = dx + size.l
    const pt = dy + size.t
    const pr = pl + size.w
    const pb = pt + size.h
    clipRect.setAttribute('x', String(pl))
    clipRect.setAttribute('y', String(pt))
    clipRect.setAttribute('width', String(size.w))
    clipRect.setAttribute('height', String(size.h))
    regions.forEach((r, i) => {
      const xa = axis(r.xa)
      const ya = axis(r.ya)
      if (!xa || !ya) return
      const X = (v: number): number => dx + xa._offset + xa.d2p(v)
      const Y = (v: number): number => dy + ya._offset + ya.d2p(v)
      const g = el2('g', {})
      const shape = el2('g', { 'clip-path': `url(#${clipId})` })
      let d: string
      let bx0: number, bx1: number, by0: number, by1: number
      if (r.kind === 'rect') {
        bx0 = Math.min(X(r.x0), X(r.x1))
        bx1 = Math.max(X(r.x0), X(r.x1))
        by0 = Math.min(Y(r.y0), Y(r.y1))
        by1 = Math.max(Y(r.y0), Y(r.y1))
        d = `M${bx0},${by0}H${bx1}V${by1}H${bx0}Z`
      } else {
        const pts = r.xs.map((x, k) => [X(x), Y(r.ys[k])] as const)
        d = `M${pts.map((p) => p.join(',')).join('L')}Z`
        bx0 = Math.min(...pts.map((p) => p[0]))
        bx1 = Math.max(...pts.map((p) => p[0]))
        by0 = Math.min(...pts.map((p) => p[1]))
        by1 = Math.max(...pts.map((p) => p[1]))
      }
      shape.appendChild(
        el2('path', {
          d,
          fill: 'var(--text)',
          'fill-opacity': 0.05,
          stroke: 'var(--text)',
          'stroke-width': 1,
          'stroke-dasharray': '2 3',
          'pointer-events': 'none'
        })
      )
      // the outline's grip (wide, unseen): drag it to move the region
      const grip = el2('path', {
        d,
        fill: 'none',
        stroke: 'transparent',
        'stroke-width': 9,
        'pointer-events': 'stroke',
        style: 'cursor: move'
      })
      grip.addEventListener('pointerdown', (ev) => startDrag(ev, i, 'move'))
      shape.appendChild(grip)
      g.appendChild(shape)
      layer.appendChild(g)
      // Zoomed or panned off the plot: no handles or ×, floating outside it.
      if (bx1 < pl || bx0 > pr || by1 < pt || by0 > pb) return
      // a box's handles: corners and edge midpoints
      if (r.kind === 'rect') {
        const mx = (bx0 + bx1) / 2
        const my = (by0 + by1) / 2
        const spots: Array<[string, number, number, string]> = [
          ['nw', bx0, by0, 'nwse-resize'],
          ['n', mx, by0, 'ns-resize'],
          ['ne', bx1, by0, 'nesw-resize'],
          ['e', bx1, my, 'ew-resize'],
          ['se', bx1, by1, 'nwse-resize'],
          ['s', mx, by1, 'ns-resize'],
          ['sw', bx0, by1, 'nesw-resize'],
          ['w', bx0, my, 'ew-resize']
        ]
        for (const [edge, hx, hy, cursor] of spots) {
          const h = el2('rect', {
            x: hx - HANDLE / 2,
            y: hy - HANDLE / 2,
            width: HANDLE,
            height: HANDLE,
            rx: 1.5,
            fill: 'var(--panel-raised)',
            stroke: 'var(--text)',
            'stroke-width': 1,
            'pointer-events': 'all',
            style: `cursor: ${cursor}`
          })
          h.addEventListener('pointerdown', (ev) => startDrag(ev, i, edge))
          g.appendChild(h)
        }
      }
      // remove (×), just outside the top-right corner — kept within the plot
      const close = el2('g', {
        transform: `translate(${Math.min(bx1 + 9, pr - 8)},${Math.max(by0 - 9, pt + 8)})`,
        'pointer-events': 'all',
        style: 'cursor: pointer'
      })
      const ring = el2('circle', {
        r: 7,
        fill: 'var(--panel-raised)',
        stroke: 'var(--border)',
        'stroke-width': 1
      })
      const cross = el2('path', {
        d: 'M-2.5,-2.5L2.5,2.5M2.5,-2.5L-2.5,2.5',
        stroke: 'var(--text-muted)',
        'stroke-width': 1.3,
        'stroke-linecap': 'round'
      })
      const tip = el2('title', {})
      tip.textContent = 'Remove selection'
      close.append(ring, cross, tip)
      close.addEventListener('pointerdown', (ev) => ev.stopPropagation())
      close.addEventListener('click', (ev) => {
        ev.stopPropagation()
        removeRegion(i)
      })
      g.appendChild(close)
    })
  }
  const removeRegion = (i: number): void => {
    regions = regions.filter((_, k) => k !== i)
    applyPins()
    draw()
  }

  // ---- dragging a region ----
  function startDrag(ev: PointerEvent, i: number, edge: string): void {
    if (ev.button !== 0) return
    ev.preventDefault()
    ev.stopPropagation()
    const r0 = regions[i]
    const xa = axis(r0.xa)
    const ya = axis(r0.ya)
    if (!xa || !ya) return
    // On the window, not the handle: each move redraws the overlay, replacing the handle (and with
    // it any pointer capture).
    const startX = ev.clientX
    const startY = ev.clientY
    // in pixels, from the region as it was when the drag began
    const px = (v: number): number => xa.d2p(v)
    const py = (v: number): number => ya.d2p(v)
    const move = (e: PointerEvent): void => {
      const ddx = e.clientX - startX
      const ddy = e.clientY - startY
      let next: Region
      if (r0.kind === 'path') {
        next = {
          ...r0,
          xs: r0.xs.map((x) => xa.p2d(px(x) + ddx)),
          ys: r0.ys.map((y) => ya.p2d(py(y) + ddy))
        }
      } else {
        // the box's left/right/top/bottom in px, the dragged sides moved
        let l = Math.min(px(r0.x0), px(r0.x1))
        let rr = Math.max(px(r0.x0), px(r0.x1))
        let t = Math.min(py(r0.y0), py(r0.y1))
        let b = Math.max(py(r0.y0), py(r0.y1))
        if (edge === 'move') {
          l += ddx
          rr += ddx
          t += ddy
          b += ddy
        } else {
          if (edge.includes('w')) l += ddx
          if (edge.includes('e')) rr += ddx
          if (edge.includes('n')) t += ddy
          if (edge.includes('s')) b += ddy
        }
        next = {
          ...r0,
          x0: xa.p2d(Math.min(l, rr)),
          x1: xa.p2d(Math.max(l, rr)),
          y0: ya.p2d(Math.max(t, b)),
          y1: ya.p2d(Math.min(t, b))
        }
      }
      regions = regions.map((r, k) => (k === i ? next : r))
      draw()
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      applyPins()
      draw()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  // ---- a new box or lasso (Plotly's select tools) ----
  const onDown = (ev: PointerEvent): void => {
    shiftAtDown = ev.shiftKey
  }
  ;(el as unknown as HTMLElement).addEventListener('pointerdown', onDown, true)
  el.on('plotly_selected', (e) => {
    const ev = e as
      | {
          range?: Record<string, [number, number]>
          lassoPoints?: Record<string, number[]>
        }
      | undefined
    let region: Region | null = null
    if (ev?.range) {
      const keys = Object.keys(ev.range)
      const xk = keys.find((k) => k.startsWith('x'))
      const yk = keys.find((k) => k.startsWith('y'))
      if (xk && yk) {
        const [x0, x1] = ev.range[xk]
        const [y0, y1] = ev.range[yk]
        region = { kind: 'rect', xa: xk, ya: yk, x0, x1, y0, y1 }
      }
    } else if (ev?.lassoPoints) {
      const keys = Object.keys(ev.lassoPoints)
      const xk = keys.find((k) => k.startsWith('x'))
      const yk = keys.find((k) => k.startsWith('y'))
      if (xk && yk && ev.lassoPoints[xk].length > 2)
        region = {
          kind: 'path',
          xa: xk,
          ya: yk,
          xs: [...ev.lassoPoints[xk]],
          ys: [...ev.lassoPoints[yk]]
        }
    }
    if (!region) return
    regions = shiftAtDown ? [...regions, region] : [region]
    // Plotly's own selection off (on the next tick: this fires inside its drag end). The
    // selections first: every restyle re-applies them to the points, so clearing the points while
    // a box was still there selected them again.
    void ctx
      .track(
        new Promise<void>((done) => setTimeout(done, 0))
          .then(() => Plotly.relayout(el, { selections: [] }))
          .then(() => Plotly.restyle(el, { selectedpoints: null }))
      )
      .catch(() => undefined)
      .then(() => {
        applyPins()
        draw()
      })
  })
  // A zoom, pan, resize or redraw moves the plot under the regions.
  el.on('plotly_relayout', () => draw())
  el.on('plotly_afterplot', () => draw())
  // The pins cleared (a double-click, the gene selector): the regions go with them.
  let seenPins = useSelection.getState().pinnedIds
  const unsub = useSelection.subscribe((s) => {
    if (s.pinnedIds === seenPins) return // (a hover, not the pins)
    seenPins = s.pinnedIds
    if (!regions.length || !owned.size) return
    const kept = new Set([...owned].filter((g) => s.pinnedIds.has(g)))
    if (kept.size === owned.size) return
    owned = kept
    if (!kept.size) clearRegions(false)
  })

  return {
    reset: () => {
      if (regions.length) clearRegions(false)
    },
    unbind: () => {
      unsub()
      ;(el as unknown as HTMLElement).removeEventListener('pointerdown', onDown, true)
      svg.remove()
    }
  }
}
