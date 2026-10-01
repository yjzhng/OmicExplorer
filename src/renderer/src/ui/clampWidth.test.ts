/** Stored panel widths are held inside their bounds on the way in and out. */
import { describe, expect, it } from 'vitest'

import { clampWidth, DETAILS_WIDTH, NAV_WIDTH } from './useAppSettings'

describe('clampWidth', () => {
  it('keeps a width that is already in range', () => {
    expect(clampWidth(300, NAV_WIDTH)).toBe(300)
  })

  it('pulls a width back inside its bounds', () => {
    // A drag past the end of its travel, or a value stored from a much wider window.
    expect(clampWidth(5, NAV_WIDTH)).toBe(NAV_WIDTH.min)
    expect(clampWidth(9999, NAV_WIDTH)).toBe(NAV_WIDTH.max)
    expect(clampWidth(100, DETAILS_WIDTH)).toBe(DETAILS_WIDTH.min)
  })

  it('falls back to the default for anything unusable', () => {
    // A hand-edited or corrupted localStorage entry must not collapse a panel to nothing.
    for (const bad of [undefined, null, 'wide', NaN, Infinity, {}])
      expect(clampWidth(bad, NAV_WIDTH)).toBe(NAV_WIDTH.default)
  })

  it('has defaults that sit inside their own bounds', () => {
    for (const w of [NAV_WIDTH, DETAILS_WIDTH]) {
      expect(w.default).toBeGreaterThanOrEqual(w.min)
      expect(w.default).toBeLessThanOrEqual(w.max)
    }
  })
})
