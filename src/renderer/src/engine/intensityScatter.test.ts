/**
 * Intensity scatter from a direct comparison's group means — the omicViz shape:
 *   - type: direct
 *     filter: { cmpd: H2O }
 *     strain: [[clpP, WT]]
 * The direct output already carries mean1/mean2, so the plot is just log10 of each side,
 * coloured by the comparison's own significance.
 */
import { describe, expect, it } from 'vitest'

import { buildIntensityScatter } from './plotData'
import type { CompareResultRow } from './types'

const row = (uniqID: string, mean1: number, mean2: number, signf = false): CompareResultRow => ({
  uniqID,
  cmpd: 'H2O',
  dose: 0,
  time: null,
  strain: '',
  cmp_cond: 'strain',
  comparison: 'clpP | WT',
  mean1, // clpP (numerator)
  mean2, // WT (denominator)
  sd1: null,
  sd2: null,
  log2FC: Math.log2(mean1 / mean2),
  pP: 2,
  pQ: 1,
  thrsh: '',
  signf,
  effect: signf ? 'up' : 'none'
})

describe('buildIntensityScatter (basal clpP vs WT from a direct comparison)', () => {
  const rows = [row('g1', 100, 100), row('g2', 1000, 10, true), row('g3', 0, 50)]
  const sc = buildIntensityScatter(rows)

  it('plots log10 of each group mean, numerator on y', () => {
    expect(sc.points).toHaveLength(2) // g3 dropped: a non-positive mean has no log
    const g1 = sc.points.find((p) => p.uniqID === 'g1')!
    expect(g1.x).toBeCloseTo(2, 9) // WT
    expect(g1.y).toBeCloseTo(2, 9) // clpP — on the identity line
    const g2 = sc.points.find((p) => p.uniqID === 'g2')!
    expect(g2.y).toBeCloseTo(3, 9)
    expect(g2.x).toBeCloseTo(1, 9)
  })

  it('labels the axes by side and carries the comparison significance', () => {
    expect(sc.xLabel).toBe('log₁₀ intensity · WT')
    expect(sc.yLabel).toBe('log₁₀ intensity · clpP')
    expect(sc.points.find((p) => p.uniqID === 'g2')!.signf).toBe(true)
    expect(sc.guide).toBeUndefined() // → the view draws the line of identity
  })
})
