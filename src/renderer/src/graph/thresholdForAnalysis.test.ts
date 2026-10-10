import { describe, expect, it } from 'vitest'

import { DEFAULT_THRESHOLD, type ThresholdConfig } from '../engine'
import { thresholdForAnalysis } from './types'

const t = (over: Partial<ThresholdConfig>): ThresholdConfig => ({ ...DEFAULT_THRESHOLD, ...over })

describe('thresholdForAnalysis', () => {
  it('starts a curve fit on CurveCurator', () => {
    expect(thresholdForAnalysis('compare', 'curve_fit', t({}))?.type).toBe('curvecurator')
    expect(thresholdForAnalysis('curve_fit', 'curve_fit', t({ type: 'linear' }))).toBeNull()
  })
  it('drops a method the new analysis cannot run, to the hyperbolic p-value route', () => {
    for (const [from, to, type] of [
      ['curve_fit', 'compare', 'curvecurator'],
      ['curve_fit', 'two_way_anova', 'curvecurator'],
      ['compare', 'two_way_anova', 'sam_fdr']
    ] as const) {
      const next = thresholdForAnalysis(from, to, t({ type }))!
      expect(next.type).toBe('non-linear')
      expect(next.statType).toBe('pQ')
    }
  })
  it('keeps a threshold the new analysis supports', () => {
    expect(thresholdForAnalysis('compare', 'two_way_anova', t({ type: 'linear' }))).toBeNull()
    expect(thresholdForAnalysis('two_way_anova', 'compare', t({ type: 'non-linear' }))).toBeNull()
  })
})
