/**
 * The Compare dialog's model against the engine: the config it compiles runs the comparisons it
 * describes, the three framings of one analysis read and run the same, and saved configs read back.
 */
import { describe, expect, it } from 'vitest'

import { compareSlices, previewCompare, type CompareInput, type ConditionKey, type StandardRow } from '../engine'
import {
  compareModel,
  confounded,
  controlKind,
  controlLine,
  defaultControl,
  readCompareState,
  valuesOf,
  sampleRows,
  type CompareState
} from './compareModel'

const active = ['cell', 'cmpd', 'dose', 'time']
// cmpd A, B at doses 1, 10, and a control: DMSO at dose 0 (shared) or each compound's own dose 0.
function design(own: boolean): StandardRow[] {
  const out: StandardRow[] = []
  const cmpds: Array<[string, number[]]> = own
    ? [['A', [0, 1, 10]], ['B', [0, 1, 10]]]
    : [['A', [1, 10]], ['B', [1, 10]], ['DMSO', [0]]]
  let k = 0
  for (const cell of ['M', 'W'])
    for (const time of [0, 8])
      for (const [cmpd, doses] of cmpds)
        for (const dose of doses)
          for (const rep of [1, 2])
            for (const uniqID of ['g1', 'g2'])
              out.push({ uniqID, cell, cmpd, dose, time, rep, value: 10 + (k++ % 5) })
  return out
}
const shared = design(false)
const own = design(true)

const inputOf = (rows: StandardRow[], s: CompareState): CompareInput => {
  const m = compareModel(s, sampleRows(rows, active), active)
  return { rows, activeConditions: active, num: m.num, den: m.den, match: m.match, compared: m.CMP, pool: m.pool }
}
const pairsOf = (input: CompareInput): string[] =>
  compareSlices(input)
    .slices.map(({ grp, denSlice }) => {
      const set = (rs: StandardRow[]): string => [...new Set(rs.map((r) => `${r.cell}|${r.cmpd}|${r.dose}|${r.time}`))].sort().join(',')
      return `${set(grp)} vs ${set(denSlice)}`
    })
    .sort()
const state = (s: Partial<CompareState>): CompareState => ({ cmp: {}, modes: {}, fixedVal: {}, drop: {}, ...s })

/** A condition switched to compared, as the dialog does: its control defaultControl's pick. */
const compareOn = (rows: StandardRow[], c: ConditionKey): CompareState => {
  const r = defaultControl(rows, c)
  return state({ cmp: { [c]: { r, T: valuesOf(rows, c).filter((v) => v !== r) } } })
}

describe('a fresh comparison', () => {
  it('starts with nothing compared', () => {
    const s = readCompareState({ num: {}, den: {}, match: [] }, sampleRows(shared, active), active)
    expect(s).toEqual(state({}))
    expect(compareModel(s, sampleRows(shared, active), active).CMP).toEqual([])
  })

  it('DMSO design, cmpd switched on: every compound against the vehicle, dose locked to shared, cell and time matched', () => {
    const s = compareOn(sampleRows(shared, active), 'cmpd')
    const m = compareModel(s, sampleRows(shared, active), active)
    expect(m.CMP).toEqual(['cmpd'])
    expect(m.num).toEqual({ cmpd: ['A', 'B'] })
    expect(m.den).toEqual({ cmpd: ['DMSO'] })
    expect(m.match).toEqual(['cell', 'time'])
    expect(m.ctx.find((x) => x.c === 'dose')).toMatchObject({ mode: 'fixed', matchOk: false })
    expect(controlLine(m)).toBe('shared DMSO control for every cmpd at every dose, per cell per time')
    expect(controlKind(m)).toBe('info')
  })

  it('own-dose-0 design, dose switched on: compared against each compound’s own dose 0', () => {
    const s = compareOn(sampleRows(own, active), 'dose')
    const m = compareModel(s, sampleRows(own, active), active)
    expect(m.CMP).toEqual(['dose'])
    expect(controlLine(m)).toBe('dose 0 of each cmpd for every cmpd, per cell per time')
    expect(previewCompare(inputOf(own, s)).warnings).toEqual([])
  })
})

