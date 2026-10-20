/** Interpolation in the 4PL fits — the descriptions and the joint surface: fitted on the measured
 *  points plus the grid's, scored on the measured points alone. (The Spline tests never take it.) */
import { describe, expect, it } from 'vitest'

import { describeCurve, fitSplineCurve } from './splineFit'
import { fitJointCells, presetSpec } from './surfaceJoint'

// a sigmoid over 8 half-log doses, the baseline a step below the lowest
const x = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5]
const y = [0, 0.02, 0.05, 0.2, 0.9, 1.6, 1.85, 1.95, 1.98]

describe('interpolation (4PL fits)', () => {
  it('a curve’s 4PL description: steadier, and still judged on the real levels', () => {
    const c = { ...fitSplineCurve(x, y, 20)!, scale: { axis: 'dose' as const } }
    const off = describeCurve(c)!
    const on = describeCurve(c, undefined, true)!
    expect(Math.abs(on.pec50 - off.pec50)).toBeLessThan(0.3)
    expect(on.r2).toBeLessThanOrEqual(off.r2 + 1e-9)
  })
  it('the joint surface: at the grid squares’ centres, its RSS over the real cells', () => {
    // on the joint model's axes: log₁₀ dose, log₁₀(t + 30)
    const cells = [1, 3, 10, 30, 100].flatMap((dose) =>
      [30, 120, 480, 1440].map((time) => ({
        xa: Math.log10(dose),
        xb: Math.log10(time + 30),
        e: (1.5 / (1 + 10 / dose)) * (1 - Math.exp(-time / 300))
      }))
    )
    const spec = presetSpec(Math.log10(30))
    const off = fitJointCells(cells, spec)
    const on = fitJointCells(cells, spec, true)
    expect(on.rss).toBeGreaterThanOrEqual(off.rss - 1e-9)
  })
})
