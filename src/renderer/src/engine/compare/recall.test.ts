import { describe, expect, it } from 'vitest'

import { classifyCompareRow } from '../curves/curveFit'
import { attachLazyRows } from '../columns/lazyRows'
import { recallTable } from './recall'
import { thresholdLabel, type ThresholdConfig } from '../stats/stats'
import { decodeTable, encodeTable } from '../columns/wire'

/** Compare rows with what a call reads, and the ways it can be missing (null / NaN / absent). */
function cmpRows(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => {
    const r: Record<string, unknown> = {
      uniqID: `g${i % 401}`,
      comparison: i % 3 ? 'A | B' : 'C | B',
      log2FC: i % 37 === 0 ? null : i % 41 === 0 ? NaN : ((i * 7919) % 1000) / 100 - 5,
      pP: i % 29 === 0 ? null : ((i * 104729) % 700) / 100,
      pQ: i % 31 === 0 ? null : ((i * 1299709) % 500) / 100,
      thrsh: 'old',
      signf: false,
      effect: 'none',
      extra: i % 4 ? { temp: `${37 + (i % 3)}` } : null
    }
    if (i % 53 === 0) delete r.pQ
    return r
  })
}

const base: ThresholdConfig = {
  type: 'linear',
  fcLow: -1,
  fcHigh: 1,
  statMin: 1.3,
  b: 0,
  s0: 0,
  statType: 'pQ'
}

/** What re-calling each row gives (shared.ts reclassify's rows path). */
function want(rows: Record<string, unknown>[], t: ThresholdConfig, hidden: Set<string>) {
  return rows.map((r) => {
    const cls = classifyCompareRow(r as never, t)
    const signf = cls.signf && !hidden.has(r.uniqID as string)
    return { ...r, thrsh: thresholdLabel(t), signf, effect: signf ? cls.effect : 'none' }
  })
}

describe('recallTable', () => {
  const rows = cmpRows(3000)
  const holder = { comparisons: ['A | B'] } as { rows: Record<string, unknown>[] }
  attachLazyRows(holder, encodeTable(rows, []))

  it("gives each row's call, the rest of the table untouched", () => {
    for (const t of [
      base,
      { ...base, statType: 'pP' as const, statMin: 2 },
      { ...base, type: 'non-linear' as const, s0: 0.5, b: 1 },
      { ...base, type: 'sam_fdr' as const, statMin: 1 }
    ])
      for (const hidden of [new Set<string>(), new Set(['g3', 'g40'])]) {
        const tab = recallTable(holder, t, hidden)
        expect(tab).not.toBeNull()
        expect(decodeTable(tab!)).toEqual(want(rows, t, hidden))
      }
  })

  it('leaves curve fits, CurveCurator and plain rows to the rows path', () => {
    expect(recallTable({ rows }, base, new Set())).toBeNull()
    expect(recallTable(holder, { ...base, type: 'curvecurator' }, new Set())).toBeNull()
    const curves = {} as { rows: Record<string, unknown>[] }
    attachLazyRows(
      curves,
      encodeTable(
        rows.map((r) => ({ ...r, curve: { f: 1, n: 5 } })),
        []
      )
    )
    expect(recallTable(curves, base, new Set())).toBeNull()
  })
})
