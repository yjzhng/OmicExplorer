import { describe, expect, it } from 'vitest'
import { levelPathsOf, termLevelsOf } from './enrichLevels'

describe('levelPathsOf', () => {
  it('pairs each term with its aligned levels', () => {
    const ann = {
      a: { KEGG: 'Glycolysis; Ribosome', KEGG_cat: 'Metabolism; Genetic', KEGG_grp: 'Carb; Transl' }
    }
    const p = levelPathsOf(ann, 'KEGG', ['KEGG_cat', 'KEGG_grp'])
    expect(p.get('Glycolysis')).toEqual([['Metabolism', 'Carb']])
    expect(p.get('Ribosome')).toEqual([['Genetic', 'Transl']])
  })

  it('a term under two parents has two paths', () => {
    const ann = { a: { R: 'X', R_cat: 'C1 / C2', R_grp: 'G1 / G2' } }
    expect(levelPathsOf(ann, 'R', ['R_cat', 'R_grp']).get('X')).toEqual([
      ['C1', 'G1'],
      ['C2', 'G2']
    ])
  })

  it('stops at the first level the data lacks', () => {
    const ann = { a: { K: 'P', K_cat: 'C', K_grp: '' } }
    expect(levelPathsOf(ann, 'K', ['K_cat', 'K_grp']).get('P')).toEqual([['C']])
    expect(levelPathsOf({ a: { K: 'P' } }, 'K', ['K_cat']).has('P')).toBe(false)
  })
})

describe('termLevelsOf', () => {
  it('GO terms sit under their aspect', () => {
    const t = termLevelsOf('go', { a: { GO_BP: 'glycolysis', GO_CC: 'cytosol' } })
    expect(t.levels).toEqual(['aspect'])
    expect(t.paths.get('cytosol')).toEqual([['Cellular component']])
  })

  it("KEGG falls back to the category map where there's no aligned column", () => {
    const t = termLevelsOf('kegg', { a: { KEGG: 'Old' } }, { Old: 'Metabolism' })
    expect(t.paths.get('Old')).toEqual([['Metabolism']])
  })
})
