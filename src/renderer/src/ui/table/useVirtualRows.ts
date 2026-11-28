/**
 * Long content, one way: every list, table or tree whose length grows with the data (genes,
 * matrix rows, a column's values, pathways, gene-group members, comparisons…) renders through
 * here. Only the rows in and around the view are in the DOM; a spacer above and below stands in for
 * the rest, so the scrollbar shows the true length and every row is reachable by scrolling — no
 * caps, no "+N more — refine search", no "show more" paging. A list of RENDER_ALL_ROWS or fewer
 * renders whole (nothing to gain; find-in-page and select-all copy keep working).
 *
 * Rows are measured as they're drawn (ui/table/rowLayout: by key, the rest at the average so far), so
 * rows of a few heights — a tree's headers and leaves — place exactly; keep each row's height
 * fixed (one line: truncate with an ellipsis rather than wrap). The list's element holds the rows
 * and nothing else but what this draws. The scroller is found by itself (the nearest
 * scrolling ancestor), so a list inside a dialog pane, a portalled menu or a tile just works; pass
 * `scrollRef` only when that guess would be wrong.
 *
 * Pieces: `useVirtualRows` here (the window + spacers' heights) and `longestText` (a column's
 * widest text from a sample, for a probe row that keeps auto-sized columns from jumping as rows
 * scroll in and out); the components that draw them in ./VirtualRows (`VirtualList`, a flat list
 * in a <div>; `VirtualTbody`, a table body; `ProbeRow`).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { indexKeys, RowLayout, type RowKey } from './rowLayout'

/** Lists this long or shorter render every row. */
export const RENDER_ALL_ROWS = 100
/** Row height assumed until rows are measured. */
const ROW_H_GUESS = 24
/** How near (px) the view must come to the list's end for `onEnd`. */
const NEAR_END_PX = 200
/** Rows kept beyond each edge of the view — also the block the window moves in, so a scroll
 *  re-renders every so many rows, not every row. */
const WINDOW_PAD = 10

/** The element that scrolls `el` vertically — itself or its nearest ancestor that does, by overflow
 *  style (not whether it overflows now: a list that's still short will grow) — else the page. */
export function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll' || o === 'overlay') return p
  }
  return (document.scrollingElement as HTMLElement | null) ?? null
}

export interface VirtualRows<E extends HTMLElement> {
  /** the rendered rows: [start, end) */
  start: number
  end: number
  /** height (px) of the rows above / below the window — the spacers' heights */
  before: number
  after: number
  /** whether the list is windowed at all (longer than RENDER_ALL_ROWS) */
  windowed: boolean
  /** the ref for the element holding the rows */
  attach: (el: E | null) => void
  /** bring row `i` into view, scrolling only the list's own scroller (never its ancestors);
   *  `coveredTop` = px at the top of the view hidden under something sticky (a table's header) */
  scrollToIndex: (i: number, coveredTop?: number) => void
}

export interface VirtualRowsOptions {
  /** the element that scrolls the list, when the nearest scrolling ancestor isn't it */
  scroller?: () => HTMLElement | null
  /** row i's identity, so its measured height follows it through filtering and re-ordering (a
   *  tree's rows as groups open and close) — memoise it; default: its position */
  keyOf?: (i: number) => RowKey
  /** called when the view nears the list's end — a source that pages in (a cache read in chunks)
   *  loads its next chunk here, so scrolling on simply carries on; guard against calls while one
   *  is in flight (pass undefined then, or when everything's in) */
  onEnd?: () => void
}

