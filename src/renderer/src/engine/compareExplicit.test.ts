/**
 * Explicit comparison (runCompare) parity: the unified num/den/match model must reproduce
 * the two legacy paths it replaces —
 *   • match ALL other conditions  ≡  runDirect (symmetric like-for-like)
 *   • leave dose UNmatched        ≡  runVehNorm (asymmetric vehicle, dose pooled)
 * so migrating veh_norm/direct configs onto runCompare changes no numbers.
 */
import { describe, expect, it } from 'vitest'

import { runCompare, runDirect } from './direct'
import { runVehNorm } from './compare'
import type { CompareResultRow, StandardRow } from './types'

const byDose = (rows: CompareResultRow[]): Map<number | null, CompareResultRow> =>
  new Map(rows.map((r) => [r.dose, r]))

describe('runCompare parity with runDirect (match all)', () => {
  const row = (uniqID: string, strain: string, dose: number, rep: number, value: number): StandardRow => ({
    uniqID,
    strain,
    cmpd: '',
    dose,
    time: null,
    rep,
    value
  })
  const rows: StandardRow[] = [
    row('g1', 'M', 1, 1, 4),
    row('g1', 'M', 1, 2, 8),
    row('g1', 'W', 1, 1, 2),
    row('g1', 'W', 1, 2, 2),
    row('g1', 'M', 2, 1, 16),
    row('g1', 'M', 2, 2, 16),
    row('g1', 'W', 2, 1, 4),
    row('g1', 'W', 2, 2, 8)
  ]

  const direct = runDirect({ rows, condition: 'strain', pairs: [['M', 'W']], activeConditions: ['strain', 'dose'] })
  // Same comparison, declared explicitly: numerator strain=M, denominator strain=W, dose matched.
  const compare = runCompare({
    rows,
    num: { strain: ['M'] },
    den: { strain: ['W'] },
    match: ['dose'],
    activeConditions: ['strain', 'dose']
  })

  it('produces the same comparison label + cmp_cond', () => {
    expect(compare.comparisons).toEqual(direct.comparisons)
    expect(compare.rows.every((r) => r.cmp_cond === 'strain')).toBe(true)
  })

  it('produces identical per-dose log2FC / means', () => {
    expect(compare.rows).toHaveLength(direct.rows.length)
    const c = byDose(compare.rows)
    for (const d of direct.rows) {
      const m = c.get(d.dose)!
      expect(m).toBeDefined()
      expect(m.log2FC).toBeCloseTo(d.log2FC as number, 12)
      expect(m.mean1).toBeCloseTo(d.mean1 as number, 12)
      expect(m.mean2).toBeCloseTo(d.mean2 as number, 12)
    }
  })
})

describe('runCompare parity with runVehNorm (dose unmatched)', () => {
  const row = (uniqID: string, cmpd: string, dose: number, rep: number, value: number): StandardRow => ({
    uniqID,
    strain: '',
    cmpd,
    dose,
    time: null,
    rep,
    value
  })
  // drug at doses 10 & 20; vehicle (dmso) only at dose 0 — the classic asymmetry.
  const rows: StandardRow[] = [
    row('g1', 'drug', 10, 1, 8),
    row('g1', 'drug', 10, 2, 16),
    row('g1', 'drug', 20, 1, 32),
    row('g1', 'drug', 20, 2, 32),
    row('g1', 'dmso', 0, 1, 2),
    row('g1', 'dmso', 0, 2, 4)
  ]

  const veh = runVehNorm({ rows, pairs: [['drug', 'dmso']], activeConditions: ['cmpd', 'dose'] })
  // Same, declared: numerator cmpd=drug, denominator cmpd=dmso, dose NOT matched (pooled reference).
  const compare = runCompare({
    rows,
    num: { cmpd: ['drug'] },
    den: { cmpd: ['dmso'] },
    match: [],
    activeConditions: ['cmpd', 'dose']
  })

  it('reproduces the "drug | dmso" comparison on cmp_cond=cmpd', () => {
    expect(compare.comparisons).toEqual(veh.comparisons)
    expect(compare.rows.every((r) => r.cmp_cond === 'cmpd')).toBe(true)
  })

  it('produces identical per-dose log2FC against the shared dose-0 vehicle', () => {
    expect(compare.rows).toHaveLength(veh.rows.length)
    const c = byDose(compare.rows)
    for (const v of veh.rows) {
      const m = c.get(v.dose)!
      expect(m).toBeDefined()
      expect(m.cmpd).toBe('drug')
      expect(m.log2FC).toBeCloseTo(v.log2FC as number, 12)
      expect(m.mean1).toBeCloseTo(v.mean1 as number, 12)
      expect(m.mean2).toBeCloseTo(v.mean2 as number, 12)
    }
  })
})
