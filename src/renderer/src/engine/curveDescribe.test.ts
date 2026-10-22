/**
 * A curve's description (the 4PL on log₂ ratios) against its test (CurveCurator's ratio fit):
 * BTK · Dasatinib from the kinobeads data — a strong responder whose high-dose ratios sit near 0,
 * where the ratio fit lets the bottom plateau drift to its limit.
 */
import { describe, expect, it } from 'vitest'

import { curveBand, fitCurve, fitLogistic, logistic } from './curveFit'

const x = [0.477, 1, 1.477, 2, 2.477, 3, 3.477, 4.477]
const y = [0.834, 0.6024, 0.2372, 0.0298, 0.00679, 0.0022, 0.00169, 0.002]

describe('a curve described on log₂ ratios', () => {
  const fit = fitCurve(x, y)!

  it('sits its bottom plateau on the high-dose points', () => {
    // the measured plateau: log₂ ≈ −9; the ratio fit's: its 1e-4 limit (−13.3)
    expect(Math.log2(fit.back)).toBeGreaterThan(-9.6)
    expect(Math.log2(fit.back)).toBeLessThan(-8.4)
    expect(fit.ratioFit!.back).toBeCloseTo(1e-4, 6)
    // the fold change the curve is read by, from the description
    expect(fit.log2FC).toBeCloseTo(
      Math.log2(logistic(fit.xMax, fit)) - Math.log2(logistic(fit.xMin, fit))
    )
    expect(fit.log2FC).toBeGreaterThan(-10)
  })

  it("keeps CurveCurator's test on the ratio fit", () => {
    // the same F as the ratio fit alone gives (fitLogistic is that fit)
    const p = fitLogistic([-Infinity, ...x], [1, ...y], x)
    expect(fit.ratioFit).toEqual(p)
    expect(fit.f).toBeGreaterThan(100)
    expect(fit.r2).toBeGreaterThan(0.99)
  })

  it('draws its band about the described curve', () => {
    const at = [1, 2, 3, 4]
    const band = curveBand(fit, x, y, at)!
    expect(band).not.toBeNull()
    at.forEach((lx, i) => {
      expect(band.mid[i]).toBeCloseTo(Math.log2(logistic(lx, fit)))
      expect(band.lo[i]).toBeLessThanOrEqual(band.mid[i])
      expect(band.hi[i]).toBeGreaterThanOrEqual(band.mid[i])
    })
  })
})