/** The window of `count` rows to render, kept in step with the scroller's position and size. */
export function useVirtualRows<E extends HTMLElement = HTMLDivElement>(
  count: number,
  opts: VirtualRowsOptions = {}
): VirtualRows<E> {
  const windowed = count > RENDER_ALL_ROWS
  // The list's element, as state: the effects below follow it as it mounts and changes.
  const [list, attach] = useState<E | null>(null)
  const scroller = useRef<HTMLElement | null>(null)
  const [win, setWin] = useState({ start: 0, end: 5 * WINDOW_PAD, ver: 0 })
  const { keyOf, scroller: givenScroller, onEnd } = opts
  // the latest onEnd, for the scroll listener
  const endCb = useRef(onEnd)
  useLayoutEffect(() => {
    endCb.current = onEnd
  })
  const follows = windowed || !!onEnd
  const keys = useMemo(
    () => (keyOf ? Array.from({ length: count }, (_, i) => keyOf(i)) : indexKeys(count)),
    [count, keyOf]
  )
  // Where each row sits — one mutable object for the list's life (state, so render may read it).
  const [layout] = useState(() => new RowLayout(ROW_H_GUESS))
  useMemo(() => layout.setKeys(keys), [layout, keys])
  const start = windowed ? Math.min(win.start, count) : 0
  const end = windowed ? Math.min(win.end, count) : count
  // The rows on screen, so a measure knows which index each rendered row is.
  const drawn = useRef(0)
  useLayoutEffect(() => {
    drawn.current = start
  })

  const geometry = useCallback(() => {
    const sc = scroller.current
    // Hidden (display:none — a tab switched away from) measures all zeros: keep the last window.
    if (!list || !sc || list.offsetParent === null) return null
    // Where row 0 starts inside the scroller's content.
    const top =
      list === sc
        ? 0
        : list.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
    const view = sc === document.scrollingElement ? window.innerHeight : sc.clientHeight
    return { sc, top, view }
  }, [list])

  const measure = useCallback(() => {
    const g = geometry()
    if (!g || !list) return
    if (endCb.current && g.sc.scrollTop + g.view >= g.top + list.offsetHeight - NEAR_END_PX)
      endCb.current()
    if (!windowed) return
    // Each rendered row's pitch (its top to the next row's: gaps included), recorded by key. Read
    // as exact fractions (getBoundingClientRect), not offsetTop's whole pixels: rounded, a row's
    // pitch flips a pixel with where it happens to sit, so each re-placing re-measured it
    // differently and the window chased itself for seconds.
    const rows: DOMRect[] = []
    for (const c of list.children)
      if (c instanceof HTMLElement && c.dataset.vrSpacer == null)
        rows.push(c.getBoundingClientRect())
    let changed = false
    let gap = 0
    for (let k = 0; k < rows.length; k++) {
      const key = layout.keyAt(drawn.current + k)
      if (key == null) break
      const r = rows[k]
      const next = rows[k + 1]
      if (next) gap = Math.max(0, next.top - r.bottom)
      const pitch = next ? next.top - r.top : r.height + gap
      if (layout.record(key, pitch)) changed = true
    }
    const { start: s, end: e } = layout.window(g.sc.scrollTop - g.top, g.view, WINDOW_PAD)
    setWin((w) =>
      w.start === s && w.end === e && !changed ? w : { start: s, end: e, ver: w.ver + 1 }
    )
  }, [geometry, layout, list, windowed])

  // Follow the scroller: its scrolls, and its and the list's resizes (a tile resized, rows drawn
  // at a new height). The observer reports each box once as it starts watching — the first
  // measure, after layout.
  useLayoutEffect(() => {
    const sc = givenScroller?.() ?? scrollParent(list)
    scroller.current = sc
    if (!follows || !list || !sc) return
    const target: HTMLElement | Window = sc === document.scrollingElement ? window : sc
    target.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(() => measure())
    ro.observe(sc === document.scrollingElement ? document.body : sc)
    ro.observe(list)
    return () => {
      target.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [follows, measure, list, givenScroller])
  // New rows (a search narrowing, a group opening): the window may need to move.
  useEffect(() => {
    // a DOM measure, then the window it calls for
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (follows) measure()
  }, [follows, keys, measure])

  // Bring row i into view: now, by where it's placed so far, and again once the rows the jump
  // drew are measured (a far row's place firms up then) — only ever scrolling when it's out of view.
  const placeRow = useCallback(
    (i: number, coveredTop: number) => {
      const g = geometry()
      if (!g) return
      const { sc, top, view } = g
      let y: number
      let h: number
      const el = !windowed ? list?.children[i] : null
      if (el instanceof HTMLElement) {
        y = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
        h = el.offsetHeight
      } else {
        y = top + layout.offset(i)
        h = layout.height(i)
      }
      if (y < sc.scrollTop + coveredTop) sc.scrollTop = y - coveredTop
      else if (y + h > sc.scrollTop + view) sc.scrollTop = y + h - view
    },
    [geometry, windowed, layout, list]
  )
  const scrollToIndex = useCallback(
    (i: number, coveredTop = 0) => {
      placeRow(i, coveredTop)
      if (windowed)
        requestAnimationFrame(() => requestAnimationFrame(() => placeRow(i, coveredTop)))
    },
    [placeRow, windowed]
  )

  return {
    start,
    end,
    before: windowed ? layout.offset(start) : 0,
    after: windowed ? layout.offset(count) - layout.offset(end) : 0,
    windowed,
    attach,
    scrollToIndex
  }
}

/** The indices [start, end) — for mapping a window to rows. */
export function range(start: number, end: number): number[] {
  const out = new Array<number>(Math.max(0, end - start))
  for (let i = 0; i < out.length; i++) out[i] = start + i
  return out
}

/** Rows a width probe reads at most: all of a shorter list, else the first rows and an even
 *  stride through the rest. */
const PROBE_SAMPLE = 2000
/** The longest of `count` texts (by length), read from a sample when there are many — what a probe
 *  row lays out so a windowed table's auto-sized columns fit every row, not just those rendered,
 *  and don't jump as rows scroll in. */
export function longestText(count: number, text: (i: number) => string): string {
  let best = ''
  const take = (i: number): void => {
    const t = text(i)
    if (t.length > best.length) best = t
  }
  if (count <= PROBE_SAMPLE) {
    for (let i = 0; i < count; i++) take(i)
    return best
  }
  const head = PROBE_SAMPLE / 4
  for (let i = 0; i < head; i++) take(i)
  const step = (count - head) / (PROBE_SAMPLE - head)
  for (let k = 0; k < PROBE_SAMPLE - head; k++) take(head + Math.floor(k * step))
  return best
}
