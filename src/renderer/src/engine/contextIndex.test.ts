import { describe, expect, it } from 'vitest'

import { contextIndices, contextOf, contrastYRangeOf, rowsOfContexts } from './contextIndex'
import {
  abundanceOnScale,
  contrastYRange,
  rowsOfFeature,
  type ContrastResultRow
} from './contrast'
import { attachLazyRows, rowsAt } from './lazyRows'
import { facetDims, type ContextRow } from './plotData'
import { numericConds } from './types'
import { decodeTable, encodeTable, rowDecoder } from './wire'
import { resolveFacets } from '../dashboard/facet'

type Obj = Record<string, unknown>

/** Structure and shared references (as wire.test's fingerprint): same string ⇔ same shape. */
function fingerprint(v: unknown): string {
  const ids = new Map<object, number>()
  const walk = (x: unknown): string => {
    if (x === undefined) return 'u'
    if (x === null) return 'n'
    if (typeof x !== 'object') return `${typeof x}:${String(x)}`
    const seen = ids.get(x)
    if (seen !== undefined) return `@${seen}`
    ids.set(x, ids.size)
    if (Array.isArray(x)) return `[${x.map(walk).join(',')}]`
    return `{${Object.keys(x)
      .map((k) => `${k}:${walk((x as Obj)[k])}`)
      .join(',')}}`
  }
  return walk(v)
}

/** A contrast-like result: two compounds × doses × a custom condition, one-sided tuples (FC2 null)
 *  for one dose, two features, shared nested records and a long list column. */
function contrastRows(n: number): Obj[] {
  const curve = { ec50: 1.5, x: [1, 2, 3] }
  const extras = [{ strain: 'wt' }, { strain: 'ko' }]
  return Array.from({ length: n }, (_, i) => {
    const dose = [0.5, 1, 5, 10][i % 4]
    return {
      featureId: i % 2 ? 'value' : 'peak',
      feature: i % 2 ? 'logFC' : 'peak logFC',
      uniqID: `P${i % 97}`,
      cmp_cond: 'cmpd',
      comparison: i % 3 ? 'E28 | DMSO' : 'A1 | DMSO',
      cmpd: i % 3 ? 'E28' : 'A1',
      dose,
      time: null,
      extra: extras[i % 2],
      FC1: i % 7 ? -i / 3 : null,
      FC2: dose === 10 ? null : i / 5,
      cmp1: 'side A',
      cmp2: 'side B',
      ...(i % 5 === 0 ? { curve } : {}),
      cells: Array.from({ length: 6 }, (_, j) => ({ d: j, v: i + j }))
    }
  })
}

function lazyHolder(rows: Obj[]): { rows: Obj[] } {
  const holder: Obj = {}
  attachLazyRows(holder, encodeTable(rows, []))
  return holder as { rows: Obj[] }
}

describe('rowDecoder', () => {
  it('builds each row as decodeTable does, nested records shared', () => {
    const t = encodeTable(contrastRows(500), [])
    const dec = rowDecoder(t)
    const one = Array.from({ length: t.n }, (_, r) => dec(r))
    expect(fingerprint(one)).toBe(fingerprint(decodeTable(t)))
  })
})

describe('rowsAt', () => {
  it('hands out the same objects as the full rows, whichever is read first', () => {
    const src = contrastRows(3000)
    const a = lazyHolder(src)
    const some = rowsAt(a, [3, 10, 2999])
    const all = a.rows
    expect(some[0]).toBe(all[3])
    expect(some[2]).toBe(all[2999])
    const b = lazyHolder(src)
    const all2 = b.rows
    expect(rowsAt(b, [7])[0]).toBe(all2[7])
    expect(fingerprint(all)).toBe(fingerprint(decodeTable(encodeTable(src, []), true)))
  })

  it('picks from a plain rows array', () => {
    const rows = contrastRows(10)
    expect(rowsAt({ rows }, [1, 4])).toEqual([rows[1], rows[4]])
  })
})

