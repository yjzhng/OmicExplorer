import { useLayoutEffect } from 'react'

/** Give a scrolling list a shrink floor: `floor` px, or its whole content when that's shorter (so a
 *  short list isn't padded out) — unless `reserve`, which keeps the whole floor as room to grow. Re-applied after every render, as the content changes with it;
 *  written straight to the element (React never sets its min-height), so it costs no re-render.
 *  The content is measured with the old floor lifted: read under it, a list whose content had
 *  shrunk measured as the old floor (scrollHeight is at least the box), so the floor never came
 *  down — and with a border (box-sizing: border-box) it crept down a pixel per render, the menu
 *  visibly shrinking with each keystroke. */
export function useShrinkFloor(
  ref: { current: HTMLElement | null },
  floor: number,
  /** keep the floor even when the content is shorter (empty room below it) */
  reserve = false
): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (reserve) {
      el.style.minHeight = `${floor}px`
      return
    }
    el.style.minHeight = ''
    // scrollHeight leaves out the border; min-height (border-box) includes it
    const border = el.offsetHeight - el.clientHeight
    el.style.minHeight = `${Math.min(floor, el.scrollHeight + border)}px`
  })
}
