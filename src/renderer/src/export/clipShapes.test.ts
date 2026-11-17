import { describe, expect, it } from 'vitest'

import { clipShapesToRanges } from './clipShapes'

const full = {
  xaxis: { range: [-5, 5], type: 'linear' },
  yaxis: { range: [0, 10], type: 'linear' },
  xaxis2: { range: [0, 2], type: 'log' }
}

describe('shapes cut to the drawn ranges, for an export', () => {
  it('leaves shapes already inside as they are (the same array)', () => {
    const shapes = [{ type: 'line', x0: -1, x1: 1, y0: 2, y1: 2 }]
    expect(clipShapesToRanges(shapes, full)).toBe(shapes)
  })
  it("cuts a volcano's far-running guide to the plot", () => {
    const [h, v] = clipShapesToRanges(
      [
        { type: 'line', x0: -200, x1: 200, y0: 1.3, y1: 1.3 },
        { type: 'line', x0: 1, x1: 1, y0: 1.3, y1: 900 }
      ],
      full
    ) as Array<Record<string, number>>
    expect([h.x0, h.x1, h.y0]).toEqual([-5, 5, 1.3])
    expect([v.y0, v.y1]).toEqual([1.3, 10])
  })
  it('a paper-referenced side is left alone; one wholly outside goes', () => {
    const out = clipShapesToRanges(
      [
        { type: 'line', xref: 'x', yref: 'paper', x0: 50, x1: 50, y0: 0, y1: 1 },
        { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 20, y1: 20 },
        { type: 'line', xref: 'x', yref: 'paper', x0: 2, x1: 2, y0: -0.1, y1: 1.1 }
      ],
      full
    ) as Array<Record<string, number>>
    expect(out).toEqual([
      { type: 'line', xref: 'x', yref: 'paper', x0: 2, x1: 2, y0: -0.1, y1: 1.1 }
    ])
  })
  it('cuts a path of segments, splitting it where it leaves and comes back', () => {
    const [p] = clipShapesToRanges(
      [{ type: 'path', path: 'M-10,5L0,5L0,20L4,20L4,5L10,5' }],
      full
    ) as Array<{ path: string }>
    expect(p.path).toBe('M-5,5L0,5L0,10M4,10L4,5L5,5')
  })
  it('works in a log axis’s own space', () => {
    const [l] = clipShapesToRanges(
      [{ type: 'line', xref: 'x2', x0: 0.1, x1: 1e6, y0: 5, y1: 5 }],
      full
    ) as Array<Record<string, number>>
    expect(l.x0).toBeCloseTo(1, 9)
    expect(l.x1).toBeCloseTo(100, 9)
  })
  it('leaves curves (C, Q, …) and pixel-sized shapes alone', () => {
    const shapes = [
      { type: 'path', path: 'M-100,0C0,0 0,0 100,0' },
      { type: 'rect', xsizemode: 'pixel', x0: -100, x1: 100, y0: 0, y1: 1 }
    ]
    expect(clipShapesToRanges(shapes, full)).toBe(shapes)
  })
})
