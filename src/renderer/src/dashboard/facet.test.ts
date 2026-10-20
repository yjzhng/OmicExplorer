import { describe, expect, it } from 'vitest'
import { numericConds } from '../engine'

import type { ContrastResultRow } from '../engine'
import { facetBarLabel, facetChoice, pickFacet, resolveFacets } from './facet'

/** dose and time numeric, no custom condition declared (the schema of these tests' data) */
const numeric = numericConds()

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
    const { bars } = resolveFacets(rows, ['dose'], {}, numeric)
    expect(bars[0].options).toEqual([{ value: 5 }, { value: 10 }, { value: 20, onlyOn: 'KO' }])
  })

  it('never lands on a one-sided level: a stale choice falls back to the first paired one', () => {
    const { bars, rows: picked } = resolveFacets(rows, ['dose'], { dose: '20' }, numeric)
    expect(bars[0].value).toBe(5)
    expect(picked.map((r) => r.dose)).toEqual([5])
  })

  it('a paired choice is honoured', () => {
    expect(resolveFacets(rows, ['dose'], { dose: '10' }, numeric).bars[0].value).toBe(10)
  })

  it('narrows per outer level: a dose paired in one cell can be one-sided in another', () => {
    const nested = [
      ctr({ cell: 'A', dose: 5 }),
      ctr({ cell: 'A', dose: 10 }),
      ctr({ cell: 'B', dose: 5 }),
      ctr({ cell: 'B', dose: 10, FC1: null })
    ]
    const inB = resolveFacets(nested, ['cell', 'dose'], { cell: 'B' }, numeric)
    expect(inB.bars[0].options).toEqual([{ value: 'A' }, { value: 'B' }])
    expect(inB.bars[1].options).toEqual([{ value: 5 }, { value: 10, onlyOn: 'WT' }])
    const inA = resolveFacets(nested, ['cell', 'dose'], { cell: 'A' }, numeric)
    expect(inA.bars[1].options).toEqual([{ value: 5 }, { value: 10 }])
  })

  it('compare rows (no FC1/FC2) are never greyed out', () => {
    const cmp = [
      { uniqID: 'g', cmp_cond: 'cmpd', comparison: 'X | V', cell: 'WT', dose: 5 },
      { uniqID: 'g', cmp_cond: 'cmpd', comparison: 'X | V', cell: 'WT', dose: 10 }
    ]
    expect(resolveFacets(cmp, ['dose'], {}, numeric).bars[0].options).toEqual([
      { value: 5 },
      { value: 10 }
    ])
  })
})

describe('a dim not gated by the ones to its left', () => {
  // one comparison per compound (each vs DMSO), at two doses
  const rows = ['A', 'B', 'C'].flatMap((c) =>
    [1, 10].map((dose) => ctr({ cmpd: c, dose, comparison: `${c} | DMSO` }))
  )
  const dims = ['comparison', 'cmpd', 'dose'] as const

  it('offers every compound, the others marked as moving the comparison', () => {
    const { bars } = resolveFacets(rows, [...dims], { comparison: 'A | DMSO' }, numeric)
    expect(bars[1].options).toEqual([
      { value: 'A' },
      { value: 'B', moves: true },
      { value: 'C', moves: true }
    ])
    expect(bars[1].value).toBe('A')
  })
  it('picking one brings its comparison along, keeping the dose on show', () => {
    const sel = pickFacet(
      rows,
      [...dims],
      { comparison: 'A | DMSO', dose: '10' },
      'cmpd',
      'C',
      numeric
    )
    expect(sel).toEqual({ comparison: 'C | DMSO', cmpd: 'C', dose: '10' })
    const { bars } = resolveFacets(rows, [...dims], sel, numeric)
    expect(bars.map((b) => b.value)).toEqual(['C | DMSO', 'C', 10])
  })
  it('a level alongside the picks moves nothing', () => {
    const sel = pickFacet(rows, [...dims], { comparison: 'B | DMSO' }, 'dose', '1', numeric)
    expect(sel).toEqual({ comparison: 'B | DMSO', dose: '1' })
  })
})

describe('comparisons sharing a denominator', () => {
  const bar = (values: string[]) => ({
    dim: 'comparison' as const,
    value: values[0],
    options: values.map((value) => ({ value }))
  })
  it('show just their numerators, the bar naming the denominator once', () => {
    const b = bar(['10 | 0', '100 | 0', '1000 | 0'])
    expect(facetBarLabel(b)).toBe('comparison vs 0')
    expect(b.options.map((o) => facetChoice('comparison', o, [b]).label)).toEqual([
      '10',
      '100',
      '1000'
    ])
    // the value picked is still the comparison
    expect(facetChoice('comparison', b.options[0], [b]).value).toBe('10 | 0')
  })
  it('keep the whole name when they differ', () => {
    const b = bar(['A | DMSO', 'B | Vehicle'])
    expect(facetBarLabel(b)).toBe('comparison')
    expect(facetChoice('comparison', b.options[1], [b]).label).toBe('B | Vehicle')
  })
})
