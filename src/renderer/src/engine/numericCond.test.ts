/**
 * A custom condition declared numeric at import: the dataset's condition schema (NumericConds)
 * carries it from ingest through Clean data, merges and filters to everything that asks
 * isNumericCond — so it sorts, facets and colours as dose and time do, and a categorical one never.
 */
import { describe, expect, it } from 'vitest'

import { combineStandardize } from './combine'
import { analysisUnmet, dataShape } from './dataShape'
import { baselineText } from './direct'
import { standardize } from './ingest'
import { buildStandardInputs, type InteractiveSampleCond } from './interactive'
import { facetCompareRows } from './plotData'
import { conditionLevels, subsetStandardize } from './subset'
import { customCond, isNumericCond, numericConds, numericOf, type StandardRow } from './types'

const TEMP = customCond('temp')
const BATCH = customCond('batch')

// 12 samples: DrugA and DMSO at six temperatures, one replicate; `batch` a numeric-looking id that
// stays categorical (one batch, so it doesn't split the curves).
const TEMPS = ['37', '41', '44', '47', '50', '53']
const samples = TEMPS.flatMap((t, i) => [
  { sample: `v${i}`, cmpd: 'DMSO', temp: t, batch: '1' },
  { sample: `a${i}`, cmpd: 'DrugA', temp: t, batch: '1' }
])
const SHEET = [
  'sample,cmpd,temp,batch',
  ...samples.map((s) => [s.sample, s.cmpd, s.temp, s.batch].join(','))
].join('\n')
const DATA = [
  ['id', ...samples.map((s) => s.sample)].join(','),
  ['g1', ...samples.map((_, i) => String(10 + i))].join(','),
  ['g2', ...samples.map((_, i) => String(20 + i))].join(',')
].join('\n')
const std = (numeric?: string[], sheet = SHEET) =>
  standardize({
    dataText: DATA,
    dataFilename: 'd_wide.csv',
    samplesheetText: sheet,
    customConditions: ['temp', 'batch'],
    numericConditions: numeric
  })

describe('the condition schema', () => {
  it('dose and time are always numeric; a custom one only when declared', () => {
    const plain = numericConds()
    expect(isNumericCond('dose', plain)).toBe(true)
    expect(isNumericCond('time', plain)).toBe(true)
    expect(isNumericCond('cmpd', plain)).toBe(false)
    expect(isNumericCond(TEMP, plain)).toBe(false)
    const declared = numericConds([TEMP])
    expect(isNumericCond(TEMP, declared)).toBe(true)
    expect(isNumericCond(BATCH, declared)).toBe(false)
  })
  it('a result from before declarations reads as dose and time only', () => {
    expect([...numericOf({})].sort()).toEqual(['dose', 'time'])
    expect([...numericOf(undefined)].sort()).toEqual(['dose', 'time'])
  })
})

describe('ingest', () => {
  it('lists the declared numeric custom conditions on Clean data — only those', () => {
    expect(std(['temp']).numericConditions).toEqual([TEMP])
    expect(std().numericConditions).toBeUndefined()
    // a numeric-looking condition left categorical stays so: declared, never inferred
    expect(std(['temp']).numericConditions).not.toContain(BATCH)
  })
  it('a declared numeric condition must hold numbers', () => {
    const bad = SHEET.replace('DMSO,37,', 'DMSO,hot,')
    expect(() => std(['temp'], bad)).toThrow(/temp/)
    // categorical, any label goes
    expect(() => std([], bad)).not.toThrow()
  })
  it('a merge keeps it numeric; a filter keeps it while it is still active', () => {
    const a = std(['temp'])
    const merged = combineStandardize([a, std()])
    expect(merged.numericConditions).toEqual([TEMP])
    const kept = subsetStandardize(a, { cmpd: ['DrugA'] })
    expect(kept.numericConditions).toEqual([TEMP])
  })
})

