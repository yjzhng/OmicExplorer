import { describe, expect, it } from 'vitest'
import { numericConds, type StandardRow } from '../../engine'
import { measuredSets } from '../../engine/stats/sets'
import type { GeneSet, NodeResult } from '../../graph/types'
import { setsOf } from './model'

const row = (uniqID: string, cmpd: string, rep: number, value: number | null): StandardRow => ({
  uniqID,
  cell: '',
  cmpd,
  dose: null,
  time: null,
  rep,
  value
})

const quantity = measuredSets({
  rows: [
    row('a', 'DMSO', 1, 1),
    row('b', 'DMSO', 1, 1),
    row('a', 'DMSO', 2, 1),
    row('b', 'DMSO', 2, null),
    row('a', 'DrugA', 1, 1),
    row('c', 'DrugA', 1, 1)
  ]
})
const run: Extract<NodeResult, { kind: 'sets' }> = { kind: 'sets', quantity }
const numeric = numericConds()
const saved: GeneSet[] = [{ id: 'g1', name: 'targets', genes: [{ id: 'c', label: 'C' }] }]

describe('setsOf', () => {
  it('groups samples by every condition by default, picking the first sets', () => {
    const { choices, sets } = setsOf({}, run, '', saved, numeric)
    expect(choices.map((c) => c.label)).toEqual(['DMSO', 'DrugA'])
    // half of DMSO's two samples is one: b counts
    expect(sets.map((s) => [s.label, [...s.members].sort().join('')])).toEqual([
      ['DMSO', 'ab'],
      ['DrugA', 'ac']
    ])
  })

  it('keeps the picked sets and adds the saved gene sets asked for', () => {
    const { sets } = setsOf(
      { sets: ['cmpd=DrugA'], geneSets: ['g1'], minShare: 1 },
      run,
      '',
      saved,
      numeric
    )
    expect(sets.map((s) => [s.label, [...s.members].sort().join('')])).toEqual([
      ['DrugA', 'ac'],
      ['targets', 'c']
    ])
  })

  it('draws a set per sample', () => {
    const { sets } = setsOf({ groupBy: 'sample', sets: undefined }, run, '', saved, numeric)
    expect(sets.map((s) => s.label)).toEqual(['DMSO · r1', 'DMSO · r2', 'DrugA · r1'])
  })
})
