import { describe, expect, it, vi } from 'vitest'

// the bundle needs a browser; geneTicks doesn't touch it
vi.mock('plotly.js-strict-dist-min', () => ({ default: {} }))

import { blockVeilRects, geneTicks } from './heatmapFocus'

describe('geneTicks', () => {
  it('labels every gene when they all fit', () => {
    expect(geneTicks(0, 4, 100, 16, new Set()).ticks).toEqual([0, 1, 2, 3, 4])
  })

  it('thins to every n-th gene when they do not', () => {
    // 160px / 16px = 10 labels for 100 genes → every 10th
    const { ticks } = geneTicks(0, 99, 160, 16, new Set())
    expect(ticks).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90])
  })

  it('adds a lit gene and drops the ticks too close to it', () => {
    const { ticks, lit } = geneTicks(0, 99, 160, 16, new Set([33]))
    expect(lit).toEqual(new Set([33]))
    expect(ticks).toEqual([0, 10, 20, 33, 50, 60, 70, 80, 90])
  })

  it('ignores lit genes outside the shown span', () => {
    expect(geneTicks(10, 19, 160, 16, new Set([5])).lit.size).toBe(0)
  })
})

describe('blockVeilRects', () => {
  // one px per cell: position i spans i − ½ … i + ½ → px [i, i + 1]
  const ax = { _offset: 0, _length: 4, l2p: (v: number) => v + 0.5 }
  const cells = (rects: Array<[[number, number], [number, number]]>): Set<string> => {
    const out = new Set<string>()
    for (const [[x0, x1], [y0, y1]] of rects)
      for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) out.add(`${x},${y}`)
    return out
  }
  it('veils every cell outside the block, and none in it', () => {
    // 4 × 4; the block: columns 1–2 × rows 0 and 3
    const veiled = cells(blockVeilRects(ax, ax, 4, 4, new Set([1, 2]), new Set([0, 3])))
    const lit = ['1,0', '2,0', '1,3', '2,3']
    for (const c of lit) expect(veiled.has(c)).toBe(false)
    expect(veiled.size).toBe(16 - lit.length)
  })
})
