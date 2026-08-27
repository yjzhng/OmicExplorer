import { describe, it, expect } from 'vitest'
import { facetContextDims, facetCompareRows, facetDims } from './plotData'
import type { CompareResultRow } from './types'

function row(partial: Partial<CompareResultRow>): CompareResultRow {
  return {
    uniqID: 'g',
    cmpd: 'Amk',
    dose: null,
    time: null,
    cmp_cond: 'cmpd',
    comparison: 'Amk | H2O',
    mean1: 0,
    mean2: 0,
    sd1: 0,
    sd2: 0,
    log2FC: 0,
    pP: 0,
    pQ: 0,
    thrsh: '',
    signf: false,
    effect: 'none',
    ...partial
  }
}

describe('context faceting (omicViz plot_group_cols parity)', () => {
  it('veh_norm (cmp_cond=cmpd): excludes cmpd; keeps strain + dose that carry values', () => {
    const rows = [
      row({ uniqID: 'a', strain: 'WT', dose: 10 }),
      row({ uniqID: 'a', strain: 'clpP', dose: 5 })
    ]
    // cmpd is the consumed dim (in the comparison label); time is absent → excluded.
    expect(facetContextDims(rows)).toEqual(['strain', 'dose'])
  })

  it('direct strain comparison (cmp_cond=strain): excludes strain, not offered as a facet', () => {
    // clpP-vs-WT: every row carries the numerator strain; cmpd + dose are context.
    const rows = [
      row({ cmp_cond: 'strain', strain: 'clpP', cmpd: 'Amk', dose: 10 }),
      row({ cmp_cond: 'strain', strain: 'clpP', cmpd: 'H2O', dose: 0 })
    ]
    expect(facetContextDims(rows)).toEqual(['cmpd', 'dose'])
  })

  it('facetDims prepends `comparison` only when a tile has multiple comparisons', () => {
    // Single comparison → no comparison facet (just context).
    const one = [row({ comparison: 'Amk | H2O', dose: 10 }), row({ comparison: 'Amk | H2O', dose: 5 })]
    expect(facetDims(one)).toEqual(['dose'])
    // Multiple comparisons (all-compounds veh_norm) → `comparison` becomes the first facet, so the
    // pairs split into separate plots instead of merging.
    const many = [
      row({ comparison: 'Amk | H2O', cmpd: 'Amk', dose: 10 }),
      row({ comparison: 'Kan | H2O', cmpd: 'Kan', dose: 10 })
    ]
    expect(facetDims(many)).toEqual(['comparison', 'dose'])
    const groups = facetCompareRows(many, ['comparison'])
    expect(groups.map((g) => g.key)).toEqual(['comparison=Amk | H2O', 'comparison=Kan | H2O'])
  })

  it('two-way ANOVA (cmp_cond=cmpd:dose): excludes both factors, keeps strain', () => {
    const rows = [
      row({ cmp_cond: 'cmpd:dose', strain: 'WT', cmpd: 'Amk', dose: 10 }),
      row({ cmp_cond: 'cmpd:dose', strain: 'clpP', cmpd: 'Amk', dose: 10 })
    ]
    expect(facetContextDims(rows)).toEqual(['strain'])
  })

  it('splits into one group per (strain,dose) tuple, numeric-sorted', () => {
    const rows = [
      row({ uniqID: 'a', strain: 'WT', dose: 10 }),
      row({ uniqID: 'b', strain: 'WT', dose: 2.5 }),
      row({ uniqID: 'a', strain: 'WT', dose: 2.5 }),
      row({ uniqID: 'a', strain: 'clpP', dose: 10 })
    ]
    const groups = facetCompareRows(rows, ['strain', 'dose'])
    expect(groups.map((g) => g.key)).toEqual([
      'strain=WT · dose=2.5',
      'strain=WT · dose=10',
      'strain=clpP · dose=10'
    ])
    expect(groups[0].rows).toHaveLength(2) // WT@2.5 has two genes
  })

  it('faceting by a single dim pools the rest (strain tab)', () => {
    const rows = [
      row({ strain: 'WT', dose: 10 }),
      row({ strain: 'WT', dose: 5 }),
      row({ strain: 'clpP', dose: 10 })
    ]
    const byStrain = facetCompareRows(rows, ['strain'])
    expect(byStrain.map((g) => g.key)).toEqual(['strain=WT', 'strain=clpP'])
    expect(byStrain[0].rows).toHaveLength(2) // both WT doses pooled
  })

  it('no context dims → one group with all rows', () => {
    const rows = [row({ dose: null }), row({ dose: null })]
    expect(facetContextDims(rows)).toEqual([])
    expect(facetCompareRows(rows, [])).toHaveLength(1)
  })
})
