import { describe, expect, it } from 'vitest'

import { hasTermRows, holderWhere } from './contextIndex'
import { stdByGene } from './curvePoints'
import { attachLazyRows, holderTable } from './lazyRows'
import { stdLookupOf } from './sampleIndex'
import { showKindOf } from './plotData'
import type { StandardRow } from './types'
import { decodeTable, encodeTable, subTable, type Table } from './wire'

type Obj = Record<string, unknown>

/** A two-way-ANOVA-like Compare: term rows among signed ones, shared nested records, null and
 *  odd-typed values (T_NULL / T_OTHER tags), a long list column and optional keys. */
function compareRows(n: number): Obj[] {
  const curve = { axis: 'dose', ec50: 1.5, x: [1, 2, 3] }
  return Array.from({ length: n }, (_, i) => ({
    uniqID: `P${i % 53}`,
    cmp_cond: i % 4 === 0 ? 'cmpd' : 'cmpd:time',
    comparison: i % 4 === 0 ? 'cmpd' : `E${i % 3} | DMSO`,
    cmpd: `E${i % 3}`,
    dose: i % 7 ? i % 5 : null,
    time: i % 11 === 0 ? 'late' : 6,
    log2FC: i % 9 ? i / 10 : null,
    ...(i % 4 === 0 ? { term: 'cmpd' } : {}),
    ...(i % 6 === 0 ? { curve } : {}),
    pts: Array.from({ length: 5 }, (_, j) => ({ d: j, v: i - j }))
  }))
}

const lazy = (rows: Obj[]): { rows: Obj[] } => {
  const h = {} as { rows: Obj[] }
  attachLazyRows(h, encodeTable(rows, []))
  return h
}

describe('subTable', () => {
  it('is the picked rows, as decodeTable gives them', () => {
    const rows = compareRows(400)
    const t = encodeTable(rows, [])
    const idx = Int32Array.from(rows.keys()).filter((i) => i % 3 !== 1)
    expect(decodeTable(subTable(t, idx))).toEqual(Array.from(idx, (i) => rows[i]))
    expect(decodeTable(subTable(t, []))).toEqual([])
  })

  it('keeps nested records shared within the slice', () => {
    const t = encodeTable(compareRows(60), [])
    const out = decodeTable(subTable(t, [0, 6, 12, 13]))
    expect(out[0].curve).toBe(out[1].curve)
    expect(out[3].curve).toBeUndefined()
  })
})

describe('holderWhere', () => {
  it('matches a filter of the rows, lazy or plain, without building them', () => {
    for (const make of [lazy, (r: Obj[]) => ({ rows: r })]) {
      const rows = compareRows(3000)
      const h = make(rows) as { rows: Obj[] }
      const signed = holderWhere(h as never, 'signed', (c) => !c.term) as { rows: Obj[] }
      if (holderTable(h)) expect(holderTable(signed)).toBeDefined()
      expect(signed.rows).toEqual(rows.filter((r) => r.term == null))
      // cached: the same holder each time
      expect(holderWhere(h as never, 'signed', (c) => !c.term)).toBe(signed)
      const factors = holderWhere(h as never, 'show¦factors', (c) => showKindOf(c) === 'factors')
      expect((factors as { rows: Obj[] }).rows).toEqual(rows.filter((r) => r.term != null))
    }
  })

  it('hands the holder back when every row passes', () => {
    const h = lazy(compareRows(2500).map((r) => ({ ...r, term: undefined })))
    expect(hasTermRows(h as never)).toBe(false)
    expect(holderWhere(h as never, 'signed', (c) => !c.term)).toBe(h)
  })

  it('keeps the holder’s other fields', () => {
    const h = lazy(compareRows(2100)) as { rows: Obj[]; comparisons?: string[] }
    h.comparisons = ['a', 'b']
    const out = holderWhere(h as never, 'signed', (c) => !c.term) as typeof h
    expect(out.comparisons).toBe(h.comparisons)
    expect(hasTermRows(h as never)).toBe(true)
  })
})

describe('stdLookupOf', () => {
  it('answers as stdByGene, building only the genes asked for', () => {
    const rows: StandardRow[] = Array.from({ length: 5000 }, (_, i) => ({
      uniqID: `G${(i * 7) % 113}`,
      cmpd: i % 2 ? 'A' : 'B',
      dose: i % 5,
      time: null,
      rep: String(i % 3),
      value: i % 13 ? i : null
    })) as unknown as StandardRow[]
    const want = stdByGene(rows)
    const h = {} as { rows: StandardRow[] }
    const t: Table = encodeTable(rows as unknown as Obj[], [])
    attachLazyRows(h as unknown as Obj, t)
    const look = stdLookupOf(h)
    for (const id of ['G0', 'G5', 'G112']) expect(look.get(id)).toEqual(want.get(id))
    expect(look.get('nope')).toBeUndefined()
    expect(stdLookupOf(h)).toBe(look)
  })
})
