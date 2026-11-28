import { type PlotlyGraphDiv } from 'plotly.js-strict-dist-min'

/** Padding (px) between a tooltip's text and its box. */
const TIP_PAD = 6
/** Where a tooltip sits from the cursor (px): right of it, and below the pointer's tip. */
const TIP_DX = 14
const TIP_DY = 18
/** The gap kept between a tooltip and the window's edge (px). */
const TIP_EDGE = 4

/**
 * The plots' one floating tooltip: a fixed layer on the page, above every tile, at the cursor's
 * bottom-right — flipped to its left / above it only where it would leave the window. Plotly still
 * draws each tooltip (`g.hovertext`: a callout `path` and its `text`) in the plot's own hover
 * layer, where a small tile clipped it and it covered the plot; floatHoverLabels copies them here
 * and hides the originals. One per window: a hover shows one plot's tooltip at a time.
 */
const floatTip = (() => {
  const NS = 'http://www.w3.org/2000/svg'
  let host: HTMLDivElement | null = null
  let svg: SVGSVGElement | null = null
  let owner: Element | null = null
  let w = 0
  let h = 0
  let cx = 0
  let cy = 0
  const place = (): void => {
    if (!host || !owner) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = cx + TIP_DX
    let y = cy + TIP_DY
    if (x + w > vw - TIP_EDGE) x = Math.max(TIP_EDGE, cx - TIP_DX - w)
    if (y + h > vh - TIP_EDGE) y = Math.max(TIP_EDGE, cy - TIP_EDGE - h)
    host.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  }
  return {
    /** show these tooltip boxes (stacked, already laid out from 0,0) for the plot `el` */
    show(el: Element, nodes: SVGElement[], width: number, height: number): void {
      if (!host) {
        host = document.createElement('div')
        host.className = 'oe-float-tip'
        // above every tile and window, never in the way of the pointer
        Object.assign(host.style, {
          position: 'fixed',
          left: '0',
          top: '0',
          zIndex: '10000',
          pointerEvents: 'none',
          display: 'none'
        })
        svg = document.createElementNS(NS, 'svg')
        host.appendChild(svg)
        document.body.appendChild(host)
      }
      owner = el
      w = width
      h = height
      svg!.setAttribute('width', String(Math.ceil(width)))
      svg!.setAttribute('height', String(Math.ceil(height)))
      svg!.replaceChildren(...nodes)
      host.style.display = 'block'
      place()
    },
    /** the cursor moved (client px): follow it */
    move(el: Element, x: number, y: number): void {
      cx = x
      cy = y
      if (owner === el) place()
    },
    /** hide it — only if it's `el`'s (another plot may have taken it since) */
    hide(el: Element): void {
      if (owner !== el || !host) return
      owner = null
      host.style.display = 'none'
      svg!.replaceChildren()
    }
  }
})()

/**
 * Float Plotly's hover tooltip(s) out of the plot (floatTip): each `g.hovertext` is redrawn as a
 * plain rounded box around its text (no callout pointer), copied into the floating layer — several
 * (hovermode 'x') stack downward — and the original hidden. Called from a MutationObserver on the
 * hover layer (see bindHoverParking), so it runs after EVERY tooltip redraw and before the frame
 * paints — the original never flashes in the plot. An emptied hover layer hides the float.
 */
function floatHoverLabels(el: PlotlyGraphDiv): void {
  const node = el as unknown as Element
  const groups = node.querySelectorAll?.('g.hoverlayer g.hovertext')
  if (!groups || !groups.length) {
    floatTip.hide(node)
    return
  }
  const copies: SVGElement[] = []
  let y = 0
  let width = 0
  groups.forEach((g0) => {
    const g = g0 as SVGGElement
    const text = g.querySelector('text.nums') as SVGTextElement | null
    const path = g.querySelector('path')
    if (!text || !path) return
    // Left-align the text at the group origin (Plotly may have anchored it end/middle for a
    // left-pointing callout), then measure it — still laid out while hidden.
    text.setAttribute('text-anchor', 'start')
    text.setAttribute('x', '0')
    text.querySelectorAll('tspan').forEach((ts) => {
      if (ts.hasAttribute('x')) ts.setAttribute('x', '0')
    })
    g.style.visibility = 'hidden'
    const bb = text.getBBox()
    const w = bb.width + 2 * TIP_PAD
    const h = bb.height + 2 * TIP_PAD
    const bx = bb.x - TIP_PAD
    const by = bb.y - TIP_PAD
    const rr = 4
    // The copy: a plain rounded box around the text, its top-left corner at (0, y).
    const copy = g.cloneNode(true) as SVGGElement
    copy.style.visibility = 'visible'
    copy.setAttribute('transform', `translate(${-bx},${y - by})`)
    copy
      .querySelector('path')
      ?.setAttribute(
        'd',
        `M${bx + rr},${by}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - 2 * rr}` +
          `a${rr},${rr} 0 0 1 -${rr},${rr}h-${w - 2 * rr}a${rr},${rr} 0 0 1 -${rr},-${rr}` +
          `v-${h - 2 * rr}a${rr},${rr} 0 0 1 ${rr},-${rr}z`
      )
    copies.push(copy)
    width = Math.max(width, w)
    y += h + 4
  })
  if (!copies.length) floatTip.hide(node)
  // +1: the box's hairline border straddles its edge
  else floatTip.show(node, copies, width + 1, y - 4 + 1)
}

/** Watch the hover layer and float each tooltip Plotly draws (floatHoverLabels). Plotly redraws the
 *  tooltip on every mouse move but only emits plotly_hover when the hovered point CHANGES, so
 *  observing the DOM catches every redraw. The observer's own mutations are discarded
 *  (takeRecords) so it can't loop. The cursor (which the float follows) comes from a native
 *  mousemove on the div. Returns a cleanup that disconnects both and hides this plot's float. */
export function bindHoverParking(el: PlotlyGraphDiv): () => void {
  const node = el as unknown as Element
  const layer = node.querySelector?.('g.hoverlayer')
  if (!layer) return () => {}
  const onMove = (ev: MouseEvent): void => floatTip.move(node, ev.clientX, ev.clientY)
  const onLeave = (): void => floatTip.hide(node)
  el.addEventListener('mousemove', onMove)
  el.addEventListener('mouseleave', onLeave)
  const obs = new MutationObserver(() => {
    floatHoverLabels(el)
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
    el.removeEventListener('mouseleave', onLeave)
    floatTip.hide(node)
  }
}
