import { describe, expect, it } from 'vitest'

import { roundP, snapStatMin } from './stats'

describe('p-value rounding for the threshold UI', () => {
  it('rounds to 3 decimals', () => {
    expect(roundP(0.0501187)).toBe(0.05)
    expect(roundP(0.04981)).toBe(0.05)
    expect(roundP(0.0125)).toBe(0.013)
    expect(roundP(1)).toBe(1)
  })

  it('keeps 2 significant digits below 0.001 instead of collapsing to 0', () => {
    expect(roundP(0.00032)).toBe(0.00032)
    expect(roundP(0.000123456)).toBe(0.00012)
  })

  it('snaps a dragged −log10 cutoff so its p is round', () => {
    // 1.3 ≈ p 0.0501 → 0.05 exactly
    expect(Math.pow(10, -snapStatMin(1.3))).toBeCloseTo(0.05, 12)
    // already-round stays put (idempotent)
    const s = snapStatMin(2)
    expect(snapStatMin(s)).toBe(s)
    // ≤ 0 (p ≥ 1) is left alone
    expect(snapStatMin(0)).toBe(0)
  })
})
