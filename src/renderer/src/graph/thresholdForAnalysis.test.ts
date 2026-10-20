import { describe, expect, it } from 'vitest'

import { DEFAULT_THRESHOLD, type ThresholdConfig } from '../engine'
import { thresholdForAnalysis, thresholdForDetection } from './types'

const t = (over: Partial<ThresholdConfig>): ThresholdConfig => ({ ...DEFAULT_THRESHOLD, ...over })

describe('thresholdForAnalysis', () => {
  it('starts a curve fit on CurveCurator', () => {
    expect(thresholdForAnalysis('compare', 'curve_fit', t({}))?.type).toBe('curvecurator')
    expect(thresholdForAnalysis('curve_fit', 'curve_fit', t({ type: 'linear' }))).toBeNull()
  })
  it('drops a method the new analysis cannot run, to the hyperbolic p-value route', () => {
    for (const [from, to, type] of [
      ['curve_fit', 'compare', 'curvecurator'],
      ['curve_fit', 'anova', 'curvecurator'],
      ['compare', 'anova', 'sam_fdr']
    ] as const) {
      const next = thresholdForAnalysis(from, to, t({ type }))!
      expect(next.type).toBe('non-linear')
      expect(next.statType).toBe('pQ')
    }
  })
  it('keeps a threshold the new analysis supports', () => {
    expect(thresholdForAnalysis('compare', 'anova', t({ type: 'linear' }))).toBeNull()
    expect(thresholdForAnalysis('anova', 'compare', t({ type: 'non-linear' }))).toBeNull()
  })
})

describe('thresholdForDetection', () => {
  it('moves a curve fit between the relevance score and the q-value call', () => {
    const toSpline = thresholdForDetection('spline', t({ type: 'curvecurator', statType: 'pP' }))!
    expect(toSpline).toMatchObject({
      type: 'non-linear',
      statType: 'pQ',
      b: 1,
      s0: -0.5,
      fcHigh: 0.5,
      fcLow: -0.5
    })
    expect(toSpline.statMin).toBeCloseTo(-Math.log10(0.05))
    expect(thresholdForDetection('spline', t({ type: 'non-linear' }))).toBeNull()
    expect(thresholdForDetection('spline', t({ type: 'linear' }))).toBeNull()
    expect(thresholdForDetection('4pl', t({ type: 'linear' }))?.type).toBe('curvecurator')
    expect(thresholdForDetection('4pl', t({ type: 'curvecurator' }))).toBeNull()
    // a 4PL surface calls by its target–decoy q, not the relevance score
    expect(thresholdForDetection('4pl', t({ type: 'curvecurator' }), true)?.type).toBe('non-linear')
    expect(thresholdForDetection('4pl', t({ type: 'linear' }))).toMatchObject({
      fcHigh: 0.5,
      fcLow: -0.5
    })
    expect(thresholdForDetection('4pl', t({ type: 'linear' }), true)).toBeNull()
  })
})
