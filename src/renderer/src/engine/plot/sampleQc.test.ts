import { describe, expect, it } from 'vitest'

import { sampleQc } from './qc'
import type { StandardizeResult, StandardRow } from '../types'

const row = (uniqID: string, rep: number, value: number | null, imputed = false): StandardRow => ({
  uniqID,
  cell: 'WT',
  cmpd: '',
  dose: null,
  time: null,
  rep,
  value,
  ...(imputed ? { imputed } : null)
})

describe('per-sample QC (the Clean data table’s QC view)', () => {
  // 4 proteins; r1 measured all four, r2 measured two, had one imputed and lacks d
  const std = {
    rows: [
      row('a', 1, 10),
      row('b', 1, 100),
      row('c', 1, 1000),
      row('d', 1, 10000),
      row('a', 2, 30),
      row('b', 2, 100),
      row('c', 2, 5, true),
      row('d', 2, null)
    ],
    activeConditions: ['cell']
  } as unknown as StandardizeResult
  const [r1, r2] = sampleQc(std, 'log10')
  it('counts measured, imputed and missing of every protein', () => {
    expect([r1.meta.rep, r1.measured, r1.imputed, r1.missing, r1.missingPct]).toEqual([
      1, 4, 0, 0, 0
    ])
    expect([r2.meta.rep, r2.measured, r2.imputed, r2.missing, r2.missingPct]).toEqual([
      2, 2, 1, 1, 25
    ])
  })
  it('the measured abundances’ median and quartiles, on the scale asked', () => {
    expect([r1.q1, r1.median, r1.q3]).toEqual([1.75, 2.5, 3.25])
    // the imputed value is left out
    expect(r2.median).toBeCloseTo((Math.log10(30) + 2) / 2, 9)
  })
  it('the condition group’s median CV, shared by its samples', () => {
    // a (10, 30): 70.7 %; b (100, 100): 0 %; c (1000, 5): 140.7 % → median 70.7
    expect(r1.groupCv).toBeCloseTo(70.71, 1)
    expect(r2.groupCv).toBe(r1.groupCv)
  })
})
