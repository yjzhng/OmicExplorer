/**
 * Measuring for the samplesheet grid: a select's width for its labels, and whether more lies below
 * a scroller.
 */
import { type RefObject, useLayoutEffect, useState } from 'react'

/** The samplesheet's rename bar: pick a condition and one of its current values, type the new
 *  name, Rename — every sample carrying that value takes the new one. Says how many samples it
 *  changes before it's applied. */
/** The width of an app select (ui/controls/Select) just wide enough for its longest option: that label in the
 *  select's 12px text, plus the button's padding (7 + 7), gap (6), chevron (11) and border (1 + 1),
 *  and 2px so rounding never ellipsizes it. */
let measureCtx: CanvasRenderingContext2D | null | undefined
export function selectWidthFor(labels: string[]): number {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return 120
  measureCtx.font = `12px ${getComputedStyle(document.body).fontFamily}`
  const ctx = measureCtx
  const text = Math.max(0, ...labels.map((l) => ctx.measureText(l).width))
  return Math.ceil(text) + 7 + 7 + 6 + 11 + 2 + 2
}

/** Whether a scroll box has content below what it shows — for a fade at its bottom edge. Follows
 *  its scrolling and any change of its size or its content's. */
export function useMoreBelow(ref: RefObject<HTMLElement | null>): boolean {
  const [more, setMore] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (): void => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 1)
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    for (const c of Array.from(el.children)) ro.observe(c)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [ref])
  return more
}
