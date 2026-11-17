import { describe, expect, it } from 'vitest'

import { hasPlotValues } from './plotEmpty'

describe('a figure with nothing to draw', () => {
  it('no traces, or traces with no points', () => {
    expect(hasPlotValues([])).toBe(false)
    expect(hasPlotValues([{ type: 'scatter', x: [], y: [] }])).toBe(false)
  })
  it('points missing a value on an axis (a gene unmeasured at every level)', () => {
    expect(hasPlotValues([{ x: ['6', '24', null], y: [null, NaN, null] }])).toBe(false)
  })
  it('a heatmap of blanks', () => {
    expect(hasPlotValues([{ type: 'heatmap', x: ['a'], y: ['b'], z: [[null], [NaN]] }])).toBe(false)
  })
})

describe('a figure with something to draw', () => {
  it('one point is enough', () => {
    expect(
      hasPlotValues([
        { x: [], y: [] },
        { x: [null, 2], y: [null, 1] }
      ])
    ).toBe(true)
  })
  it('typed arrays', () => {
    expect(hasPlotValues([{ x: new Float32Array([1]), y: new Float32Array([2]) }])).toBe(true)
  })
  it('a heatmap, a pie, a one-axis histogram', () => {
    expect(hasPlotValues([{ type: 'heatmap', z: [[null, 1]] }])).toBe(true)
    expect(hasPlotValues([{ type: 'pie', values: [3] }])).toBe(true)
    expect(hasPlotValues([{ type: 'histogram', x: [1, 2] }])).toBe(true)
  })
  it('a trace of a kind it can’t read', () => {
    expect(hasPlotValues([{ type: 'table', cells: {} }])).toBe(true)
  })
})
