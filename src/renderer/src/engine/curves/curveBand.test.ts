/**
 * A fitted curve's confidence band: it follows the fit, holds the fit inside it, narrows with more
 * (or less noisy) data, and refuses what it can't estimate.
 */
import { describe, expect, it } from 'vitest'

import { curveBand, fitCurve, logistic } from './curveFit'

const TRUE = { pec50: 6, slope: 1, front: 1, back: 0.25 }
/** log₁₀ doses −9 … −4, `reps` replicates each, with a fixed ± `noise` pattern on the ratio. */
function data(reps: number, noise: number): { x: number[]; y: number[] } {
  const x: number[] = []
  const y: number[] = []
  for (let d = -9; d <= -4; d++)
    for (let r = 0; r < reps; r++) {
      x.push(d)
      y.push(logistic(d, TRUE) * (1 + noise * (r % 2 ? 1 : -1) * (1 + (d % 3) / 4)))
    }
  return { x, y }
}
const GRID = [-9, -8, -7, -6.5, -6, -5.5, -5, -4]

describe('curveBand', () => {
  it('follows the fit and holds it inside', () => {
    const { x, y } = data(3, 0.05)
    const fit = fitCurve(x, y)!
    const band = curveBand(fit, x, y, GRID)!
    GRID.forEach((g, i) => {
      expect(band.mid[i]).toBeCloseTo(Math.log2(logistic(g, fit)), 10)
      expect(band.lo[i]).toBeLessThan(band.mid[i])
      expect(band.hi[i]).toBeGreaterThan(band.mid[i])
    })
  })

  it('narrows with more replicates and with less noise', () => {
    const width = (reps: number, noise: number): number => {
      const { x, y } = data(reps, noise)
      const b = curveBand(fitCurve(x, y)!, x, y, GRID)!
      return b.hi.reduce((s, h, i) => s + h - b.lo[i], 0)
    }
    expect(width(6, 0.05)).toBeLessThan(width(2, 0.05))
    expect(width(3, 0.02)).toBeLessThan(width(3, 0.08))
  })

  it('refuses too few points', () => {
    expect(curveBand(TRUE, [-8, -6, -4], [0.9, 0.6, 0.3], GRID)).toBeNull()
  })
})
