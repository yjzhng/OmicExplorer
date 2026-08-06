import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Track an element's rendered size via ResizeObserver, seeded synchronously.
 *
 * The seed read matters: ResizeObserver only fires after the document paints, and
 * a backgrounded/occluded window may not paint for a long time — waiting for its
 * first callback would leave the grid stuck at width 0 (a blank dashboard).
 */
export function useElementSize<T extends HTMLElement>(): { ref: RefObject<T | null>; width: number; height: number } {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = (): void => {
      const { width, height } = el.getBoundingClientRect()
      // A hidden element (a dashboard tab switched away from) measures 0×0. Report the
      // last known size instead of a collapse, so consumers don't tear their content
      // down and rebuild it every time the element is hidden and shown again.
      if (width === 0 && height === 0) return
      setSize((prev) =>
        Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
          ? prev
          : { width, height }
      )
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { ref, ...size }
}
