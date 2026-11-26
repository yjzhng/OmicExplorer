import { describe, expect, it } from 'vitest'
import type { EnrichData, EnrichTerm } from '../../engine'
import { cutTerms } from './termCut'

const term = (name: string, category?: string): EnrichTerm =>
  ({ term: name, category, pAdjust: 0.01 }) as EnrichTerm
const data = (up: EnrichTerm[], down: EnrichTerm[] = []): EnrichData =>
  ({ method: 'ora', up, down }) as unknown as EnrichData

describe('cutTerms', () => {
  it('caps each direction', () => {
    const d = cutTerms(data([term('a'), term('b'), term('c')], [term('x'), term('y')]), 2)
    expect(d.up.map((t) => t.term)).toEqual(['a', 'b'])
    expect(d.down.map((t) => t.term)).toEqual(['x', 'y'])
  })

  it('a choice draws its own top terms, from past the cap', () => {
    const full = data([term('a', 'P'), term('b', 'P'), term('c', 'Q'), term('d', 'Q')])
    expect(cutTerms(full, 2).up.map((t) => t.term)).toEqual(['a', 'b'])
    expect(cutTerms(full, 2, (t) => t.category === 'Q').up.map((t) => t.term)).toEqual(['c', 'd'])
  })

  it('one per module keeps each module its first term', () => {
    const of = new Map([
      ['a', 'M'],
      ['b', 'M'],
      ['d', 'N']
    ])
    const full = data([term('a'), term('b'), term('c'), term('d'), term('e')])
    expect(cutTerms(full, 3, undefined, of).up.map((t) => t.term)).toEqual(['a', 'c', 'd'])
  })
})
