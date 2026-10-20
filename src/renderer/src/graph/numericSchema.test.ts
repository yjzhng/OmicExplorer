/** The condition schema in the graph: Clean data records it, Compare and Contrast carry it on, and
 *  the dialogs' models read their values in its order. */
import { describe, expect, it } from 'vitest'

import { customCond, numericConds, type StandardRow, type StandardizeResult } from '../engine'
import { valuesOf } from './compareModel'
import { numericOfResult, numericUnion, type NodeResult } from './types'

const TEMP = customCond('temp')
const DAY = customCond('day')
const std = (numericConditions?: Array<`@${string}`>): NodeResult => ({
  kind: 'standardize',
  std: { numericConditions } as unknown as StandardizeResult
})
const cmp = (numericConditions?: Array<`@${string}`>): NodeResult =>
  ({ kind: 'compare', numericConditions }) as unknown as NodeResult

describe('numericOfResult', () => {
  it('reads Clean data’s schema, and what Compare / Contrast carried on', () => {
    expect(numericOfResult(std([TEMP])).has(TEMP)).toBe(true)
    expect(numericOfResult(cmp([TEMP])).has(TEMP)).toBe(true)
    expect(numericOfResult({ kind: 'contrast', numericConditions: [DAY] } as never).has(DAY)).toBe(
      true
    )
  })
  it('dose and time always; nothing else without a declaration (or a result)', () => {
    for (const r of [std(), cmp(), undefined, { kind: 'plot' } as NodeResult]) {
      const n = numericOfResult(r)
      expect([...n].sort()).toEqual(['dose', 'time'])
    }
  })
})

describe('numericUnion', () => {
  it('a Contrast’s inputs: numeric where either input declared it', () => {
    expect(numericUnion([std([TEMP]), cmp([DAY, TEMP]), undefined]).sort()).toEqual([DAY, TEMP])
  })
})

describe('the dialogs list a declared numeric condition’s values by number', () => {
  const rows = ['-5', '-10', '2.5', '10'].map(
    (t) => ({ extra: { temp: t } }) as unknown as StandardRow
  )
  it('declared: −10 < −5 < 2.5 < 10', () => {
    expect(valuesOf(rows, TEMP, numericConds([TEMP]))).toEqual(['-10', '-5', '2.5', '10'])
  })
  it('categorical: natural text order', () => {
    expect(valuesOf(rows, TEMP, numericConds())).toEqual(['-5', '-10', '2.5', '10'])
  })
})
