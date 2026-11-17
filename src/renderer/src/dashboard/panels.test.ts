import { describe, expect, it } from 'vitest'

import { autoLayout, reconcileLayout } from './panels'

describe('dashboard auto layout', () => {
  it('lays plots out the chosen number per row (3 by default)', () => {
    const at = (l: ReturnType<typeof autoLayout>) => l.map((it) => [it.x, it.y, it.w])
    expect(at(autoLayout(['a', 'b', 'c', 'd']))).toEqual([
      [0, 0, 16],
      [16, 0, 16],
      [32, 0, 16],
      [0, 14, 16]
    ])
    expect(at(autoLayout(['a', 'b', 'c'], 2))).toEqual([
      [0, 0, 24],
      [24, 0, 24],
      [0, 16, 24]
    ])
    expect(autoLayout(['a', 'b', 'c', 'd', 'e'], 4).map((it) => it.x)).toEqual([0, 12, 24, 36, 0])
  })

  it('keeps an arranged layout and adds new plots below it, per row', () => {
    const kept = [{ i: 'a', x: 0, y: 0, w: 48, h: 20 }]
    const out = reconcileLayout(kept, ['a', 'b', 'c', 'd', 'e'], 4)
    expect(out[0]).toEqual(kept[0])
    expect(out.slice(1).map((it) => [it.x, it.y])).toEqual([
      [0, 20],
      [12, 20],
      [24, 20],
      [36, 20]
    ])
  })
})
