/**
 * Two-way ANOVA interaction test. The symmetric case is hand-checkable: with a
 * single df the Welch t-tail reduces to a Cauchy, so we assert the interaction
 * fold-change and the exact p-value. The asymmetric case checks vehicle
 * dose-exclusion cell assembly.
 */
import { describe, expect, it } from 'vitest'

import { runTwoWayAnova } from './twoWay'
import type { StandardRow } from './types'

function r(
  uniqID: string,
  strain: string,
  cmpd: string,
  dose: number | null,
  time: number | null,
  rep: number,
  value: number
): StandardRow {
  return { uniqID, strain, cmpd, dose, time, rep, value }
}

describe('runTwoWayAnova — symmetric (strain × time)', () => {
  // interaction = mean(M,t1) − mean(M,t2) − mean(W,t1) + mean(W,t2), in log2.
  // M,t1: log2{3,4} mean 3.5 (var 0.5) ; the other three cells are flat at log2 2.
  // ⇒ interaction = 3.5 − 2 − 2 + 2 = 1.5 ; se = sqrt(0.5/2) = 0.5 ; df = 1 ; t = 3.
  const rows: StandardRow[] = [
    r('g1', 'M', '', null, 1, 1, 8),
    r('g1', 'M', '', null, 1, 2, 16),
    r('g1', 'M', '', null, 2, 1, 4),
    r('g1', 'M', '', null, 2, 2, 4),
    r('g1', 'W', '', null, 1, 1, 4),
    r('g1', 'W', '', null, 1, 2, 4),
    r('g1', 'W', '', null, 2, 1, 4),
    r('g1', 'W', '', null, 2, 2, 4)
  ]

  const res = runTwoWayAnova({
    rows,
    factors: [
      { condition: 'strain', pairs: [['M', 'W']] },
      { condition: 'time', pairs: [['1', '2']] }
    ],
    activeConditions: ['strain', 'time']
  })

  it('labels the comparison and cmp_cond', () => {
    expect(res.comparisons).toEqual(['M|W × 1|2'])
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].cmp_cond).toBe('strain:time')
  })

  it('computes the interaction log2FC', () => {
    expect(Math.abs((res.rows[0].log2FC as number) - 1.5)).toBeLessThan(1e-9)
  })

  it('matches the exact df=1 (Cauchy) two-sided p-value', () => {
    // p = 1 − 2·atan(t)/π for df=1, t=3 → pP = −log10(p)
    const pExpected = 1 - (2 * Math.atan(3)) / Math.PI
    const pP = -Math.log10(pExpected)
    expect(Math.abs((res.rows[0].pP as number) - pP)).toBeLessThan(1e-9)
  })
})

describe('runTwoWayAnova — asymmetric (cmpd × strain, vehicle dose-excluded)', () => {
  // Treatment A at dose 1; vehicle DMSO at dose 0 (matched with dose excluded).
  // interaction = mean(A,M) − mean(A,W) − mean(DMSO,M) + mean(DMSO,W), log2.
  // = 4 − 2 − 2 + 2 = 2.
  const rows: StandardRow[] = [
    r('g1', 'M', 'A', 1, null, 1, 16),
    r('g1', 'M', 'A', 1, null, 2, 16),
    r('g1', 'W', 'A', 1, null, 1, 4),
    r('g1', 'W', 'A', 1, null, 2, 4),
    r('g1', 'M', 'DMSO', 0, null, 1, 4),
    r('g1', 'M', 'DMSO', 0, null, 2, 4),
    r('g1', 'W', 'DMSO', 0, null, 1, 4),
    r('g1', 'W', 'DMSO', 0, null, 2, 4)
  ]

  const res = runTwoWayAnova({
    rows,
    factors: [
      { condition: 'cmpd', pairs: [['A', 'DMSO']] },
      { condition: 'strain', pairs: [['M', 'W']] }
    ],
    activeConditions: ['cmpd', 'strain', 'dose']
  })

  it('assembles cells with vehicle dose-exclusion and reports the interaction', () => {
    expect(res.comparisons).toEqual(['A|DMSO × M|W'])
    expect(res.rows).toHaveLength(1)
    const row = res.rows[0]
    expect(row.cmp_cond).toBe('cmpd:strain')
    expect(row.dose).toBe(1) // treatment-side dose context preserved
    expect(Math.abs((row.log2FC as number) - 2)).toBeLessThan(1e-9)
  })
})
