import { describe, expect, it } from 'vitest'
import { groupIndexer, groupOrderOf } from './groupOrder'

describe('groupOrderOf', () => {
  const ann = {
    g1: { GO_BP: 'apoptosis', GO_CC: 'nucleus' },
    g2: { GO_MF: 'kinase activity', KEGG: 'p1;p2' },
    g3: { KEGG: 'p3' }
  }
  const cats = { p1: 'Metabolism', p2: 'Cellular Processes', p3: 'Metabolism' }

  it('lists every group the source has in the data, alphabetically', () => {
    expect(groupOrderOf('go', ann, cats)).toEqual([
      'Biological process',
      'Cellular component',
      'Molecular function'
    ])
    expect(groupOrderOf('kegg', ann, cats)).toEqual(['Cellular Processes', 'Metabolism'])
  })

  it('is the same order (the same array) on every call for the same data', () => {
    expect(groupOrderOf('go', ann, cats)).toBe(groupOrderOf('go', ann, cats))
  })

  it('a source without groups has none', () => {
    expect(groupOrderOf('msigdb_h' as never, ann, cats)).toEqual([])
  })
})

describe('groupIndexer', () => {
  it('a group’s colour is its place in the order, whatever the plot shows', () => {
    const at = groupIndexer(['A', 'B', 'C'])
    // a plot showing only C, then B: C keeps index 2, B index 1
    expect([at('C', 0), at('B', 1)]).toEqual([2, 1])
  })
  it('an unknown group goes after every known one', () => {
    expect(groupIndexer(['A', 'B'])('Z', 0)).toBe(2)
  })
})
