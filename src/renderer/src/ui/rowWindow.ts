/** The rows a virtualised table renders, as [start, end) indices into its `n` rows: those under
 *  the viewport (`viewH` tall, scrolled `scrollTop` down) plus a margin of `pad` to `2·pad` rows
 *  either side. Rows are taken as `rowH` tall and begin `head` px into the scroller (below the
 *  header). The ends snap to multiples of `pad`, so a scroll re-renders only every `pad` rows. */
export function rowWindow(
  scrollTop: number,
  viewH: number,
  head: number,
  rowH: number,
  n: number,
  pad: number
): { start: number; end: number } {
  const h = Math.max(1, rowH)
  // first and one-past-last row any part of which is in view (the sticky header covers the top
  // `head` px of the viewport, so rows under it count as in view — harmless overdraw)
  const first = Math.floor((scrollTop - head) / h)
  const last = Math.ceil((scrollTop + viewH - head) / h)
  const start = Math.min(n, Math.max(0, Math.floor((first - pad) / pad) * pad))
  const end = Math.min(n, Math.max(start, Math.ceil((last + pad) / pad) * pad))
  return { start, end }
}
