import { describe, expect, it } from 'vitest'

import { holderTable } from '../engine/lazyRows'
import { packResults, unpackResults } from './resultPack'
import type { NodeResult } from './types'

/** A large result table touching every packed column kind: constants (number, string, null,
 *  object), strings with nulls, numbers and booleans with nulls, nested records (some rows
 *  without), lists of records (a surface's cells), raw arrays, and fields some rows lack. */
function bigResult(n: number): NodeResult {
  const shared = { unit: 'nM' }
  const rows = Array.from({ length: n }, (_, i) => {
    const r: Record<string, unknown> = {
      uniqID: `g${i % 997}`,
      cmpd: i % 5 === 0 ? null : `c${i % 3}`,
      dose: i % 11 === 0 ? null : (i % 8) * 2.5,
      signf: i % 13 === 0 ? null : i % 2 === 0,
      thrsh: 'linear',
      fcSE: null,
      meta: shared,
      extra: i % 4 === 0 ? null : { temp: `${40 + (i % 3)}`, type: 'lysate' },
      rs:
        i % 6 === 0
          ? null
          : {
              axis: 'surface',
              F: i / 7,
              cells: Array.from({ length: 5 }, (_, c) => ({ dose: c, time: i % 4, y: i - c })),
              maps: [{ zeroX: 2 }, { step: 3.1 }]
            },
      tags: i % 9 === 0 ? ['a', 1] : null
    }
    if (i % 17 === 0) delete r.dose
    return r
  })
  return { kind: 'compare', cmp: { rows, comparisons: ['A | B'] } } as unknown as NodeResult
}

/** JSON with every object's keys sorted: the file keeps a row's fields, not their order (a row's
 *  keys come back in the order their columns were first seen, lazy or not). */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x
  )

describe('packed results unpacked as lazy tables', () => {
  it('reads exactly as the file holds them, rows built only when read', () => {
    const results = { s: bigResult(3000), small: bigResult(50) }
    const file = JSON.parse(JSON.stringify(packResults(results)))
    const want = JSON.parse(JSON.stringify(results))
    const got = unpackResults(file)
    const cmp = (got.s as { cmp: object }).cmp
    // large: columnar until read; small: plain rows as before
    expect(holderTable(cmp)?.n).toBe(3000)
    expect(holderTable((got.small as { cmp: object }).cmp)).toBeUndefined()
    expect(canon(got)).toBe(canon(want))
  })
})
