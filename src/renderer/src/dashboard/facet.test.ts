import { describe, expect, it } from 'vitest'

import type { ContrastResultRow } from '../engine'
import { resolveFacets } from './facet'

/** A contrast row (the paired join's FULL OUTER output: FC1/FC2 null where a side is absent). */
function ctr(partial: Partial<ContrastResultRow>): ContrastResultRow {
  return {
    uniqID: 'g',
    cell: null,
    cmpd: null,
    dose: null,
    time: null,
    cmp_cond: 'dataset',
    cmp1: 'KO',
    cmp2: 'WT',
    comparison: 'KO | WT',
    FC1: 1,
    FC2: 1,
    FCdiff: 0,
    P1: null,
    P2: null,
    Pdiff: null,
    Q1: null,
    Q2: null,
    Qdiff: null,
    signf1: false,
    signf2: false,
    effect1: 'none',
    effect2: 'none',
    thrsh: '',
    signf: false,
    effect: 'none',
    ...partial
  }
}

describe('resolveFacets — one-sided contrast levels', () => {
  // Dose 5 and 10 pair; dose 20 exists on the KO side only (outer-join rows, FC2 null).
  const rows = [
    ctr({ dose: 5 }),
    ctr({ dose: 10 }),
    ctr({ dose: 20, FC2: null }),
    ctr({ uniqID: 'h', dose: 20, FC2: null })
  ]

  it('flags the level with no paired data and names the side that has it', () => {
    const { bars } = resolveFacets(rows, ['dose'], {})
    expect(bars[0].options).toEqual([{ value: 5 }, { value: 10 }, { value: 20, onlyOn: 'KO' }])
  })

  it('never lands on a one-sided level: a stale choice falls back to the first paired one', () => {
    const { bars, rows: picked } = resolveFacets(rows, ['dose'], { dose: '20' })
    expect(bars[0].value).toBe(5)
    expect(picked.map((r) => r.dose)).toEqual([5])
  })

  it('a paired choice is honoured', () => {
    expect(resolveFacets(rows, ['dose'], { dose: '10' }).bars[0].value).toBe(10)
  })

  it('narrows per outer level: a dose paired in one cell can be one-sided in another', () => {
    const nested = [
      ctr({ cell: 'A', dose: 5 }),
      ctr({ cell: 'A', dose: 10 }),
      ctr({ cell: 'B', dose: 5 }),
      ctr({ cell: 'B', dose: 10, FC1: null })
    ]
    const inB = resolveFacets(nested, ['cell', 'dose'], { cell: 'B' })
    expect(inB.bars[0].options).toEqual([{ value: 'A' }, { value: 'B' }])
    expect(inB.bars[1].options).toEqual([{ value: 5 }, { value: 10, onlyOn: 'WT' }])
    const inA = resolveFacets(nested, ['cell', 'dose'], { cell: 'A' })
    expect(inA.bars[1].options).toEqual([{ value: 5 }, { value: 10 }])
  })

  it('compare rows (no FC1/FC2) are never greyed out', () => {
    const cmp = [
      { uniqID: 'g', cmp_cond: 'cmpd', comparison: 'X | V', cell: 'WT', dose: 5 },
      { uniqID: 'g', cmp_cond: 'cmpd', comparison: 'X | V', cell: 'WT', dose: 10 }
    ]
    expect(resolveFacets(cmp, ['dose'], {}).bars[0].options).toEqual([{ value: 5 }, { value: 10 }])
  })
})
