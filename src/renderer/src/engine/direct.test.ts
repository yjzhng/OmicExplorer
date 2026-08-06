/**
 * Direct comparison: verifies like-to-like grouping (one comparison per context
 * group) and that log2FC / mean back-transforms match the shared Welch primitive.
 * Statistical parity vs omicViz is inherited from welchTTest (see parity.test.ts).
 */
import { describe, expect, it } from 'vitest'

import { runDirect } from './direct'
import type { StandardRow } from './types'

/** Minimal standardized row with only strain + dose active. */
function row(uniqID: string, strain: string, dose: number, rep: number, value: number): StandardRow {
  return { uniqID, strain, cmpd: '', dose, time: null, rep, value }
}

describe('runDirect (symmetric two-level comparison)', () => {
  // gene g1: log2FC(M vs W) = 1.5 at both dose levels (like-to-like matched).
  const rows: StandardRow[] = [
    // dose 1 — M: log2 {2,3}=2.5 ; W: log2 {1,1}=1.0
    row('g1', 'M', 1, 1, 4),
    row('g1', 'M', 1, 2, 8),
    row('g1', 'W', 1, 1, 2),
    row('g1', 'W', 1, 2, 2),
    // dose 2 — M: log2 {4,4}=4.0 ; W: log2 {2,3}=2.5
    row('g1', 'M', 2, 1, 16),
    row('g1', 'M', 2, 2, 16),
    row('g1', 'W', 2, 1, 4),
    row('g1', 'W', 2, 2, 8)
  ]

  const res = runDirect({
    rows,
    condition: 'strain',
    pairs: [['M', 'W']],
    activeConditions: ['strain', 'dose']
  })

  it('labels the comparison as "M | W"', () => {
    expect(res.comparisons).toEqual(['M | W'])
  })

  it('produces one row per like-to-like context group (per dose)', () => {
    expect(res.rows).toHaveLength(2)
    expect(res.rows.every((r) => r.cmp_cond === 'strain')).toBe(true)
    expect(res.rows.every((r) => r.strain === 'M')).toBe(true)
    expect(new Set(res.rows.map((r) => r.dose))).toEqual(new Set([1, 2]))
  })

  it('computes log2FC = mean(log2 num) − mean(log2 den) per group', () => {
    for (const r of res.rows) {
      expect(r.log2FC).not.toBeNull()
      expect(Math.abs((r.log2FC as number) - 1.5)).toBeLessThan(1e-9)
      // mean1 is back-transformed to original space: 2^mean(log2 M)
      const expMean1 = r.dose === 1 ? 2 ** 2.5 : 2 ** 4.0
      expect(Math.abs((r.mean1 as number) - expMean1)).toBeLessThan(1e-9)
    }
  })

  it('respects the optional condition filter', () => {
    const only1 = runDirect({
      rows,
      condition: 'strain',
      pairs: [['M', 'W']],
      activeConditions: ['strain', 'dose'],
      filter: { dose: [1] }
    })
    expect(only1.rows).toHaveLength(1)
    expect(only1.rows[0].dose).toBe(1)
  })
})
