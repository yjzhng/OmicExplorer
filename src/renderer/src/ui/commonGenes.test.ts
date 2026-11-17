import { describe, expect, it } from 'vitest'

import { commonGenes } from './useSelection'

const set = (...ids: string[]) => ({ genes: ids.map((id) => ({ id, label: id })) })

describe('commonGenes (the gene selector’s intersection)', () => {
  it('the genes every group holds', () => {
    expect(
      commonGenes([set('a', 'b', 'c'), set('b', 'c', 'd'), set('c', 'b', 'e')]).sort()
    ).toEqual(['b', 'c'])
  })
  it('one group: its genes; none: nothing; disjoint: nothing', () => {
    expect(commonGenes([set('a', 'b')])).toEqual(['a', 'b'])
    expect(commonGenes([])).toEqual([])
    expect(commonGenes([set('a'), set('b')])).toEqual([])
  })
})
