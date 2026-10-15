import { describe, expect, it } from 'vitest'

import { rng } from './sam'
import { fitJointBatch } from './surfaceJoint'
import { designKey, fitNullTail, jointF, nullF, nullSurfaces, nullSurvival } from './surfaceNull'

const design = {
  treated: [1, 10, 100, 1000].flatMap((dose) =>
    [30, 120, 480].map((time, j) => ({ dose, time, group: j }))
  ),
  nGroups: 3,
  timeOffset: 30
}

describe('the 4PL surface null', () => {
  it('simulates the same surfaces for the same design and seed', () => {
    expect(nullSurfaces(design, 5, 7)).toEqual(nullSurfaces(design, 5, 7))
    expect(nullSurfaces(design, 5, 7)).not.toEqual(nullSurfaces(design, 5, 8))
    expect(designKey(design)).toBe(designKey({ ...design, treated: [...design.treated] }))
  })
  it('shares each vehicle group’s noise across its doses', () => {
    // the effects at one time share their vehicle's draw: across many surfaces, two doses at the
    // same time correlate (≈ ½, the vehicle's share of the variance); at different times they don't
    const b = nullSurfaces(design, 4000, 1)
    const corr = (i: number, j: number): number => {
      const x = b.map((s) => s.cells[i].e)
      const y = b.map((s) => s.cells[j].e)
      const mx = x.reduce((a, v) => a + v, 0) / x.length
      const my = y.reduce((a, v) => a + v, 0) / y.length
      let sxy = 0
      let sxx = 0
      let syy = 0
      for (let k = 0; k < x.length; k++) {
        sxy += (x[k] - mx) * (y[k] - my)
        sxx += (x[k] - mx) ** 2
        syy += (y[k] - my) ** 2
      }
      return sxy / Math.sqrt(sxx * syy)
    }
    expect(corr(0, 3)).toBeGreaterThan(0.4) // dose 1 and dose 10 at t = 30
    expect(Math.abs(corr(0, 4))).toBeLessThan(0.1) // dose 1 at t = 30, dose 10 at t = 120
  })
  it('scores a moderated F', () => {
    expect(jointF(10, 4, 16, Infinity, 0.5).F).toBeCloseTo(6 / 6 / 0.5)
    expect(jointF(10, 4, 16, 0, NaN).F).toBeCloseTo(1 / (4 / 10))
    expect(jointF(10, 4, 16, 10, 0.2).F).toBeCloseTo(1 / ((10 * 0.2 + 4) / 20))
  })
  it('fits the null’s tail: p from the sample, then its generalized Pareto tail', () => {
    // an exponential sample: the fitted tail follows it far beyond the sample's reach
    const R = rng(3)
    const x = Array.from({ length: 20000 }, () => -Math.log(1 - R()))
    const t = fitNullTail(x)
    expect(t.xi).toBeCloseTo(0, 1)
    expect(nullSurvival(1, t)).toBeCloseTo(Math.exp(-1), 2)
    expect(Math.log10(nullSurvival(12, t))).toBeCloseTo(12 * Math.log10(Math.exp(-1)), 0)
    expect(nullSurvival(-1, t)).toBe(1)
    expect(nullSurvival(Infinity, t)).toBe(0)
  })
  it('gives a null whose p is about uniform on fresh null surfaces', () => {
    const b = nullSurfaces(design, 1500, 11)
    const t = fitNullTail(nullF(b, fitJointBatch(b), 4, 11))
    const c = nullSurfaces(design, 600, 12)
    const p = nullF(c, fitJointBatch(c), 4, 12).map((f) => nullSurvival(f, t))
    const below = (a: number): number => p.filter((v) => v < a).length / p.length
    expect(below(0.5)).toBeGreaterThan(0.42)
    expect(below(0.5)).toBeLessThan(0.58)
    expect(below(0.1)).toBeGreaterThan(0.06)
    expect(below(0.1)).toBeLessThan(0.14)
  })
})
