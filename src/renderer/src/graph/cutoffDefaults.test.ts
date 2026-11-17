import { describe, expect, it } from 'vitest'

import { DEFAULT_THRESHOLD, type ThresholdConfig } from '../engine'
import { cutoffDefaults } from './contrastPair'

const thr = (patch: Partial<ThresholdConfig>): ThresholdConfig => ({
  ...DEFAULT_THRESHOLD,
  ...patch
})

describe("a linear cutoff starts at each side's Compare", () => {
  const a = thr({ fcLow: -1, fcHigh: 1, statMin: 1.3 })
  const b = thr({ fcLow: -0.5, fcHigh: 2, statMin: 2 })
  it('log₂FC: its fold-change limits, per axis', () => {
    expect(cutoffDefaults(a, b, 'value')).toEqual({ aUp: 1, aDown: -1, bUp: 2, bDown: -0.5 })
  })
  it('significance: its stat floor, above only', () => {
    expect(cutoffDefaults(a, b, 'p')).toEqual({ aUp: 1.3, bUp: 2 })
  })
  it("a SAM curve: its FC asymptote (each side's while asymmetric) and P_lim", () => {
    const sam = thr({ type: 'non-linear', s0: -0.3, statMin: 1.3 })
    const asym = thr({ type: 'non-linear', s0: -0.3, s0Down: -0.6, statMin: 2 })
    expect(cutoffDefaults(sam, asym, 'value')).toEqual({
      aUp: 0.3,
      aDown: -0.3,
      bUp: 0.3,
      bDown: -0.6
    })
    expect(cutoffDefaults(sam, asym, 'p')).toEqual({ aUp: 1.3, bUp: 2 })
  })
  it("SAM's permutation FDR: no line of either", () => {
    const perm = thr({ type: 'sam_fdr', statMin: 1.3 })
    expect(cutoffDefaults(perm, perm, 'value')).toEqual({})
    expect(cutoffDefaults(perm, perm, 'p')).toEqual({})
  })
  it('nothing a Compare does not cut, nor without a Compare', () => {
    expect(cutoffDefaults(a, b, 'pec50')).toBeUndefined()
    expect(cutoffDefaults(undefined, undefined, 'value')).toBeUndefined()
  })
})
