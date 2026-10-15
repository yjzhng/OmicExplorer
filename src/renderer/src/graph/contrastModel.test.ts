/**
 * The Contrast dialog's model against the engine: what it compiles is what the engine pairs, and
 * nothing it compiles leaves a condition pooled (runContrastPair's rule).
 */
import { describe, expect, it } from 'vitest'

import { previewContrastPair, type ContrastSideRow, type StandardRow } from '../engine'
import { sampleRows } from './compareModel'
import {
  compileInter,
  compileIntra,
  contrastLine,
  contrastModel,
  defaultIntra,
  readInter,
  readIntra,
  type ContrastState
} from './contrastModel'

const conds = ['cell', 'cmpd', 'dose', 'time']
// A Compare's result rows: cmpd A, B at doses 1, 10, × cell M, W × time 8, 24; two genes.
function results(doses = [1, 10]): StandardRow[] {
  const out: StandardRow[] = []
  for (const cell of ['M', 'W'])
    for (const time of [8, 24])
      for (const cmpd of ['A', 'B'])
        for (const dose of doses)
          for (const uniqID of ['g1', 'g2']) out.push({ uniqID, cell, cmpd, dose, time, rep: 1, value: 1 })
  return out
}
const rows = results()
const side = (rs: StandardRow[]): ContrastSideRow[] => rs.map((r) => ({ ...r, value: r.value }))
const matchesSel = (r: StandardRow, sel: Record<string, string[] | undefined>): boolean =>
  Object.entries(sel).every(([c, vs]) => !vs?.length || vs.includes(String((r as unknown as Record<string, unknown>)[c])))

describe('intra-dataset', () => {
  it('opens with every condition matched and cmpd contrasted: one contrast per cell × dose × time', () => {
    const s = defaultIntra(rows, conds)
    const m = contrastModel(s, sampleRows(rows, conds), sampleRows(rows, conds), conds)
    expect(m.keys).toHaveLength(2 * 2 * 2)
    expect(contrastLine(m)).toBe('A vs B, per cell per dose per time')
    const c = compileIntra(m)
    expect(c).toEqual({ num: { cmpd: ['A'] }, den: { cmpd: ['B'] }, match: ['cell', 'dose', 'time'] })
    // what the engine pairs: the selected sides, aligned on the match — the same contrasts, nothing pooled
    const p = previewContrastPair(side(rows.filter((r) => matchesSel(r, c.num))), side(rows.filter((r) => matchesSel(r, c.den))), c.match)
    expect(p.unpinned).toEqual([])
    expect(p.groups).toBe(m.keys.length)
  })

  it('every condition contrasted: one arbitrary slice against another, one contrast', () => {
    const s: ContrastState = {
      cmode: { cell: 'slice', cmpd: 'slice', dose: 'slice', time: 'slice' },
      sl: { cell: { a: 'M', b: 'W' }, cmpd: { a: 'A', b: 'B' }, dose: { a: '1', b: '10' }, time: { a: '8', b: '24' } },
      drop: {}
    }
    const m = contrastModel(s, sampleRows(rows, conds), sampleRows(rows, conds), conds)
    expect(m.keys).toHaveLength(1)
    expect(contrastLine(m)).toBe('M · A · 1 · 8 vs W · B · 10 · 24')
    const c = compileIntra(m)
    const p = previewContrastPair(side(rows.filter((r) => matchesSel(r, c.num))), side(rows.filter((r) => matchesSel(r, c.den))), c.match)
    expect(p.unpinned).toEqual([])
    expect(p.groups).toBe(1)
  })

  it('a matched value left out pins the kept values on both sides', () => {
    const s: ContrastState = { cmode: { cmpd: 'slice' }, sl: { cmpd: { a: 'A', b: 'B' } }, drop: { time: ['8'] } }
    const m = contrastModel(s, sampleRows(rows, conds), sampleRows(rows, conds), conds)
    expect(m.keys).toHaveLength(4)
    expect(compileIntra(m).num.time).toEqual(['24'])
  })

  it('the same value on both sides is flagged', () => {
    const s: ContrastState = { cmode: { cmpd: 'slice' }, sl: { cmpd: { a: 'A', b: 'A' } }, drop: {} }
    const m = contrastModel(s, sampleRows(rows, conds), sampleRows(rows, conds), conds)
    expect(m.differs).toBe(false)
    expect(contrastLine(m)).toBe('condition identical on both sides. Select different conditions.')
  })

  it('a config it wrote reads back to the same config', () => {
    const s: ContrastState = { cmode: { cmpd: 'slice', cell: 'slice' }, sl: { cmpd: { a: 'A', b: 'B' }, cell: { a: 'M', b: 'M' } }, drop: { dose: ['10'] } }
    const R = sampleRows(rows, conds)
    const c = compileIntra(contrastModel(s, R, R, conds))
    expect(compileIntra(contrastModel(readIntra(c, R, conds), R, R, conds))).toEqual(c)
  })
})

describe('inter-dataset', () => {
  const RB = results([1]) // experiment 2: no dose 10
  it('opens with every condition matched; a value only one dataset has drops out', () => {
    const m = contrastModel({ cmode: {}, sl: {}, drop: {} }, sampleRows(rows, conds), sampleRows(RB, conds), conds)
    expect(m.keys).toHaveLength(2 * 2 * 2 * 1)
    const c = compileInter(m)
    const p = previewContrastPair(side(rows), side(RB), c.match, { a: 'A', b: 'B' }, c.pairFix)
    expect(p.unpinned).toEqual([])
    expect(p.groups).toBe(m.keys.length)
  })

  it('time contrasted 8 vs 24, a matched cell left out: what the engine pairs, and it reads back', () => {
    const s: ContrastState = { cmode: { time: 'slice' }, sl: { time: { a: '8', b: '24' } }, drop: { cell: ['W'] } }
    const RA = sampleRows(rows, conds), R2 = sampleRows(RB, conds)
    const m = contrastModel(s, RA, R2, conds)
    const c = compileInter(m)
    expect(c.pairFix).toEqual({ a: { cell: ['M'], time: '8' }, b: { cell: ['M'], time: '24' } })
    const p = previewContrastPair(side(rows), side(RB), c.match, { a: 'A', b: 'B' }, c.pairFix)
    expect(p.unpinned).toEqual([])
    expect(p.groups).toBe(m.keys.length)
    expect(compileInter(contrastModel(readInter(c, RA, R2, conds), RA, R2, conds))).toEqual(c)
  })
})
