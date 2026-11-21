/** Where a windowed list's rows sit, and which of them to draw (ui/VirtualRows). */
import { describe, expect, it } from 'vitest'

import { indexKeys, RowLayout } from './rowLayout'

const uniform = (n: number, h = 20): RowLayout => {
  const l = new RowLayout(h)
  l.setKeys(indexKeys(n))
  return l
}

describe('RowLayout', () => {
  it('draws the rows in view plus a margin when not scrolled', () => {
    // 20px rows, 200px view: rows 0–9 in view, then at least 10 more
    expect(uniform(500).window(0, 200, 10)).toEqual({ start: 0, end: 30 })
  })

  it('covers every row in view with at least `pad` rows either side, snapped to blocks', () => {
    const l = uniform(500, 24)
    for (const top of [0, 7, 333, 1234, 5000]) {
      const { start, end } = l.window(top, 300, 10)
      const first = Math.floor(top / 24)
      const last = Math.floor((top + 300) / 24)
      expect(start).toBeLessThanOrEqual(Math.max(0, first - 10))
      expect(end).toBeGreaterThanOrEqual(Math.min(500, last + 11))
      expect(start % 10).toBe(0)
    }
  })

  it('keeps the same window over a small scroll', () => {
    const l = uniform(500)
    expect(l.window(1000, 300, 10)).toEqual(l.window(1010, 300, 10))
  })

  it('clamps to the rows there are', () => {
    expect(uniform(7).window(0, 1000, 10)).toEqual({ start: 0, end: 7 })
    expect(uniform(0).window(0, 300, 10)).toEqual({ start: 0, end: 0 })
    // scrolled past the end of a list that just got shorter: its last rows, never inverted
    const { start, end } = uniform(50).window(99999, 300, 10)
    expect(end).toBe(50)
    expect(start).toBeLessThan(end)
  })

  it('places unmeasured rows at the most common measured height', () => {
    const l = uniform(100, 24)
    expect(l.offset(10)).toBe(240)
    l.record(0, 30)
    l.record(1, 30)
    l.record(2, 50)
    // two rows of 30, one of 50: the rest taken at 30 (not the 36.7 average)
    expect(l.offset(3)).toBe(110)
    expect(l.offset(100)).toBe(110 + 97 * 30)
  })

  it("holds the whole list's height steady as rows of another kind come into view", () => {
    // a list mostly of 22px rows with a 30px header every 10th: scrolling down measures the rows
    // in view; the total — what sizes the scrollbar — changes only by the rows actually seen
    const keys = indexKeys(1000)
    const h = (i: number): number => (i % 10 === 0 ? 30 : 22)
    const l = new RowLayout(24)
    l.setKeys(keys)
    for (let i = 0; i < 40; i++) l.record(i, h(i))
    const total = l.offset(1000)
    for (let i = 40; i < 80; i++) l.record(i, h(i))
    // only rows 40–79's own differences from 22 (four headers × 8px) moved it
    expect(l.offset(1000) - total).toBe(4 * 8)
  })

  it('places rows of two heights exactly once measured — a tree of headers and leaves', () => {
    const keys = ['h1', 'a', 'b', 'h2', 'c']
    const l = new RowLayout(24)
    l.setKeys(keys)
    for (const k of keys) l.record(k, k.startsWith('h') ? 30 : 20)
    expect([0, 1, 2, 3, 4, 5].map((i) => l.offset(i))).toEqual([0, 30, 50, 70, 100, 120])
    expect(l.indexAt(69)).toBe(2)
    expect(l.indexAt(70)).toBe(3)
  })

  it('keeps a height with its row when the rows change around it', () => {
    const l = new RowLayout(20)
    l.setKeys(['a', 'b', 'c'])
    l.record('c', 50)
    // 'c' moves to the top (a re-sort): still 50 tall
    l.setKeys(['c', 'a', 'b'])
    expect(l.height(0)).toBe(50)
    // a new row not measured yet: the average so far
    l.setKeys(['c', 'd'])
    expect(l.height(1)).toBe(50)
  })

  it('reports whether a measure changed anything', () => {
    const l = uniform(3)
    expect(l.record(0, 22)).toBe(true)
    expect(l.record(0, 22.2)).toBe(false)
    expect(l.record(0, 0)).toBe(false)
  })
})
