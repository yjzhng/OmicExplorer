/** Which edges of a scroll box have content scrolled out past them, and the short fade drawn on
 *  each such edge — the cue every scrolling view gives that there's more (the data tables'
 *  ScrollFade, the set comparison's matrix). */
import { type CSSProperties, type RefObject, useCallback, useLayoutEffect, useState } from 'react'

export interface ScrollEdges {
  top: boolean
  bottom: boolean
  left: boolean
  right: boolean
}

export const NO_EDGES: ScrollEdges = { top: false, bottom: false, left: false, right: false }

/** The edges of `el` with content out of view past them. */
export function scrollEdgesOf(el: HTMLElement): ScrollEdges {
  return {
    top: el.scrollTop > 0,
    bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    left: el.scrollLeft > 0,
    right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1
  }
}

const same = (a: ScrollEdges, b: ScrollEdges): boolean =>
  a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right

/** A scroll box's edges, kept up to date as it scrolls and as it or its content resizes. Returns
 *  them and the update (for a box that scrolls in ways no scroll event reports). */
export function useScrollEdges(ref: RefObject<HTMLElement | null>): [ScrollEdges, () => void] {
  const [edges, setEdges] = useState(NO_EDGES)
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const next = scrollEdgesOf(el)
    setEdges((prev) => (same(prev, next) ? prev : next))
  }, [ref])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    for (const c of el.children) ro.observe(c)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [ref, update])
  return [edges, update]
}

/** How deep a fade runs in, px, and how dark it starts. */
const FADE_PX = 10
const SHADE = 'rgba(0,0,0,0.1)'

/** Each edge's fade: an absolutely placed strip over the box's edge (the caller places it — its
 *  insets past a border, a header or a scrollbar). */
export const FADE: Record<keyof ScrollEdges, CSSProperties> = {
  top: {
    position: 'absolute',
    pointerEvents: 'none',
    zIndex: 2,
    top: 0,
    left: 0,
    right: 0,
    height: FADE_PX,
    background: `linear-gradient(to bottom, ${SHADE}, transparent)`
  },
  bottom: {
    position: 'absolute',
    pointerEvents: 'none',
    zIndex: 2,
    bottom: 0,
    left: 0,
    right: 0,
    height: FADE_PX,
    background: `linear-gradient(to top, ${SHADE}, transparent)`
  },
  left: {
    position: 'absolute',
    pointerEvents: 'none',
    zIndex: 2,
    top: 0,
    bottom: 0,
    left: 0,
    width: FADE_PX,
    background: `linear-gradient(to right, ${SHADE}, transparent)`
  },
  right: {
    position: 'absolute',
    pointerEvents: 'none',
    zIndex: 2,
    top: 0,
    bottom: 0,
    right: 0,
    width: FADE_PX,
    background: `linear-gradient(to left, ${SHADE}, transparent)`
  }
}
