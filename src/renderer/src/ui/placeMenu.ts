import type { CSSProperties } from 'react'

/** Where a dropdown of width `w` (at most `h` tall) floats off its button's `rect`: below it,
 *  capped to the room left there (the list scrolls) — or above it when there's little room below
 *  and more above. Kept inside the window's left and right edges. */
export function placeMenu(rect: DOMRect, w: number, h: number): CSSProperties {
  const below = window.innerHeight - rect.bottom - 4 - 8
  const above = rect.top - 4 - 8
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 8 - w))
  return below < 200 && above > below
    ? { left, bottom: window.innerHeight - rect.top + 4, maxHeight: Math.min(h, above) }
    : { left, top: rect.bottom + 4, maxHeight: Math.min(h, below) }
}
