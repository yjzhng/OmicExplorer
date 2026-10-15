import { describe, expect, it, vi } from 'vitest'

// the bundle needs a browser; geneTicks doesn't touch it
vi.mock('plotly.js-dist-min', () => ({ default: {} }))

import { geneTicks } from './heatmapFocus'

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
