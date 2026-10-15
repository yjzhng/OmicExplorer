/** The selector window's two-sided picks: a saved setup reads into picks and writes back as the
 *  same num / den / match, in every mode the old per-mode window saved; and the roles follow from
 *  where the sides differ. */
import { describe, expect, it } from 'vitest'

import type { CondSelector, ConditionKey } from '../engine'
import { picksOf, readSides, type SidesInput } from './sides'

const values = {
  cell: ['HeLa', 'K562'],
  cmpd: ['A', 'B', 'DMSO'],
  dose: ['0', '1', '10', '100'],
  time: ['1', '24']
} as Partial<Record<ConditionKey, string[]>>
const ordered: ConditionKey[] = ['cell', 'cmpd', 'dose', 'time']

const roundTrip = (
  saved: { num: CondSelector; den: CondSelector; match: ConditionKey[] },
  curve?: SidesInput['curve']
) => {
  const s = readSides({
    picks: { a: picksOf(saved.num), b: picksOf(saved.den) },
    values,
    ordered,
    matchOn: saved.match,
    curve
  })
  return { num: s.num, den: s.den, match: s.match, compared: s.compared }
}

describe('saved setups write back unchanged', () => {
  it('a t-test with an inclusion filter', () => {
    const saved = {
      num: { cmpd: ['A', 'B'], cell: ['HeLa'] },
      den: { cmpd: ['DMSO'], cell: ['HeLa'] },
      match: ['cell', 'dose', 'time'] as ConditionKey[]
    }
    const r = roundTrip(saved)
    expect(r.num).toEqual(saved.num)
    expect(r.den).toEqual(saved.den)
    expect(r.match).toEqual(saved.match)
    expect(r.compared).toEqual(['cmpd'])
  })

  it('a curve fit against a control compound (every level of it)', () => {
    const saved = {
      num: { cmpd: ['A', 'B'], dose: ['1', '10', '100'] },
      den: { cmpd: ['DMSO'] },
      match: ['cell', 'time'] as ConditionKey[]
    }
    const r = roundTrip(saved, { axes: ['dose'], ref: 'dose', surface: false })
    expect(r.num).toEqual(saved.num)
    expect(r.den).toEqual(saved.den)
    expect(r.match).toEqual(saved.match)
    expect(r.compared).toEqual(['cmpd'])
  })

  it('a curve fit with each compound against its own dose 0', () => {
    const saved = {
      num: { cmpd: ['A', 'B'], dose: ['1', '10', '100'] },
      den: { cmpd: ['A', 'B'], dose: ['0'] },
      match: ['cell', 'cmpd', 'time'] as ConditionKey[]
    }
    const r = roundTrip(saved, { axes: ['dose'], ref: 'dose', surface: false })
    expect(r.num).toEqual(saved.num)
    expect(r.den).toEqual(saved.den)
    expect(r.match).toEqual(['cell', 'cmpd', 'time'])
    expect(r.compared).toEqual(['dose'])
  })

  it('a dose × time surface never pins time', () => {
    const r = roundTrip(
      { num: { cmpd: ['A'], dose: ['1', '10'] }, den: { cmpd: ['DMSO'] }, match: ['cell'] },
      { axes: ['dose', 'time'], ref: 'dose', surface: true }
    )
    expect(r.num).not.toHaveProperty('time')
    expect(r.den).not.toHaveProperty('time')
    expect(r.match).toEqual(['cell'])
  })

  it('a contrast differing on two conditions', () => {
    const saved = {
      num: { cell: ['K562'], dose: ['10'] },
      den: { cell: ['HeLa'], dose: ['1'] },
      match: ['cmpd', 'time'] as ConditionKey[]
    }
    const r = roundTrip(saved)
    expect(r.num).toEqual(saved.num)
    expect(r.den).toEqual(saved.den)
    expect(r.compared).toEqual(['cell', 'dose'])
  })
})

describe('roles from the picks', () => {
  it('every value on both sides: nothing compared, all context', () => {
    const s = readSides({ picks: { a: {}, b: {} }, values, ordered, matchOn: ordered })
    expect(s.compared).toEqual([])
    expect(s.context).toEqual(ordered)
    expect(s.num).toEqual({})
    expect(s.den).toEqual({})
  })

  it('a context condition switched off is pooled: out of the match set', () => {
    const s = readSides({
      picks: { a: { cmpd: ['A'] }, b: { cmpd: ['DMSO'] } },
      values,
      ordered,
      matchOn: ['cell', 'dose']
    })
    expect(s.compared).toEqual(['cmpd'])
    expect(s.match).toEqual(['cell', 'dose'])
  })

  it('a pick of every value leaves that side free (unpinned)', () => {
    const s = readSides({
      picks: { a: { cmpd: ['A', 'B', 'DMSO'] }, b: { cmpd: ['DMSO'] } },
      values,
      ordered,
      matchOn: []
    })
    expect(s.num).not.toHaveProperty('cmpd')
    expect(s.den).toEqual({ cmpd: ['DMSO'] })
  })
})