describe('one analysis, three framings', () => {
  const rows = sampleRows(shared, active)
  const A = state({ cmp: { cmpd: { T: ['A', 'B'], r: 'DMSO' } } })
  const B = state({ cmp: { cmpd: { T: ['A', 'B'], r: 'DMSO' }, dose: { T: ['1', '10'], r: '0' } } })
  const C = state({ cmp: { dose: { T: ['1', '10'], r: '0' } } })

  it('read the same Control line, as a tip, with no confound', () => {
    const lines = [A, B, C].map((s) => compareModel(s, rows, active))
    for (const m of lines) {
      expect(controlLine(m)).toBe('shared DMSO control for every cmpd at every dose, per cell per time')
      expect(controlKind(m)).toBe('info')
      expect(confounded(m, rows)).toBeNull()
    }
  })

  it('run the same comparisons in the engine', () => {
    const a = pairsOf(inputOf(shared, A))
    expect(a).toHaveLength(16)
    expect(pairsOf(inputOf(shared, B))).toEqual(a)
    expect(pairsOf(inputOf(shared, C))).toEqual(a)
  })
})

describe('context modes and values left out compile to what runs', () => {
  const base = { cmp: { cmpd: { T: ['A', 'B'], r: 'DMSO' } } }

  it('time shared at 0 with 0 left out: every comparison is a time-8 group against DMSO at time 0', () => {
    const s = state({ ...base, modes: { time: 'fixed' }, fixedVal: { time: '0' }, drop: { time: ['0'] } })
    const m = compareModel(s, sampleRows(shared, active), active)
    expect(m.num.time).toEqual(['8'])
    expect(m.den.time).toEqual(['0'])
    expect(controlKind(m)).toBe('warn') // shared by choice
    const input = inputOf(shared, s)
    expect(previewCompare(input).warnings).toEqual([])
    for (const p of pairsOf(input)) expect(p).toMatch(/^[^ ]*\|8 vs [MW]\|DMSO\|0\|0$/)
  })

  it('cell pooled with cell W left out: both sides at cell M only, not split or matched by cell', () => {
    const s = state({ ...base, modes: { cell: 'pool' }, drop: { cell: ['W'] } })
    const m = compareModel(s, sampleRows(shared, active), active)
    expect(m.pool).toEqual(['cell'])
    expect(m.num.cell).toEqual(['M'])
    expect(m.den.cell).toEqual(['M'])
    expect(controlLine(m)).toBe('shared DMSO control for every cmpd at every dose, with cells pooled, per time')
    expect(previewCompare(inputOf(shared, s)).matched).toEqual(['time'])
  })

  it('matched with a value left out runs on the kept values only', () => {
    const s = state({ ...base, drop: { time: ['0'] } })
    const p = pairsOf(inputOf(shared, s))
    expect(p).toHaveLength(8)
    for (const x of p) expect(x).toMatch(/\|8 vs .*\|8$/)
  })
})

describe('several compared conditions', () => {
  it('cmpd and cell, where DMSO exists at cell W too, is confounded', () => {
    const rows = sampleRows(shared, active)
    const m = compareModel(state({ cmp: { cmpd: { T: ['A'], r: 'DMSO' }, cell: { T: ['W'], r: 'M' } } }), rows, active)
    expect(confounded(m, rows)).toEqual({ conds: ['cell', 'cmpd'], example: 'cell W · DMSO' })
  })
})

describe('saved configs read back', () => {
  const rows = sampleRows(shared, active)

  it('a config the dialog wrote reads back to the same config', () => {
    const s = state({
      cmp: { cmpd: { T: ['A'], r: 'DMSO' } },
      modes: { cell: 'pool', time: 'fixed' },
      fixedVal: { time: '0' },
      drop: { cell: ['W'], time: ['0'] }
    })
    const m = compareModel(s, rows, active)
    const back = compareModel(readCompareState({ num: m.num, den: m.den, match: m.match, compared: m.CMP, pool: m.pool }, rows, active), rows, active)
    expect([back.num, back.den, back.match, back.pool, back.CMP]).toEqual([m.num, m.den, m.match, m.pool, m.CMP])
  })

  it('a config saved before (no compared/pool) reads as it ran: cmpd inferred, dose locked shared, an unmatched time pooled', () => {
    const s = readCompareState({ num: { cmpd: ['A'] }, den: { cmpd: ['DMSO'] }, match: ['cell'] }, rows, active)
    expect(Object.keys(s.cmp)).toEqual(['cmpd'])
    expect(s.modes).toEqual({ cell: 'match', dose: 'fixed', time: 'pool' })
  })
})
