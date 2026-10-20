/**
 * Stated comparisons: the Compare dialog names its compared conditions (`compared`) and the ones it
 * pools (`pool`), instead of the engine inferring them from the pins. Checks that
 *   • the three framings of one analysis (cmpd compared with dose shared, cmpd + dose compared, dose
 *     compared) run the same comparisons,
 *   • a shared condition with values left out isn't mistaken for a second compared condition,
 *   • a pooled condition merges both sides (and overrides "picked alike ⇒ matched"),
 *   • several stated compared conditions run, where an inferred second one is still an error.
 */
import { describe, expect, it } from 'vitest'

import { classifyConditions, compareSlices, previewCompare } from './direct'
import type { CompareInput, StandardRow } from './types'

// cmpd A, B at doses 1, 10; DMSO only at dose 0 — × cell M, W × time 0, 8; two replicates, two genes.
const rows: StandardRow[] = []
let k = 0
for (const cell of ['M', 'W'])
  for (const time of [0, 8])
    for (const [cmpd, doses] of [
      ['A', [1, 10]],
      ['B', [1, 10]],
      ['DMSO', [0]]
    ] as const)
      for (const dose of doses)
        for (const rep of [1, 2])
          for (const uniqID of ['g1', 'g2'])
            rows.push({ uniqID, cell, cmpd, dose, time, rep, value: 10 + (k++ % 7) })
const active = ['cell', 'cmpd', 'dose', 'time'] as const
const base = { rows, activeConditions: [...active], numericConditions: [] }

// A comparison as what runs: each numerator group's samples against its denominator slice's.
const sample = (r: StandardRow): string => `${r.cell}|${r.cmpd}|${r.dose}|${r.time}`
const pairsOf = (input: CompareInput): string[] =>
  compareSlices(input)
    .slices.map(({ grp, denSlice }) => {
      const set = (rs: StandardRow[]): string => [...new Set(rs.map(sample))].sort().join(',')
      return `${set(grp)} vs ${set(denSlice)}`
    })
    .sort()

describe('stated compared conditions: one analysis, three framings', () => {
  const A: CompareInput = {
    ...base,
    num: { cmpd: ['A', 'B'] },
    den: { cmpd: ['DMSO'] },
    match: ['cell', 'time'],
    compared: ['cmpd']
  }
  const B: CompareInput = {
    ...base,
    num: { cmpd: ['A', 'B'], dose: ['1', '10'] },
    den: { cmpd: ['DMSO'], dose: ['0'] },
    match: ['cell', 'time'],
    compared: ['cmpd', 'dose']
  }
  const C: CompareInput = {
    ...base,
    num: { dose: ['1', '10'] },
    den: { dose: ['0'] },
    match: ['cell', 'time'],
    compared: ['dose']
  }

  it('cmpd compared with dose shared runs every compound × dose against DMSO at dose 0, per cell and time', () => {
    const p = pairsOf(A)
    expect(p).toHaveLength(2 * 2 * 2 * 2) // cmpd × dose × cell × time
    for (const s of p) expect(s.split(' vs ')[1]).toMatch(/^[MW]\|DMSO\|0\|[08]$/)
  })

  it('cmpd + dose compared runs the same comparisons (dose is forced to DMSO’s one value)', () => {
    expect(pairsOf(B)).toEqual(pairsOf(A))
    expect(classifyConditions(rows, B.num, B.den, B.activeConditions, B.compared)).toEqual({
      axis: ['cmpd'],
      invariant: ['dose']
    })
  })

  it('dose compared alone runs the same comparisons (cmpd is forced to DMSO at dose 0)', () => {
    expect(pairsOf(C)).toEqual(pairsOf(A))
    expect(previewCompare(C).warnings).toEqual([])
  })
})

describe('a shared condition with values left out is not compared', () => {
  // time shared at 0 (the control's time), with the curves' 0 left out: the sides pin different times.
  const pins = {
    num: { cmpd: ['A'], time: ['8'] },
    den: { cmpd: ['DMSO'], time: ['0'] },
    match: ['cell'] as const
  }

  it('inferred from the pins (configs saved before), time reads as a second compared condition', () => {
    expect(
      previewCompare({ ...base, ...pins, match: [...pins.match] }).warnings.some((w) =>
        w.includes('one condition')
      )
    ).toBe(true)
  })

  it('stated, cmpd is the one compared condition and every slice sits at the control’s time 0', () => {
    const input: CompareInput = { ...base, ...pins, match: [...pins.match], compared: ['cmpd'] }
    expect(previewCompare(input).warnings).toEqual([])
    const p = pairsOf(input)
    expect(p.length).toBeGreaterThan(0)
    for (const s of p) {
      const [test, ctrl] = s.split(' vs ')
      expect(test).toMatch(/\|8$/)
      expect(ctrl).toMatch(/\|DMSO\|0\|0$/)
    }
  })
})

describe('pooled conditions merge both sides', () => {
  it('cell and time pooled: one group per dose, each side spanning both cells and both times', () => {
    const input: CompareInput = {
      ...base,
      num: { cmpd: ['A'] },
      den: { cmpd: ['DMSO'] },
      match: [],
      compared: ['cmpd'],
      pool: ['cell', 'time']
    }
    const { slices } = compareSlices(input)
    expect(slices).toHaveLength(2) // dose 1, dose 10
    for (const { grp, denSlice } of slices) {
      expect(new Set(grp.map((r) => r.cell)).size).toBe(2)
      expect(new Set(grp.map((r) => r.time)).size).toBe(2)
      expect(new Set(denSlice.map((r) => r.time)).size).toBe(2)
    }
  })

  it('a pooled condition picked alike on both sides (values left out) is still not matched', () => {
    const input: CompareInput = {
      ...base,
      num: { cmpd: ['A'], cell: ['M', 'W'] },
      den: { cmpd: ['DMSO'], cell: ['M', 'W'] },
      match: ['time'],
      compared: ['cmpd'],
      pool: ['cell']
    }
    for (const { grp, denSlice } of compareSlices(input).slices) {
      expect(new Set(grp.map((r) => r.cell)).size).toBe(2)
      expect(new Set(denSlice.map((r) => r.cell)).size).toBe(2)
    }
    expect(previewCompare(input).matched).toEqual(['time'])
  })
})

describe('several compared conditions', () => {
  const pins = {
    num: { cmpd: ['A'], cell: ['W'] },
    den: { cmpd: ['DMSO'], cell: ['M'] },
    match: ['time'] as const
  }

  it('stated, cmpd and cell together run cmpd A at cell W against DMSO at cell M', () => {
    const input: CompareInput = {
      ...base,
      ...pins,
      match: [...pins.match],
      compared: ['cell', 'cmpd']
    }
    const prev = previewCompare(input)
    expect(prev.warnings).toEqual([])
    expect(prev.groups).toBe(2 * 2) // dose × time
    for (const s of pairsOf(input)) expect(s).toMatch(/^W\|A\|\d+\|\d vs M\|DMSO\|0\|\d$/)
  })

  it('inferred from the pins, a second differing condition is still a configuration error', () => {
    expect(
      previewCompare({ ...base, ...pins, match: [...pins.match] }).warnings.some((w) =>
        w.includes('one condition')
      )
    ).toBe(true)
  })
})
