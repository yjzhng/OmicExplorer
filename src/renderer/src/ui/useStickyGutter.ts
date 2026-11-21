/**
 * A table's scrollbars span only the part that scrolls. Its scroller takes `TABLE_SCROLL` (the
 * app's scrollbar, app.css .oe-tablescroll) and this hook, which measures the sticky parts — the
 * header rows pinned at the top (a <thead>'s sticky cells), the columns pinned at the left (a
 * row's leading sticky cells) — and hands their size and colours to the scrollbars as CSS
 * variables:
 *  - the vertical track starts below the header, and the gutter beside the header is painted as
 *    the header (its background and bottom rule), so the header runs to the edge and the gutter
 *    only runs beside the rows;
 *  - the horizontal track starts right of the pinned columns, its gutter there painted as them.
 * Measured on resize (not on scroll — sticky parts don't change size as they scroll), and written
 * straight onto the element, so nothing re-renders.
 */
import { useLayoutEffect, type RefObject } from 'react'

/** The class a table's scroller takes (with useStickyGutter). */
export const TABLE_SCROLL = 'oe-scroll oe-tablescroll'

const CLEAR = 'rgba(0, 0, 0, 0)'

interface Sticky {
  headH: number
  headBg: string
  headLine: string
  headLineW: number
  stickW: number
  stickBg: string
}

/** The sticky parts of the table in scroller `sc`. */
export function measureSticky(sc: HTMLElement): Sticky {
  const box = sc.getBoundingClientRect()
  const out: Sticky = { headH: 0, headBg: '', headLine: '', headLineW: 0, stickW: 0, stickBg: '' }
  // Header rows: a row is pinned when its first cell is (rows are styled whole).
  for (const tr of sc.querySelectorAll('thead tr')) {
    const cell = tr.firstElementChild
    if (!(cell instanceof HTMLElement)) continue
    const cs = getComputedStyle(cell)
    if (cs.position !== 'sticky') continue
    const r = cell.getBoundingClientRect()
    const bottom = Math.max(0, Math.round(r.bottom - box.top - sc.clientTop))
    if (bottom < out.headH) continue
    out.headH = bottom
    if (cs.backgroundColor !== CLEAR) out.headBg = cs.backgroundColor
    const lw = parseFloat(cs.borderBottomWidth) || 0
    out.headLineW = lw
    out.headLine = lw > 0 ? cs.borderBottomColor : ''
  }
  // Pinned columns: the first body row's leading sticky cells.
  const row = sc.querySelector('tbody tr:not([data-vr-spacer])')
  if (row)
    for (const cell of row.children) {
      if (!(cell instanceof HTMLElement)) break
      const cs = getComputedStyle(cell)
      if (cs.position !== 'sticky') break
      const r = cell.getBoundingClientRect()
      out.stickW = Math.max(0, Math.round(r.right - box.left - sc.clientLeft))
      if (cs.backgroundColor !== CLEAR) out.stickBg = cs.backgroundColor
    }
  return out
}

/** Keeps `ref`'s scrollbars to the part of its table that scrolls (see above). */
export function useStickyGutter(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const sc = ref.current
    if (!sc) return
    const apply = (): void => {
      // hidden (a tab switched away from): measures nothing; keep what it had
      if (sc.offsetParent === null) return
      const s = measureSticky(sc)
      const set = (k: string, v: string): void => {
        if (sc.style.getPropertyValue(k) !== v) sc.style.setProperty(k, v)
      }
      set('--head-h', `${s.headH}px`)
      set('--head-bg', s.headBg || 'transparent')
      set('--head-line', s.headLine || 'transparent')
      set('--head-lw', `${s.headLineW}px`)
      set('--stick-w', `${s.stickW}px`)
      set('--stick-bg', s.stickBg || 'transparent')
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(sc)
    // the content: a header re-wrapping, columns resized or pinned, the table filling in
    for (const c of sc.children) ro.observe(c)
    const table = sc.querySelector('table')
    if (table) ro.observe(table)
    return () => ro.disconnect()
  }, [ref])
}
