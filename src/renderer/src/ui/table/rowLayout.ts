/**
 * Where each row of a windowed list sits (ui/table/VirtualRows): rows measured as they're drawn, by
 * key, so a height outlives filtering and re-ordering; rows not drawn yet are taken at the most
 * common height measured so far. Rows of a few heights (a tree's headers and leaves) then place
 * exactly once seen, and nothing above the view moves while scrolling down.
 *
 * The most common height, not the average: the rows still to come are mostly that kind, and it
 * holds still as more are seen — an average drifts with the mix in view, and every drift resized
 * the whole list under a dragged scrollbar, so its thumb slid away from the pointer.
 */
export type RowKey = string | number

export class RowLayout {
  private heights = new Map<RowKey, number>()
  /** measured rows per height (to the quarter pixel), for the most common */
  private tally = new Map<number, number>()
  private common = 0
  private keys: RowKey[] = []
  private offsets = new Float64Array(1)
  private dirty = true

  constructor(private guess = 24) {}

  /** The rows, in order, by key (index when the caller has no better one). */
  setKeys(keys: RowKey[]): void {
    this.keys = keys
    this.dirty = true
  }
  /** Row i's key (undefined past the end). */
  keyAt(i: number): RowKey | undefined {
    return this.keys[i]
  }
  get count(): number {
    return this.keys.length
  }
  /** The height assumed for a row not drawn yet: the most common measured, else the guess. */
  estimate(): number {
    return this.common || this.guess
  }
  private count1(px: number, by: number): void {
    const b = Math.round(px * 4) / 4
    const n = (this.tally.get(b) ?? 0) + by
    if (n > 0) this.tally.set(b, n)
    else this.tally.delete(b)
    // the most common height; on a tie, the one already held (so it doesn't flicker)
    let best = this.tally.get(this.common) ?? 0
    for (const [h, c] of this.tally)
      if (c > best) {
        best = c
        this.common = h
      }
    if (!this.tally.has(this.common)) this.common = 0
  }
  /** Row `key` measured `px` tall (its pitch: gaps between rows included). True when that changed
   *  anything. */
  record(key: RowKey, px: number): boolean {
    if (!(px > 0)) return false
    const was = this.heights.get(key)
    if (was != null && Math.abs(was - px) < 0.5) return false
    if (was != null) this.count1(was, -1)
    this.count1(px, 1)
    this.heights.set(key, px)
    this.dirty = true
    return true
  }
  private build(): void {
    if (!this.dirty) return
    const n = this.keys.length
    if (this.offsets.length !== n + 1) this.offsets = new Float64Array(n + 1)
    const est = this.estimate()
    let y = 0
    for (let i = 0; i < n; i++) {
      this.offsets[i] = y
      y += this.heights.get(this.keys[i]) ?? est
    }
    this.offsets[n] = y
    this.dirty = false
  }
  /** Top of row i (i = count → the total height). */
  offset(i: number): number {
    this.build()
    return this.offsets[Math.max(0, Math.min(this.keys.length, i))]
  }
  height(i: number): number {
    return this.offset(i + 1) - this.offset(i)
  }
  /** The row at `y` px down the list (clamped to the rows there are; 0 when there are none). */
  indexAt(y: number): number {
    this.build()
    const n = this.keys.length
    if (n === 0 || y <= 0) return 0
    if (y >= this.offsets[n]) return n - 1
    let lo = 0
    let hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.offsets[mid] <= y) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  /** The rows to draw, [start, end): those in a view `view` px tall scrolled `scroll` px into the
   *  list, with `pad` to 2·pad rows either side. The ends snap to multiples of `pad`, so a scroll
   *  re-renders only every `pad` rows. */
  window(scroll: number, view: number, pad: number): { start: number; end: number } {
    const n = this.keys.length
    if (n === 0) return { start: 0, end: 0 }
    const first = this.indexAt(scroll)
    const last = scroll + view <= 0 ? 0 : this.indexAt(scroll + view)
    const start = Math.min(n, Math.max(0, Math.floor((first - pad) / pad) * pad))
    const end = Math.min(n, Math.max(start, Math.ceil((last + 1 + pad) / pad) * pad))
    return { start, end }
  }
}

/** 0, 1, … n−1: the keys of a list keyed by position. */
export function indexKeys(n: number): number[] {
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) out[i] = i
  return out
}
