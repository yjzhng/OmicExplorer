/** The Compare's analysis: when it's the user's (t-test vs ANOVA), what an ANOVA
 *  compiles to, and a saved 2-way ANOVA read as the ANOVA. */
import { describe, expect, it } from 'vitest'

import { numericConds, type StandardRow } from '../engine'
import { anovaSelectors, compareModel, analysisChoice, type CompareState } from './compareModel'
import {
  anovaFactorsOf,
  isCompareConfigured,
  normalizeCompareConfig,
  type CompareConfig
} from './types'

const numeric = numericConds()
const s = (cmpd: string, cell: string, dose: number): StandardRow => ({
  uniqID: 'g',
  cmpd,
  cell,
  dose,
  time: null,
  rep: 1,
  value: 1
})
const samples = [
  s('DMSO', 'M', 0),
  s('DMSO', 'W', 0),
  ...['A', 'B'].flatMap((c) => ['M', 'W'].flatMap((cell) => [1, 10].map((d) => s(c, cell, d))))
]

describe('analysisChoice', () => {
  it('one condition at two values: a t-test either way', () => {
    expect(analysisChoice(['cmpd'], { cmpd: ['A'] })).toBe(false)
  })
  it('several test values, or several compared conditions: the user picks', () => {
    expect(analysisChoice(['cmpd'], { cmpd: ['A', 'B'] })).toBe(true)
    expect(analysisChoice(['cmpd', 'cell'], { cmpd: ['A'], cell: ['W'] })).toBe(true)
  })
})

describe('anovaSelectors', () => {
  const state: CompareState = {
    cmp: { cmpd: { r: 'DMSO', T: ['A', 'B'] } },
    modes: {},
    fixedVal: {},
    drop: { dose: ['10'] }
  }
  it('factors at their test values and control; context matched, left-out values filtered', () => {
    const m = compareModel(state, samples, ['cmpd', 'cell', 'dose'], numeric)
    const sel = anovaSelectors(m, state, samples)
    expect(sel.num.cmpd).toEqual(['A', 'B'])
    expect(sel.den.cmpd).toEqual(['DMSO'])
    // dose 10 left out on both sides (the vehicle's 0 kept)
    expect(sel.num.dose).toEqual(['0', '1'])
    expect(sel.den.dose).toEqual(['0', '1'])
    expect(sel.match).toEqual(['cell', 'dose'])
  })
})

describe('a saved 2-way ANOVA', () => {
  const base = {
    method: 'ttest',
    threshold: {},
    condition: 'cmpd',
    pairNum: 'A',
    pairDen: 'DMSO',
    condition2: 'cell',
    pair2Num: 'M',
    pair2Den: 'W'
  } as unknown as CompareConfig
  it('reads as the ANOVA, its factors from the legacy fields', () => {
    const c = normalizeCompareConfig({
      ...base,
      analysis: 'two_way_anova'
    } as unknown as CompareConfig)
    expect(c.analysis).toBe('anova')
    expect(c.compared).toEqual(['cmpd', 'cell'])
    expect(c.num).toEqual({ cmpd: ['A'], cell: ['M'] })
    expect(anovaFactorsOf(c, numeric)).toEqual([
      { condition: 'cmpd', pairs: [['A', 'DMSO']] },
      { condition: 'cell', pairs: [['M', 'W']] }
    ])
    expect(isCompareConfigured(c)).toBe(true)
  })
  it('keeps the dialog’s own selectors and compared conditions', () => {
    const c = normalizeCompareConfig({
      ...base,
      analysis: 'two_way_anova',
      num: { cmpd: ['A', 'B'], cell: ['M'] },
      den: { cmpd: ['DMSO'], cell: ['W'] },
      match: [],
      compared: ['cmpd', 'cell']
    } as unknown as CompareConfig)
    expect(c.num.cmpd).toEqual(['A', 'B'])
    expect(anovaFactorsOf(c, numeric)[0].pairs).toEqual([
      ['A', 'DMSO'],
      ['B', 'DMSO']
    ])
  })
})

describe('a numeric compared condition in the ANOVA', () => {
  const cfg = {
    compared: ['cmpd', 'dose'] as Array<'cmpd' | 'dose'>,
    num: { cmpd: ['A'], dose: ['1', '10', '100'] },
    den: { cmpd: ['DMSO'], dose: ['0'] }
  }
  it('is a slope by default, on the scale its levels show', () => {
    const f = anovaFactorsOf(cfg, numeric)
    expect(f[0].slope).toBeUndefined()
    expect(f[1].slope).toBe('log')
  })
  it('a factor when asked; the scale as set', () => {
    expect(anovaFactorsOf({ ...cfg, asFactor: ['dose'] }, numeric)[1].slope).toBeUndefined()
    expect(anovaFactorsOf({ ...cfg, axisScale: { dose: 'linear' } }, numeric)[1].slope).toBe(
      'linear'
    )
  })
  it('a saved 2-way ANOVA keeps its numeric factors as factors', () => {
    const c = normalizeCompareConfig({
      method: 'ttest',
      threshold: {},
      analysis: 'two_way_anova',
      num: { cmpd: ['A'], dose: ['10'] },
      den: { cmpd: ['DMSO'], dose: ['0'] },
      match: [],
      compared: ['cmpd', 'dose']
    } as unknown as CompareConfig)
    expect(c.asFactor).toEqual(['cmpd', 'dose'])
    expect(anovaFactorsOf(c, numeric).every((f) => !f.slope)).toBe(true)
  })
})
