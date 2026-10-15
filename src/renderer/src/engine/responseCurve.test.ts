import { describe, expect, it } from 'vitest'

import { buildDR, responseCurve } from './plotData'
import type { CompareResultRow, ResponseFit } from './types'

const row = (rs: Partial<ResponseFit>, extra: Partial<CompareResultRow> = {}): CompareResultRow =>
  ({
    uniqID: 'g1',
    cmpd: 'A',
    dose: null,
    time: null,
    cmp_cond: 'cmpd',
    comparison: 'A | DMSO',
    mean1: null,
    mean2: null,
    sd1: null,
    sd2: null,
    log2FC: 1,
    pP: 3,
    pQ: 2,
    thrsh: '',
    signf: true,
    effect: 'up',
    rs: { axis: 'dose', F: 10, df1: 3, df2: 20, ...rs },
    ...extra
  }) as CompareResultRow

// level positions: a baseline step below log dose 0, then doses 1 … 1000
const x = [-0.5, 0, 1, 2, 3]
const y = [0, 0.1, 0.6, 1.4, 1.5]
const desc = {
  pec50: -1.5,
  slope: 1.5,
  front: 0,
  back: 1.5,
  mid: 10 ** 1.5,
  r2: 0.99,
  r2Spline: 0.99,
  shapeRatio: 1,
  lowShape: false
}

describe('responseCurve', () => {
  it('draws the description 4PL on the dose scale, its midpoint, and the level means', () => {
    const c = responseCurve(row({ x, y, desc }), 'curve')!
    expect(c.drawn).toBe('curve')
    expect(c.x[0]).toBeCloseTo(1)
    expect(c.x[c.x.length - 1]).toBeCloseTo(1000)
    expect(c.mid).toBeCloseTo(10 ** 1.5)
    expect(c.points).toEqual([
      { x: 1, y: 0.1 },
      { x: 10, y: 0.6 },
      { x: 100, y: 1.4 },
      { x: 1000, y: 1.5 }
    ])
  })
  it('falls back to the spline where the curve was not described, or when asked', () => {
    const line = { x: [0, 1.5, 3], y: [0.1, 1, 1.5] }
    expect(responseCurve(row({ x, y, line }), 'curve')!.drawn).toBe('spline')
    const c = responseCurve(row({ x, y, line, desc }), 'spline')!
    expect(c.drawn).toBe('spline')
    expect(c.y).toEqual(line.y)
  })
  it('maps a time curve back from log(t + offset), t₀ left out', () => {
    const tx = [0, 30, 120, 480].map((t) => Math.log10(t + 30))
    const c = responseCurve(
      row({ axis: 'time', x: tx, y: [0, 0.5, 1, 1.2], timeOffset: 30 }),
      'spline'
    )!
    expect(c.points.map((p) => Math.round(p.x))).toEqual([30, 120, 480])
  })
  it('has no curve for a surface', () => {
    expect(responseCurve(row({ axis: 'surface' }), 'curve')).toBeNull()
  })
  it('buildDR draws response surface curves over their own axis only', () => {
    const r = row({ x, y, desc })
    expect(buildDR([r], { axis: 'dose', topGenes: 5 }).series).toHaveLength(1)
    expect(buildDR([r], { axis: 'time', topGenes: 5 }).series).toHaveLength(0)
    expect(buildDR([r], { axis: 'dose', topGenes: 5 }).continuous).toBe(true)
  })
})
