import { describe, expect, it } from 'vitest'

import { attachLazyRows } from './lazyRows'
import { decodeValue, encodeTable, encodeValue, isTable } from './wire'

/** An engine request's payload as the worker sees it: encoded by the client (call / lane), decoded
 *  by the worker before the op runs. */
const roundTrip = (payload: unknown): unknown =>
  decodeValue(structuredClone(encodeValue(payload, [])))

const rows = Array.from({ length: 3000 }, (_, i) => ({
  uniqID: `g${i}`,
  value: i % 7 ? i / 3 : null,
  ...(i % 5 ? { extra: { strain: 'ko' } } : null)
}))

describe('engine payloads go columnar', () => {
  it('a lazy result goes as its table — rows never built here — and arrives as its rows', () => {
    const std = { scale: 'log10', samples: [{ cell: 'A' }] } as Record<string, unknown>
    attachLazyRows(std, encodeTable(rows, []))
    Object.defineProperty(std, 'rows', {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('rows built')
      }
    })
    const got = roundTrip({ std, cleanupRule: { min: 2 } }) as { std: Record<string, unknown> }
    expect(got.std.rows).toEqual(rows)
    expect(got.std.scale).toBe('log10')
    expect(got.std.samples).toEqual([{ cell: 'A' }])
  })

  it('arrays of rows and everything else arrive as they were; a table stays a table', () => {
    const payload = { sideA: rows, num: { cmpd: ['x'] }, flags: [1, 2, 3], text: 'a,b\n1,2' }
    expect(roundTrip(payload)).toEqual(payload)
    const t = encodeTable(rows, [])
    const back = roundTrip({ rows: t }) as { rows: unknown }
    expect(isTable(back.rows)).toBe(true)
  })
})
