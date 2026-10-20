/**
 * A paired contrast carries each side's replicates through the join (FC1reps / FC2reps) — the
 * points its DR draws — pooled per matched context, and moved onto the plot scale with the values.
 */
import { describe, expect, it } from 'vitest'

import { abundanceOnScale, runContrastPair, type ContrastSideRow } from './contrast'

/** One sample's log10 abundance for gene g at `dose` (a sample row is its own replicate). */
const sample = (dose: number, value: number): ContrastSideRow => ({
  uniqID: 'g',
  dose,
  value,
  reps: [value]
})

describe('contrast replicates', () => {
  const res = runContrastPair({
    sideA: [sample(1, 2), sample(1, 3), sample(10, 4)],
    sideB: [sample(1, 1), sample(10, 5), sample(10, 6)],
    match: ['dose'],
    driverMask: false
  })
  const at = (dose: number) => res.rows.find((r) => r.dose === dose)!

  it("pools each side's replicates per matched context", () => {
    expect(at(1).FC1reps).toEqual([2, 3])
    expect(at(1).FC2reps).toEqual([1])
    expect(at(10).FC1reps).toEqual([4])
    expect(at(10).FC2reps).toEqual([5, 6])
    expect(at(1).FC1).toBeCloseTo(2.5)
  })

  it('moves the replicates onto the plot scale with the values', () => {
    const log2 = abundanceOnScale(res.rows, 'log2').find((r) => r.dose === 1)!
    expect(log2.FC1reps![0]).toBeCloseTo(2 / Math.log10(2))
    const lin = abundanceOnScale(res.rows, 'linear').find((r) => r.dose === 1)!
    expect(lin.FC1reps).toEqual([100, 1000])
  })

  it('leaves them out where a side carried none', () => {
    const bare = runContrastPair({
      sideA: [{ uniqID: 'g', dose: 1, value: 1 }],
      sideB: [{ uniqID: 'g', dose: 1, value: 2 }],
      match: ['dose'],
      driverMask: false
    })
    expect(bare.rows[0].FC1reps).toBeNull()
  })
})

describe('contrast names', () => {
  // both sides of one cell line (a Subset kept just it), contrasted at dose 5
  const side = (cmpd: string, value: number): ContrastSideRow => ({
    uniqID: 'g',
    cell: 'RPMI8226',
    cmpd,
    dose: 5,
    value
  })
  const run = (nameConds?: Parameters<typeof runContrastPair>[0]['nameConds']) =>
    runContrastPair({
      sideA: [side('Bortezomib', 1)],
      sideB: [side('Carfilzomib', 2)],
      match: [],
      labelA: 'Bortezomib',
      labelB: 'Carfilzomib',
      driverMask: false,
      ...(nameConds ? { nameConds } : null)
    }).comparisons[0]

  it('state each fixed slice', () => {
    expect(run()).toBe('Bortezomib (cell RPMI8226 · dose 5) | Carfilzomib (cell RPMI8226 · dose 5)')
  })
  it("but not of a condition the datasets don't carry as active (a Subset narrowed it)", () => {
    expect(run(['cmpd', 'dose'])).toBe('Bortezomib (dose 5) | Carfilzomib (dose 5)')
  })
})
