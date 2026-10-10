/**
 * A curve's final model: the 4PL when its F-test rejects the flat null at the threshold's α, else
 * M0 — the flat line at the mean ratio, kept with the fit.
 */
import { describe, expect, it } from 'vitest'

import { classifyCompareRow, curveM0, curveModel, fitCurve, logistic } from './curveFit'
import type { ThresholdConfig } from './stats'

const T = {
  type: 'curvecurator',
  fcHigh: 0.5,
  fcLow: -0.5,
  statMin: 2, // α = 0.01
  s0: 0,
  statType: 'pP'
} as unknown as ThresholdConfig

describe('curve model', () => {
  it('is the 4PL when the F-test rejects flat at α, else M0', () => {
    expect(curveModel({ pP: 3 }, T)).toBe('4PL') // p = 0.001 ≤ 0.01
    expect(curveModel({ pP: 1 }, T)).toBe('M0') // p = 0.1 > 0.01
    expect(curveModel({ pP: null }, T)).toBe('M0')
  })

  it('called by FDR, uses the α the comparison settled on', () => {
    const byFdr = { ...T, ccCallBy: 'fdr' } as ThresholdConfig
    expect(curveModel({ pP: 1.5, curve: { ccAlpha: 0.05 } }, byFdr)).toBe('4PL')
    expect(curveModel({ pP: 1.5, curve: { ccAlpha: 0.01 } }, byFdr)).toBe('M0')
  })

  it('travels with the call, for curve rows only', () => {
    const curve = { f: 0.1, n: 7 }
    expect(classifyCompareRow({ log2FC: 0.02, pP: 0.2, pQ: 0.1, curve }, T).model).toBe('M0')
    const t = { ...T, type: 'linear' } as ThresholdConfig
    expect(classifyCompareRow({ log2FC: 1, pP: 3, pQ: 3 }, t).model).toBeUndefined()
  })

  it("keeps M0 with the fit: the mean ratio of its points, the control's included", () => {
    const x = [-9, -8, -7, -6, -5, -4]
    const y = x.map((d) => logistic(d, { pec50: 6, slope: 1, front: 1, back: 0.5 }))
    const fit = fitCurve(x, y)!
    const mean = [1, ...y].reduce((s, v) => s + v, 0) / (y.length + 1)
    expect(fit.m0).toBeCloseTo(mean, 12)
    const m0 = curveM0(fit)!
    expect(m0.mid).toBeCloseTo(Math.log2(mean), 12)
    expect(m0.half).toBeGreaterThan(0)
    // An older fit without m0: rebuilt from its kept points.
    expect(curveM0({ n: fit.n, y })!.mid).toBeCloseTo(Math.log2(mean), 12)
  })
})
