/** Defer expensive tile content until it is scrolled near the viewport.
 *
 *  A dashboard tab holds several plots; building them all up front blocks the main
 *  thread for a second or more, and the ones below the fold are not even being
 *  looked at. This reports "has this element ever come close to view", so a tile can
 *  mount its chart on approach and then stay mounted (re-tearing it down on every
 *  scroll would trade one stall for many).
 */
import { useEffect, useRef, useState, type RefObject } from 'react'

export function useInView<T extends HTMLElement>(
  rootMargin = '400px'
): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    if (seen) return
    const el = ref.current
    // No observer (older runtime / jsdom) → render eagerly rather than never.
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true)
      },
      { rootMargin }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen, rootMargin])

  return [ref, seen]
}
