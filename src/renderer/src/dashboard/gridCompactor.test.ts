import { describe, expect, it } from 'vitest'
import { gravityCompactor, gravityLayout, rowSwap } from './gridCompactor'

type T = { i: string; x: number; y: number; w: number; h: number }
const pos = (l: T[]): Record<string, [number, number]> =>
  Object.fromEntries(l.map((t) => [t.i, [t.x, t.y]]))

// four 12-wide tiles in a row of a 48-column grid, and one below
const ROW: T[] = [
  { i: '1', x: 0, y: 0, w: 12, h: 8 },
  { i: '2', x: 12, y: 0, w: 12, h: 8 },
  { i: '3', x: 24, y: 0, w: 12, h: 8 },
  { i: '4', x: 36, y: 0, w: 12, h: 8 },
  { i: '5', x: 0, y: 8, w: 16, h: 8 }
]

describe('gravityLayout', () => {
  it('floats every tile up, keeping sideways gaps', () => {
    const out = gravityLayout([
      { i: 'a', x: 20, y: 10, w: 12, h: 8 },
      { i: 'b', x: 0, y: 30, w: 12, h: 8 }
    ])
    expect(pos(out)).toEqual({ a: [20, 0], b: [0, 0] })
  })

  it('a held tile stays put and what it overlaps goes below it', () => {
    // 5 held up over 1 and 2: they go below it; the rest float
    const out = gravityLayout(
      ROW.map((t) => (t.i === '5' ? { ...t, y: 0 } : t)),
      '5'
    )
    expect(pos(out)).toEqual({ '1': [0, 8], '2': [12, 8], '3': [24, 0], '4': [36, 0], '5': [0, 0] })
  })

  it('returns tiles in the order given', () => {
    expect(gravityLayout([...ROW].reverse()).map((t) => t.i)).toEqual(['5', '4', '3', '2', '1'])
  })
})

describe('rowSwap', () => {
  const held = (id: string, x: number, y = 0) => ({ ...ROW.find((t) => t.i === id)!, x, y })

  it('trades places once the middle passes the neighbour’s', () => {
    // 1 dragged right, its middle (6 → 19) past 2's (18)
    const out = rowSwap(ROW, '1', held('1', 13), 19, 48)
    expect(pos(out!)).toMatchObject({ '1': [12, 0], '2': [0, 0] })
  })

  it('not yet past the middle: the row keeps its order', () => {
    const out = rowSwap(ROW, '1', held('1', 5), 11, 48)
    expect(pos(out!)).toMatchObject({ '1': [0, 0], '2': [12, 0] })
  })

  it('swaps with the leftmost tile, by the pointer’s middle past the grid edge', () => {
    // 2 dragged fully left: its cell is clamped at 0, middle level with 1's — the pointer's past it
    const out = rowSwap(ROW, '2', held('2', 0), 5, 48)
    expect(pos(out!)).toMatchObject({ '1': [12, 0], '2': [0, 0] })
  })

  it('keeps the row’s gaps by position', () => {
    // a gap of 6 between a and b; c dragged to the front takes a's slot, a and b shift along
    const base: T[] = [
      { i: 'a', x: 0, y: 0, w: 10, h: 8 },
      { i: 'b', x: 16, y: 0, w: 10, h: 8 },
      { i: 'c', x: 26, y: 0, w: 10, h: 8 }
    ]
    const out = rowSwap(base, 'c', { ...base[2], x: 0 }, 3, 48)
    expect(pos(out!)).toEqual({ c: [0, 0], a: [16, 0], b: [26, 0] })
  })

  it('over free space in the row, or out of the row: not a swap', () => {
    const roomy: T[] = [
      { i: 'a', x: 0, y: 0, w: 12, h: 8 },
      { i: 'b', x: 12, y: 0, w: 12, h: 8 }
    ]
    expect(rowSwap(roomy, 'a', { ...roomy[0], x: 30 }, 36, 48)).toBeNull()
    // more than half its height down
    expect(rowSwap(ROW, '1', held('1', 13, 5), 19, 48)).toBeNull()
  })
})

describe('gravityCompactor', () => {
  it('during a drag the held tile stays where it is held; on release it floats up', () => {
    const flow = gravityCompactor()
    flow.begin(ROW, '5', 'resize')
    // 5 dragged down into empty space (a resize step, so no swap logic)
    const moved = ROW.map((t) => (t.i === '5' ? { ...t, y: 20 } : t))
    flow.step()
    expect(pos(flow.compactor.compact(moved, 48))['5']).toEqual([0, 20])
    // the release compaction comes unmarked: it settles
    expect(pos(flow.compactor.compact(moved, 48))['5']).toEqual([0, 8])
    flow.end()
  })

  it('a drag along the row swaps', () => {
    const flow = gravityCompactor()
    flow.begin(ROW, '1', 'drag')
    flow.step(19)
    const moved = ROW.map((t) => (t.i === '1' ? { ...t, x: 13 } : t))
    expect(pos(flow.compactor.compact(moved, 48))).toMatchObject({ '1': [12, 0], '2': [0, 0] })
    flow.end()
  })
})