describe('contextOf', () => {
  const numeric = numericConds([])
  const check = (holder: { rows: Obj[] }): void => {
    const full = holder.rows as unknown as ContextRow[]
    const ix = contextOf(holder as unknown as { rows: ContextRow[] })
    expect(ix.rows.length).toBeLessThan(full.length)
    // the same switchers, over the tuples as over every row
    const dims = facetDims(full)
    expect(facetDims(ix.rows)).toEqual(dims)
    for (const sel of [{}, { cmpd: 'A1', dose: '10' }, { feature: 'peak logFC', dose: '5' }]) {
      const want = resolveFacets(full, dims, sel, numeric)
      const got = resolveFacets(ix.rows, dims, sel, numeric)
      expect(got.bars).toEqual(want.bars)
      expect(got.key).toBe(want.key)
      // and the facet's own rows: the same objects, in the same order
      const rows = rowsOfContexts(holder as unknown as { rows: ContextRow[] }, ix, got.rows)
      expect(rows.length).toBe(want.rows.length)
      rows.forEach((r, i) => expect(r).toBe(want.rows[i]))
    }
    expect(contextIndices(ix, ix.rows).length).toBe(full.length)
  }

  it('resolves facets as the rows do (columnar result)', () => check(lazyHolder(contrastRows(4000))))
  it('resolves facets as the rows do (plain rows)', () => check({ rows: contrastRows(300) }))

  it('keeps compare rows without contrast sides unpaired-free', () => {
    const rows = contrastRows(300).map((r) => {
      const out = { ...r }
      delete out.FC1
      delete out.FC2
      return out
    })
    check({ rows })
    const ix = contextOf({ rows: rows as unknown as ContextRow[] })
    expect(ix.rows.every((c) => !('FC1' in c))).toBe(true)
  })
})

describe('contrastYRangeOf', () => {
  const sides = (n: number): Obj[] =>
    contrastRows(n).map((r, i) => ({
      ...r,
      FC1err: i % 4 ? 0.2 + (i % 3) / 10 : null,
      FC2err: i % 6 ? 0.1 : undefined,
      FC1reps: i % 3 ? [-(i % 50) / 7, 1 + (i % 9)] : undefined,
      FC2reps: i % 2 ? [(i % 40) / 3] : undefined,
      FCdiff: 0
    }))
  it('matches the range over the rows, on every scale and feature', () => {
    const src = sides(4000)
    const lazy = lazyHolder(src) as unknown as { rows: ContrastResultRow[] }
    const plain = src as unknown as ContrastResultRow[]
    for (const like of [undefined, { featureId: 'value' }, { featureId: 'peak' }])
      for (const scale of [undefined, 'log10', 'log2', 'linear'] as const)
        for (const [errors, points] of [
          [true, true],
          [false, true],
          [true, false],
          [false, false]
        ] as const) {
          const want = contrastYRange(
            rowsOfFeature(scale ? abundanceOnScale(plain, scale) : plain, like as ContrastResultRow),
            errors,
            points
          )
          expect(contrastYRangeOf(lazy, like, scale, errors, points)).toEqual(want)
          expect(contrastYRangeOf({ rows: plain }, like, scale, errors, points)).toEqual(want)
        }
  })
})

describe('nested record fields (curve.axis, rs.axis)', () => {
  const curveRows = (n: number): Obj[] =>
    Array.from({ length: n }, (_, i) => ({
      uniqID: `P${i % 50}`,
      cmp_cond: 'dose',
      comparison: 'E28 | DMSO',
      cmpd: 'E28',
      time: [10, 60][i % 2],
      ...(i % 4 === 0 ? { curve: { axis: 'dose', ec50: i, x: [1, 2, 3] } } : {}),
      ...(i % 4 === 1 ? { rs: { axis: i % 8 === 1 ? 'surface' : 'time', cells: [{ y: i }] } } : {}),
      ...(i % 4 === 2 ? { curve: null } : {})
    }))
  it('reads the same along and response-fit answers off the columns', async () => {
    const { someNested } = await import('./rowView')
    const src = curveRows(3000)
    const lazy = lazyHolder(src) as unknown as { rows: ContextRow[] }
    const plain = { rows: src as unknown as ContextRow[] }
    const along = (h: { rows: ContextRow[] }): string =>
      contextOf(h)
        .rows.map((c) => `${c.time}:${c.along ?? '-'}`)
        .join(',')
    expect(along(lazy)).toBe(along(plain))
    for (const test of [
      (p: boolean, a: unknown) => p && a !== 'surface',
      (p: boolean, a: unknown) => p && a === 'surface',
      (p: boolean) => p
    ])
      for (const key of ['rs', 'curve', 'nothing'])
        expect(someNested(lazy, key, 'axis', test)).toBe(someNested(plain, key, 'axis', test))
  })
})
