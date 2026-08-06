/**
 * Contrasting two levels of a *context* condition inside ONE comparison — e.g. the
 * clpP vs WT strains of a single vehicle normalisation. This is omicViz's native
 * contrast shape (`condition: strain, pairs: [[clpP, WT]]`): the pooled primary rows
 * are sliced by the condition and joined on uniqID + the remaining context (dose).
 */
import { describe, expect, it } from 'vitest'

import { runContrast } from './contrast'
import type { CompareResultRow } from './types'

/** One veh_norm row: gene g in `strain` at `dose`, Amk-vs-H2O log2FC. */
const row = (uniqID: string, strain: string, dose: number, log2FC: number): CompareResultRow => ({
  uniqID,
  strain,
  cmpd: 'Amk',
  dose,
  time: null,
  cmp_cond: 'cmpd', // the PRIMARY axis — the contrast axis is `strain`
  comparison: 'Amk | H2O',
  mean1: null,
  mean2: null,
  sd1: null,
  sd2: null,
  log2FC,
  pP: 2,
  pQ: 1,
  thrsh: '',
  signf: false,
  effect: 'none'
})

describe('contrast over a context condition (clpP vs WT from one veh_norm)', () => {
  // One veh_norm carrying both strains as context, at two doses.
  const rows: CompareResultRow[] = [
    row('g1', 'WT', 5, 1.0),
    row('g1', 'clpP', 5, 3.0),
    row('g2', 'WT', 5, -0.5),
    row('g2', 'clpP', 5, -2.0),
    row('g1', 'WT', 10, 2.0),
    row('g1', 'clpP', 10, 5.0)
  ]
  const res = runContrast({
    rows,
    condition: 'strain',
    pair: ['clpP', 'WT'],
    relationship: 'correlated'
  })

  it('pairs each gene+dose across the two strains', () => {
    expect(res.rows).toHaveLength(3) // g1@5, g2@5, g1@10
    const g1d5 = res.rows.find((r) => r.uniqID === 'g1' && r.dose === 5)!
    expect(g1d5.FC1).toBe(3.0) // clpP → FC1
    expect(g1d5.FC2).toBe(1.0) // WT   → FC2
    expect(g1d5.FCdiff).toBe(2.0)
  })

  it('makes strain the contrast axis and keeps dose as joined context', () => {
    const r = res.rows[0]
    expect(r.cmp_cond).toBe('strain')
    expect(r.dose).not.toBeNull() // dose survives as context
    // The split condition is consumed by the contrast, not carried as context.
    expect(r.strain).toBeUndefined()
  })

  it('labels the sides by the strain values, not the shared "Amk | H2O" norm label', () => {
    expect(res.comparisons).toEqual(['clpP | WT'])
    expect(res.rows[0].cmp1).toBe('clpP')
    expect(res.rows[0].cmp2).toBe('WT')
  })
})

describe('contrast against a dose-less vehicle (drug effect vs basal)', () => {
  // A strain comparison keeps cmpd as context: the drug sits at 2.5/5/10, the vehicle
  // only ever at dose 0. Joining on dose would match nothing, so dose is dropped from the
  // key while still being carried as context — each drug dose pairs with the basal row.
  const row = (uniqID: string, cmpd: string, dose: number, log2FC: number): CompareResultRow => ({
    uniqID,
    strain: '',
    cmpd,
    dose,
    time: null,
    cmp_cond: 'strain',
    comparison: 'clpP | WT',
    mean1: null,
    mean2: null,
    sd1: null,
    sd2: null,
    log2FC,
    pP: 2,
    pQ: 1,
    thrsh: '',
    signf: false,
    effect: 'none'
  })
  const rows: CompareResultRow[] = [
    row('g1', 'H2O', 0, 0.5), // basal strain difference
    row('g1', 'Amk', 2.5, 1.5),
    row('g1', 'Amk', 5, 2.5),
    row('g1', 'Amk', 10, 3.5)
  ]
  const res = runContrast({
    rows,
    condition: 'cmpd',
    pair: ['Amk', 'H2O'],
    relationship: 'correlated'
  })

  it('pairs every drug dose against the single vehicle row', () => {
    expect(res.rows).toHaveLength(3)
    expect(res.rows.map((r) => r.dose).sort((a, b) => (a as number) - (b as number))).toEqual([
      2.5, 5, 10
    ])
    // FC2 is the basal value on every row; FC1 is that dose's strain difference.
    expect(res.rows.every((r) => r.FC2 === 0.5)).toBe(true)
    expect(res.rows.find((r) => r.dose === 10)?.FC1).toBe(3.5)
  })
})