describe('downstream, a declared numeric condition is ordered like dose', () => {
  const declared = std(['temp'])

  it('its levels sort by number', () => {
    expect(conditionLevels(declared)[TEMP]).toEqual(TEMPS)
    // below zero, natural (text) order and number order part: −10 < −5, but "-5" before "-10"
    const cold = {
      ...declared,
      samples: [
        { ...declared.samples![0], extra: { temp: '-5', batch: '1' } },
        { ...declared.samples![1], extra: { temp: '-10', batch: '1' } }
      ]
    }
    expect(conditionLevels(cold)[TEMP]).toEqual(['-10', '-5'])
    expect(conditionLevels({ ...cold, numericConditions: undefined })[TEMP]).toEqual(['-5', '-10'])
  })
  it('facets order it numerically; a categorical one by code point', () => {
    const row = (v: string) => ({ cmp_cond: 'cmpd', extra: { temp: v } })
    const rows = [row('10'), row('9.5'), row('100')]
    const asNum = facetCompareRows(rows, [TEMP], numericConds([TEMP]))
    expect(asNum.map((g) => g.values[0].value)).toEqual(['9.5', '10', '100'])
    const asCat = facetCompareRows(rows, [TEMP], numericConds())
    expect(asCat.map((g) => g.values[0].value)).toEqual(['10', '100', '9.5'])
  })
  it('the data shape counts it as a numeric axis a curve can run over', () => {
    const shape = dataShape(declared)
    expect(shape.numeric).toEqual([TEMP])
    expect(shape.treated[TEMP]).toBe(5)
    // replicates aside, a curve fit has an axis now; categorical, it would have none
    expect(analysisUnmet(shape, 'curve_fit')).toBeNull()
    expect(analysisUnmet(dataShape(std()), 'curve_fit')).toMatch(/numeric condition/)
  })
  it('a curve baseline names its level', () => {
    const r = (cmpd: string, temp: string): StandardRow =>
      ({ cmpd, extra: { temp } }) as unknown as StandardRow
    expect(
      baselineText([r('DMSO', '37')], [r('A', '41'), r('A', '44')], numericConds([TEMP]))
    ).toBe('DMSO · temp 37')
    expect(baselineText([r('DMSO', '37')], [r('A', '41'), r('A', '44')], numericConds())).toBe(
      'DMSO'
    )
  })
})

describe('the interactive import, end to end', () => {
  it('a condition switched to num at import reaches Clean data numeric; its curve fits over it', () => {
    // a matrix of 6 samples: the vehicle and DrugA at three temperatures; temp declared numeric
    const matrix = ['id,v1,v2,v3,a1,a2,a3', 'g1,10,10,10,10,20,40', 'g2,5,5,5,5,5,5'].join('\n')
    const cond = (sample: string, cmpd: string, temp: string): InteractiveSampleCond => ({
      sample,
      cell: '',
      cmpd,
      dose: '',
      time: '',
      rep: '',
      extra: { temp }
    })
    const adapted = buildStandardInputs(matrix, {
      roles: Object.fromEntries([
        ['id', 'id'],
        ...['v1', 'v2', 'v3', 'a1', 'a2', 'a3'].map((s) => [s, 'sample'])
      ]),
      conditions: {
        v1: cond('v1', 'DMSO', '37'),
        v2: cond('v2', 'DMSO', '44'),
        v3: cond('v3', 'DMSO', '51'),
        a1: cond('a1', 'DrugA', '37'),
        a2: cond('a2', 'DrugA', '44'),
        a3: cond('a3', 'DrugA', '51')
      },
      customConditions: ['temp']
    })
    const clean = standardize({
      ...adapted,
      customConditions: ['temp'],
      numericConditions: ['temp']
    })
    expect(clean.activeConditions).toContain(TEMP)
    expect(clean.numericConditions).toEqual([TEMP])
    expect(dataShape(clean).numeric).toEqual([TEMP])
    expect(conditionLevels(clean)[TEMP]).toEqual(['37', '44', '51'])
  })
})
