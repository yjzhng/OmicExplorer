/** The virtualised table's row window: which rows render for a scroll position and viewport. */
import { describe, expect, it } from 'vitest'

import { rowWindow } from './rowWindow'

describe('rowWindow', () => {
  it('renders the top rows plus a margin when not scrolled', () => {
    // 30px header, 20px rows, 200px viewport: rows 0–9 in view, margin of 10 below
    expect(rowWindow(0, 200, 30, 20, 500, 10)).toEqual({ start: 0, end: 20 })
  })

  it('covers every row in view with at least `pad` rows either side', () => {
    for (const top of [0, 7, 333, 1234, 5000]) {
      const { start, end } = rowWindow(top, 300, 30, 24, 500, 10)
      const first = Math.floor((top - 30) / 24)
      const last = Math.ceil((top + 300 - 30) / 24)
      expect(start).toBeLessThanOrEqual(Math.max(0, first - 10))
      expect(end).toBeGreaterThanOrEqual(Math.min(500, last + 10))
      expect(start % 10).toBe(0)
    }
  })

  it('snaps to blocks, so a small scroll keeps the same window', () => {
    expect(rowWindow(1000, 300, 30, 20, 500, 10)).toEqual(rowWindow(1010, 300, 30, 20, 500, 10))
  })

  it('clamps to the rows there are', () => {
    expect(rowWindow(0, 1000, 30, 20, 7, 10)).toEqual({ start: 0, end: 7 })
    // scrolled past the end of a table a filter just shortened: an empty window, never inverted
    expect(rowWindow(99999, 300, 30, 20, 50, 10)).toEqual({ start: 50, end: 50 })
    expect(rowWindow(0, 300, 30, 20, 0, 10)).toEqual({ start: 0, end: 0 })
  })

  it('tolerates an unmeasured row height', () => {
    expect(rowWindow(0, 0, 0, 0, 100, 10)).toEqual({ start: 0, end: 10 })
  })
})
