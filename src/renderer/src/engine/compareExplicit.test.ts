/**
 * Explicit comparison (runCompare) parity: the unified num/den/match model must reproduce
 * the two legacy paths it replaces —
 *   • match ALL other conditions  ≡  runDirect (symmetric like-for-like)
 *   • leave dose UNmatched        ≡  runVehNorm (asymmetric vehicle, dose pooled)
 * so migrating veh_norm/direct configs onto runCompare changes no numbers.
 */
import { describe, expect, it } from 'vitest'

import { classifyConditions, previewCompare, runCompare, runDirect } from './direct'
import { runVehNorm } from './compare'
import type { CompareResultRow, StandardRow } from './types'

const byDose = (rows: CompareResultRow[]): Map<number | null, CompareResultRow> =>
  new Map(rows.map((r) => [r.dose, r]))

describe('runCompare parity with runDirect (match all)', () => {
  const row = (uniqID: string, cell: string, dose: number, rep: number, value: number): StandardRow => ({
    uniqID,
    cell,
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

  const direct = runDirect({ rows, condition: 'cell', pairs: [['M', 'W']], activeConditions: ['cell', 'dose'] })
  // Same comparison, declared explicitly: numerator cell=M, denominator cell=W, dose matched.
  const compare = runCompare({
    rows,
    num: { cell: ['M'] },
    den: { cell: ['W'] },
    match: ['dose'],
    activeConditions: ['cell', 'dose']
  })

  it('produces the same comparison label + cmp_cond', () => {
    expect(compare.comparisons).toEqual(direct.comparisons)
    expect(compare.rows.every((r) => r.cmp_cond === 'cell')).toBe(true)
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
    cell: '',
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

describe('condition roles (classifyConditions / one-on-one t-test)', () => {
  const row = (uniqID: string, cmpd: string, dose: number, rep: number, value: number): StandardRow => ({
    uniqID,
    cell: '',
    cmpd,
    dose,
    time: null,
    rep,
    value
  })
  const rows: StandardRow[] = [
    row('g1', 'drug', 10, 1, 8),
    row('g1', 'drug', 10, 2, 16),
    row('g1', 'drug', 20, 1, 32),
    row('g1', 'drug', 20, 2, 32),
    row('g1', 'dmso', 0, 1, 2),
    row('g1', 'dmso', 0, 2, 4)
  ]
  const active: ('cmpd' | 'dose')[] = ['cmpd', 'dose']

  it('veh-norm: dose is invariant on the vehicle, so it is context — not a second axis — even when matched', () => {
    const roles = classifyConditions(rows, { cmpd: ['drug'] }, { cmpd: ['dmso'] }, active)
    expect(roles.axis).toEqual(['cmpd'])
    expect(roles.invariant).toEqual(['dose'])
    // Matching dose (the dialog matches every non-axis condition) must still yield one comparison
    // per treated dose against the single dmso@0 slice.
    const res = runCompare({ rows, num: { cmpd: ['drug'] }, den: { cmpd: ['dmso'] }, match: ['dose'], activeConditions: active })
    expect(res.comparisons).toEqual(['drug | dmso'])
    expect(res.rows.map((r) => r.dose).sort()).toEqual([10, 20])
    expect(res.rows.every((r) => r.cmp_cond === 'cmpd')).toBe(true)
  })

  it('dose vs dose within the drug is a genuine axis (a choice exists on both sides)', () => {
    const roles = classifyConditions(rows, { cmpd: ['drug'], dose: ['20'] }, { cmpd: ['drug'], dose: ['10'] }, active)
    expect(roles.axis).toEqual(['dose'])
    expect(roles.invariant).toEqual([])
    const p = previewCompare({ rows, num: { cmpd: ['drug'], dose: ['20'] }, den: { cmpd: ['drug'], dose: ['10'] }, match: active, activeConditions: active })
    expect(p.groups).toBe(1)
    expect(p.labels).toEqual(['20 | 10'])
  })

  it('rejects a comparison that differs on more than one condition', () => {
    const rows2 = [...rows, row('g1', 'dmso', 10, 1, 3), row('g1', 'dmso', 10, 2, 3)] // dmso now varies in dose too
    const p = previewCompare({
      rows: rows2,
      num: { cmpd: ['drug'], dose: ['20'] },
      den: { cmpd: ['dmso'], dose: ['0'] },
      match: active,
      activeConditions: active
    })
    expect(p.groups).toBe(0)
    expect(p.warnings.some((w) => w.includes('differ between the sides'))).toBe(true)
  })
})

describe('condition roles — filter pin on the numerator does not confuse the axis', () => {
  const row = (uniqID: string, cmpd: string, dose: number, rep: number, value: number): StandardRow => ({
    uniqID,
    cell: '',
    cmpd,
    dose,
    time: null,
    rep,
    value
  })
  const rows: StandardRow[] = [
    row('g1', 'drug', 10, 1, 8),
    row('g1', 'drug', 10, 2, 16),
    row('g1', 'drug', 20, 1, 32),
    row('g1', 'drug', 20, 2, 32),
    row('g1', 'dmso', 0, 1, 2),
    row('g1', 'dmso', 0, 2, 4)
  ]
  it('drug @ 20 vs dmso (@ its only dose 0) is a cmpd comparison with dose as invariant context', () => {
    const roles = classifyConditions(rows, { cmpd: ['drug'], dose: ['20'] }, { cmpd: ['dmso'], dose: ['0'] }, ['cmpd', 'dose'])
    expect(roles.axis).toEqual(['cmpd'])
    expect(roles.invariant).toEqual(['dose'])
    const p = previewCompare({ rows, num: { cmpd: ['drug'], dose: ['20'] }, den: { cmpd: ['dmso'], dose: ['0'] }, match: ['cmpd', 'dose'], activeConditions: ['cmpd', 'dose'] })
    expect(p.groups).toBe(1)
    expect(p.labels).toEqual(['drug | dmso'])
  })
})

describe('matched context with partial coverage (B measured at fewer doses than A)', () => {
  const row = (uniqID: string, cmpd: string, dose: number, rep: number, value: number): StandardRow => ({
    uniqID,
    cell: '',
    cmpd,
    dose,
    time: null,
    rep,
    value
  })
  const rows: StandardRow[] = [
    row('g1', 'A', 1, 1, 8),
    row('g1', 'A', 1, 2, 9),
    row('g1', 'A', 5, 1, 16),
    row('g1', 'A', 5, 2, 17),
    row('g1', 'A', 10, 1, 32),
    row('g1', 'A', 10, 2, 33),
    row('g1', 'B', 1, 1, 2),
    row('g1', 'B', 1, 2, 3),
    row('g1', 'B', 5, 1, 4),
    row('g1', 'B', 5, 2, 5)
  ]
  const active: ('cmpd' | 'dose')[] = ['cmpd', 'dose']
  it('matches dose like-for-like, skips the dose B lacks, and does not block applying', () => {
    const p = previewCompare({ rows, num: { cmpd: ['A'] }, den: { cmpd: ['B'] }, match: active, activeConditions: active })
    expect(p.matched).toEqual(['dose'])
    expect(p.invariant).toEqual([])
    expect(p.groups).toBe(2)
    expect(p.warnings).toEqual([])
    expect(p.notes.some((n) => n.includes('1 of 3'))).toBe(true)
    const res = runCompare({ rows, num: { cmpd: ['A'] }, den: { cmpd: ['B'] }, match: active, activeConditions: active })
    expect(res.rows.map((r) => r.dose).sort()).toEqual([1, 5])
  })
})

describe('denominator is a single reference (never pooled; the dialog allows one value)', () => {
  const row = (uniqID: string, cmpd: string, rep: number, value: number): StandardRow => ({
    uniqID,
    cell: '',
    cmpd,
    dose: null,
    time: null,
    rep,
    value
  })
  const rows: StandardRow[] = [
    row('g1', 'A', 1, 8),
    row('g1', 'A', 2, 8),
    row('g1', 'B', 1, 16),
    row('g1', 'B', 2, 16),
    row('g1', 'C', 1, 2),
    row('g1', 'C', 2, 2),
    row('g1', 'D', 1, 4),
    row('g1', 'D', 2, 4)
  ]
  it('A, B vs C, D runs four one-on-one comparisons with per-level fold changes', () => {
    const res = runCompare({ rows, num: { cmpd: ['A', 'B'] }, den: { cmpd: ['C', 'D'] }, match: [], activeConditions: ['cmpd'] })
    expect(res.comparisons.sort()).toEqual(['A | C', 'A | D', 'B | C', 'B | D'])
    const fc = new Map(res.rows.map((r) => [r.comparison, r.log2FC]))
    expect(fc.get('A | C')).toBeCloseTo(2, 9) // log2(8/2)
    expect(fc.get('A | D')).toBeCloseTo(1, 9) // log2(8/4)
    expect(fc.get('B | C')).toBeCloseTo(3, 9)
    expect(fc.get('B | D')).toBeCloseTo(2, 9)
    // The preview refuses a multi-value denominator (one reference only) — the run above is the
    // engine's safety net for a stale config, never a configuration the dialog allows.
    const p = previewCompare({ rows, num: { cmpd: ['A', 'B'] }, den: { cmpd: ['C', 'D'] }, match: [], activeConditions: ['cmpd'] })
    expect(p.groups).toBe(0)
    expect(p.warnings.some((w) => w.includes('denominator must be one value'))).toBe(true)
    const ok = previewCompare({ rows, num: { cmpd: ['A', 'B'] }, den: { cmpd: ['C'] }, match: [], activeConditions: ['cmpd'] })
    expect(ok.groups).toBe(2)
  })
})
