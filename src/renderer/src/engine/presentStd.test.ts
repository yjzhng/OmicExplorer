import { describe, expect, it } from 'vitest'

import { attachLazyRows, holderTable } from './lazyRows'
import { presentStd } from './scale'
import type { StandardizeResult } from './types'
import { encodeTable } from './wire'

const rows = (): Record<string, unknown>[] =>
  Array.from({ length: 3000 }, (_, i) => ({
    uniqID: `P${i % 101}`,
    cell: 'WT',
    cmpd: i % 2 ? 'E28' : 'DMSO',
    dose: i % 4,
    time: null,
    rep: (i % 3) + 1,
    value: i % 17 === 0 ? null : i % 29 === 0 ? NaN : 1 + i * 3.5
  }))

function std(lazy: boolean): StandardizeResult {
  const base = { scale: 'linear', samples: [], extraField: { k: 1 } } as unknown as Record<
    string,
    unknown
  >
  if (!lazy) return { ...base, rows: rows() } as unknown as StandardizeResult
  attachLazyRows(base, encodeTable(rows(), []))
  return base as unknown as StandardizeResult
}

describe('presentStd on a columnar result', () => {
  for (const scale of ['log10', 'log2'] as const)
    it(`reads as the row-by-row rescale (${scale}), its rows still lazy`, () => {
      const lazy = presentStd(std(true), scale)
      expect(holderTable(lazy)).toBeDefined()
      const want = presentStd(std(false), scale)
      expect(lazy.scale).toBe(scale)
      expect((lazy as unknown as { extraField: unknown }).extraField).toEqual({ k: 1 })
      expect(lazy.rows).toEqual(want.rows)
      expect(lazy.rows.map((r) => Object.keys(r).join())).toEqual(
        want.rows.map((r) => Object.keys(r).join())
      )
      // cached per result and scale
      const s = std(true)
      expect(presentStd(s, scale)).toBe(presentStd(s, scale))
    })
})
