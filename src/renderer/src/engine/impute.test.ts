import { describe, expect, it } from 'vitest'

import { imputeMissing } from './impute'
import type { StandardRow } from './types'

const row = (uniqID: string, rep: number, value: number | null): StandardRow => ({
  uniqID,
  cell: '',
  cmpd: 'A',
  dose: null,
  time: null,
  rep,
  value
})

/** 3 samples; g1..g4 observed everywhere except g2 in rep 2 (null) and g4 in rep 3 (no row). */
function table(): StandardRow[] {
  const out: StandardRow[] = []
  for (const g of ['g1', 'g2', 'g3', 'g4']) {
    for (const rep of [1, 2, 3]) {
      if (g === 'g4' && rep === 3) continue
      const v = g === 'g2' && rep === 2 ? null : 1000 * (1 + rep) * (1 + 'g1g2g3g4'.indexOf(g))
      out.push(row(g, rep, v))
    }
  }
  return out
}

describe('imputeMissing', () => {
  it('fills null cells and absent gene×sample combos, flagging them', () => {
    const { rows, summary } = imputeMissing(table(), { method: 'perseus' })
    expect(summary).toEqual({ method: 'perseus', imputed: 2, total: 12 })
    expect(rows).toHaveLength(12)
    const filled = rows.filter((r) => r.imputed)
    expect(filled.map((r) => `${r.uniqID}/${r.rep}`).sort()).toEqual(['g2/2', 'g4/3'])
    expect(rows.filter((r) => !r.imputed).every((r) => r.value != null)).toBe(true)
  })

  it('perseus draws below the sample distribution, deterministically', () => {
    const a = imputeMissing(table(), { method: 'perseus' }).rows
    const b = imputeMissing(table(), { method: 'perseus' }).rows
    const pick = (rows: StandardRow[]): number =>
      rows.find((r) => r.uniqID === 'g2' && r.rep === 2)!.value as number
    expect(pick(a)).toBe(pick(b)) // seeded by (gene, sample)
    // Centred 1.8 SD below the rep-2 log2 mean: must sit below every observed rep-2 value here.
    const rep2 = table()
      .filter((r) => r.rep === 2 && r.value != null)
      .map((r) => r.value as number)
    expect(pick(a)).toBeLessThan(Math.min(...rep2))
    expect(pick(a)).toBeGreaterThan(0)
  })

  it('leaves values missing when nothing is observed to base them on', () => {
    const rows = [row('g1', 1, null), row('g1', 2, null)]
    const res = imputeMissing(rows, { method: 'perseus' })
    expect(res.summary.imputed).toBe(0)
    expect(res.rows.every((r) => r.value == null)).toBe(true)
  })
})
