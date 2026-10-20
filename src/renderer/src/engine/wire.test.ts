import { describe, expect, it } from 'vitest'

import { compactRows, firstRow, holderTable, rowCount, rowsTable } from './lazyRows'
import { decodeRowAt, decodeTable, decodeValue, encodeValue } from './wire'

/** A strict structural fingerprint: key ORDER, absent vs undefined, NaN / ±Infinity / −0, and
 *  which objects are the same object (shared references) all show up in it. */
function fingerprint(v: unknown): string {
  const ids = new Map<object, number>()
  const walk = (x: unknown): string => {
    if (x === undefined) return 'u'
    if (x === null) return 'n'
    if (typeof x === 'number') return Object.is(x, -0) ? '-0' : `#${String(x)}`
    if (typeof x === 'string') return JSON.stringify(x)
    if (typeof x === 'boolean') return x ? 'T' : 'F'
    if (typeof x !== 'object') return `?${typeof x}`
    const seen = ids.get(x)
    if (seen !== undefined) return `@${seen}`
    ids.set(x, ids.size)
    if (ArrayBuffer.isView(x))
      return `${x.constructor.name}[${Array.from(x as unknown as ArrayLike<number>).join(',')}]`
    if (Array.isArray(x)) {
      const parts: string[] = []
      for (let i = 0; i < x.length; i++) parts.push(i in x ? walk(x[i]) : '<hole>')
      return `[${parts.join(',')}]`
    }
    return `{${Object.keys(x)
      .map((k) => `${JSON.stringify(k)}:${walk((x as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return walk(v)
}

/** What the receiver gets today (structured clone) vs with the wire format (encode → structured
 *  clone with the buffers transferred → decode). */
function viaWire(v: unknown): unknown {
  const transfer: Transferable[] = []
  const enc = encodeValue(v, transfer)
  return decodeValue(structuredClone(enc, { transfer }))
}
const viaClone = (v: unknown): unknown => structuredClone(v)

function expectSame(v: unknown): void {
  const before = fingerprint(v)
  const wire = viaWire(v)
  expect(fingerprint(wire)).toBe(fingerprint(viaClone(v)))
  expect(fingerprint(v)).toBe(before) // the sender's value is untouched
}

const rows = (n: number, f: (i: number) => Record<string, unknown>): Record<string, unknown>[] =>
  Array.from({ length: n }, (_, i) => f(i))

describe('wire format', () => {
  it('round-trips a result table exactly', () => {
    const curve = { ec50: 1.5, x: [1, 2, 3], rep: [1, null, 2] }
    expectSame({
      rows: rows(200, (i) => ({
        uniqID: `P${i % 37}`,
        cmpd: i % 2 ? 'E28' : 'DMSO',
        dose: i % 5 === 0 ? null : i * 0.5,
        time: i % 7 === 0 ? NaN : i % 11 === 0 ? -0 : i,
        log2FC: i % 13 === 0 ? Infinity : i % 17 === 0 ? -Infinity : -i / 3,
        signf: i % 3 === 0,
        effect: (['up', 'down', 'none'] as const)[i % 3],
        ...(i % 4 === 0 ? { fcSE: i % 8 === 0 ? undefined : 0.1 } : {}),
        ...(i % 6 === 0 ? { curve } : {}),
        extra: i % 9 === 0 ? undefined : { genotype: i % 2 ? 'wt' : 'ko' }
      })),
      comparisons: ['E28 | DMSO'],
      threshold: { p: 0.05 }
    })
  })

  it('keeps per-row key order when rows differ in shape', () => {
    expectSame(
      rows(100, (i) => (i % 2 ? { a: i, b: 'x', c: true } : { c: false, a: i, z: null, b: 'y' }))
    )
  })

  it('handles mixed-type columns, nested arrays and typed arrays', () => {
    expectSame(
      rows(120, (i) => ({
        v: i % 3 === 0 ? 'str' : i % 3 === 1 ? i : [i, { deep: i }],
        w: i % 2 ? new Float64Array([i, i + 1]) : null,
        o: i % 5 === 0 ? 7 : { n: i, s: String(i % 4) },
        b: i % 4 === 0 ? 'yes' : i % 2 === 0
      }))
    )
  })

  it('keeps shared nested records shared, and tables nested at any depth', () => {
    const shared = { k: 1 }
    expectSame({
      outer: [
        { inner: rows(70, (i) => ({ id: i, s: shared, t: i % 2 ? shared : { k: 2 } })) },
        rows(65, (i) => ({ a: i }))
      ]
    })
  })

  it('leaves small arrays, holes and look-alike objects alone', () => {
    // eslint-disable-next-line no-sparse-arrays
    const holey = [{ a: 1 }, , { a: 2 }]
    const big = rows(80, (i) => ({ a: i }))
    delete (big as unknown[])[40]
    expectSame({
      small: rows(10, (i) => ({ a: i })),
      holey,
      big,
      fake: { $wire: 1, n: 3, shapes: [], shape: [], cols: {} },
      fakeEsc: { $wireEscape: 5 }
    })
  })

  it('round-trips randomised tables', () => {
    let seed = 7
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const pick = (): unknown => {
      const r = rnd()
      if (r < 0.1) return null
      if (r < 0.15) return undefined
      if (r < 0.2) return NaN
      if (r < 0.45) return Math.round(rnd() * 1000) / 7
      if (r < 0.65) return `s${Math.floor(rnd() * 20)}`
      if (r < 0.75) return rnd() < 0.5
      if (r < 0.85) return { q: Math.floor(rnd() * 3), r: `t${Math.floor(rnd() * 3)}` }
      return [rnd() < 0.5 ? 1 : 'a']
    }
    for (let trial = 0; trial < 25; trial++) {
      const keys = ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, 2 + Math.floor(rnd() * 5))
      expectSame(
        rows(64 + Math.floor(rnd() * 200), () => {
          const o: Record<string, unknown> = {}
          for (const k of keys) if (rnd() < 0.85) o[k] = pick()
          return o
        })
      )
    }
  })
})

/** A curve-fit-like row: a surface with a list of cells and slices, and a short list of maps. */
const surfaceRow = (i: number): Record<string, unknown> => ({
  uniqID: `g${i}`,
  log2FC: i / 3,
  rs:
    i % 7 === 0
      ? null
      : {
          axis: 'surface',
          F: i * 1.5,
          maps: [{ zeroX: 2 }, { scale: 'linear', step: 3.1 }],
          cells: Array.from({ length: 6 }, (_, c) => ({ dose: c, time: c % 3, y: i - c, n: 3 })),
          surface: {
            byTime: [
              { at: 1, mid: 0.5 },
              { at: 2, mid: NaN }
            ],
            byDose: []
          }
        }
})

describe('wire format: lists and lazy tables', () => {
  it('round-trips lists of records (a surface’s cells) exactly', () => {
    expectSame(rows(300, surfaceRow))
  })

  it('a lazily decoded table reads the same as an eager one', () => {
    const src = { rows: rows(3000, surfaceRow), other: 1 }
    const enc = encodeValue(src, [])
    const lazy = decodeValue(structuredClone(enc), true) as typeof src
    expect(fingerprint(lazy.rows)).toBe(fingerprint(src.rows))
    // the same array while it's held — memoised views see no change
    expect(lazy.rows).toBe(lazy.rows)
    // a list read twice is the same array too
    const rs = lazy.rows[1].rs as { cells: unknown[] }
    expect(rs.cells).toBe(rs.cells)
    // spread and JSON see every field
    expect(JSON.stringify({ ...lazy })).toBe(JSON.stringify(src))
  })

  it('peeks without building the rows, and sends a lazy table as it is', () => {
    const src = { rows: rows(3000, surfaceRow) }
    const lazy = decodeValue(structuredClone(encodeValue(src, [])), true) as typeof src
    expect(holderTable(lazy)?.n).toBe(3000)
    expect(rowCount(lazy)).toBe(3000)
    expect(fingerprint(firstRow(lazy))).toBe(fingerprint(src.rows[0]))
    expect(fingerprint(decodeRowAt(holderTable(lazy)!, 8))).toBe(fingerprint(src.rows[8]))
    // re-sent without being decoded again: the very same table
    const again = encodeValue(lazy, []) as { rows: unknown }
    expect(again.rows).toBe(holderTable(lazy))
    // writing rows replaces the lazy view
    lazy.rows = []
    expect(lazy.rows).toEqual([])
    expect(holderTable(lazy)).toBeUndefined()
  })

  it('compacts a plain table in place, keeping the array handed out', () => {
    const holder: { rows: Record<string, unknown>[] } = { rows: rows(2500, surfaceRow) }
    const before = holder.rows
    const want = fingerprint(before)
    expect(compactRows(holder, true)).toBe(true)
    expect(holder.rows).toBe(before)
    expect(rowsTable(before)).toBe(holderTable(holder))
    // and rebuilt from the table, it's the same rows
    expect(fingerprint(decodeTable(holderTable(holder)!, true))).toBe(want)
    // too small: left as it is
    expect(compactRows({ rows: rows(10, surfaceRow) })).toBe(false)
  })
})
