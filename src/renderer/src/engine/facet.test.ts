import { describe, it, expect } from 'vitest'
import { facetContextDims, facetCompareRows, facetDims, facetPaired, facetSides } from './plotData'
import type { ContrastResultRow } from './contrast'
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
  it('veh_norm (cmp_cond=cmpd): excludes cmpd; keeps cell + dose that carry values', () => {
    const rows = [
      row({ uniqID: 'a', cell: 'WT', dose: 10 }),
      row({ uniqID: 'a', cell: 'clpP', dose: 5 })
    ]
    // cmpd is the consumed dim (in the comparison label); time is absent → excluded.
    expect(facetContextDims(rows)).toEqual(['cell', 'dose'])
  })

  it('direct cell comparison (cmp_cond=cell): excludes cell, not offered as a facet', () => {
    // clpP-vs-WT: every row carries the numerator cell; cmpd + dose are context.
    const rows = [
      row({ cmp_cond: 'cell', cell: 'clpP', cmpd: 'Amk', dose: 10 }),
      row({ cmp_cond: 'cell', cell: 'clpP', cmpd: 'H2O', dose: 0 })
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

  it('two-way ANOVA (cmp_cond=cmpd:dose): excludes both factors, keeps cell', () => {
    const rows = [
      row({ cmp_cond: 'cmpd:dose', cell: 'WT', cmpd: 'Amk', dose: 10 }),
      row({ cmp_cond: 'cmpd:dose', cell: 'clpP', cmpd: 'Amk', dose: 10 })
    ]
    expect(facetContextDims(rows)).toEqual(['cell'])
  })

  it('splits into one group per (cell,dose) tuple, numeric-sorted', () => {
    const rows = [
      row({ uniqID: 'a', cell: 'WT', dose: 10 }),
      row({ uniqID: 'b', cell: 'WT', dose: 2.5 }),
      row({ uniqID: 'a', cell: 'WT', dose: 2.5 }),
      row({ uniqID: 'a', cell: 'clpP', dose: 10 })
    ]
    const groups = facetCompareRows(rows, ['cell', 'dose'])
    expect(groups.map((g) => g.key)).toEqual([
      'cell=WT · dose=2.5',
      'cell=WT · dose=10',
      'cell=clpP · dose=10'
    ])
    expect(groups[0].rows).toHaveLength(2) // WT@2.5 has two genes
  })

  it('faceting by a single dim pools the rest (cell tab)', () => {
    const rows = [
      row({ cell: 'WT', dose: 10 }),
      row({ cell: 'WT', dose: 5 }),
      row({ cell: 'clpP', dose: 10 })
    ]
    const byCell = facetCompareRows(rows, ['cell'])
    expect(byCell.map((g) => g.key)).toEqual(['cell=WT', 'cell=clpP'])
    expect(byCell[0].rows).toHaveLength(2) // both WT doses pooled
  })

  it('no context dims → one group with all rows', () => {
    const rows = [row({ dose: null }), row({ dose: null })]
    expect(facetContextDims(rows)).toEqual([])
    expect(facetCompareRows(rows, [])).toHaveLength(1)
  })
})

/** Contrast row: the paired join's FULL OUTER output, so FC1/FC2 may be null on one side. */
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

describe('facetPaired / facetSides (one-sided outer-join contexts)', () => {
  it('compare rows (no FC1/FC2) always count as paired', () => {
    expect(facetPaired([row({ cell: 'WT' })])).toBe(true)
  })

  it('a contrast facet is paired when at least one gene has both sides', () => {
    expect(facetPaired([ctr({ FC2: null }), ctr({ uniqID: 'h' })])).toBe(true)
  })

  it('a context measured on one side only is unpaired, and names that side', () => {
    const rows = [ctr({ FC2: null }), ctr({ uniqID: 'h', FC2: null })]
    expect(facetPaired(rows)).toBe(false)
    expect(facetSides(rows)).toEqual(['KO'])
  })

  it('a mixed one-sided facet (some genes only on A, others only on B) names both', () => {
    const rows = [ctr({ FC2: null }), ctr({ uniqID: 'h', FC1: null })]
    expect(facetPaired(rows)).toBe(false)
    expect(facetSides(rows)).toEqual(['KO', 'WT'])
  })
})
