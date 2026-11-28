/** The clean-up rule's parts, decided on their own (cleanup.ts). */
import { describe, expect, it } from 'vitest'

import { applyCleanup, cleanupModeOf, cleanupRuleOf, clears, type CleanupRule } from './cleanup'
import type { StandardRow } from '../types'

// 2 groups (P, M) × 3 samples. Each gene's identified samples:
const SAMPLES = ['p1', 'p2', 'p3', 'm1', 'm2', 'm3']
const ID: Record<string, string[]> = {
  A: ['p1', 'p2', 'p3', 'm1', 'm2', 'm3'],
  B: ['p1', 'p2', 'p3', 'm1'],
  C: ['p1'],
  D: ['p1', 'm1']
}
const groupOf = (s: string): string => s[0].toUpperCase()
const rows: StandardRow[] = Object.keys(ID).flatMap((g) =>
  SAMPLES.map((s) => ({
    uniqID: g,
    cell: groupOf(s),
    cmpd: s,
    dose: null,
    time: null,
    rep: null,
    value: ID[g].includes(s) ? 1 : null
  }))
)
const presence = new Map(Object.entries(ID).map(([g, ss]) => [g, new Set(ss)]))
const sampleGroup = new Map(SAMPLES.map((s) => [s, groupOf(s)]))
const run = (rule: CleanupRule) => applyCleanup(rows, presence, sampleGroup, (r) => r.cell, rule)
const kept = (rule: CleanupRule): string[] => [...new Set(run(rule).rows.map((r) => r.uniqID))]
const two = { unit: 'count' as const, value: 2 }

describe('clean-up rule', () => {
  it('threshold: a percentage of the samples, or a number of them', () => {
    expect(clears({ unit: 'pct', value: 50 }, 3, 6)).toBe(true)
    expect(clears({ unit: 'pct', value: 50 }, 2, 6)).toBe(false)
    expect(clears(two, 2, 6)).toBe(true)
    expect(clears(two, 1, 3)).toBe(false)
  })

  it('overall: checked and removed across every sample', () => {
    expect(kept(cleanupRuleOf('overall', [], two))).toEqual(['A', 'B', 'D'])
  })

  it('at least one group / every group: checked within, the whole gene removed', () => {
    expect(kept(cleanupRuleOf('anyGroup', ['cell'], two))).toEqual(['A', 'B'])
    expect(kept(cleanupRuleOf('everyGroup', ['cell'], two))).toEqual(['A'])
  })

  it('required groups between 1 and all', () => {
    const rule = { ...cleanupRuleOf('anyGroup', ['cell'], { unit: 'count' as const, value: 1 }) }
    expect(kept({ ...rule, required: 2 })).toEqual(['A', 'B', 'D'])
  })

  it('within each group: values removed where short, the gene kept where it clears', () => {
    const r = run(cleanupRuleOf('withinGroup', ['cell'], two))
    expect([...new Set(r.rows.map((x) => x.uniqID))]).toEqual(['A', 'B'])
    // B's lone M value goes; its M rows stay, missing
    const bM = r.rows.filter((x) => x.uniqID === 'B' && x.cell === 'M')
    expect(bM).toHaveLength(3)
    expect(bM.every((x) => x.value == null)).toBe(true)
    expect(r.removedValues).toBe(1)
  })

  it('a threshold of 0 removes nothing; each preset reads back as its mode', () => {
    expect(run(cleanupRuleOf('overall', [], { unit: 'pct', value: 0 })).rows).toBe(rows)
    for (const m of ['overall', 'withinGroup', 'anyGroup', 'everyGroup'] as const)
      expect(cleanupModeOf(cleanupRuleOf(m, ['cell'], two))).toBe(m)
  })
})
