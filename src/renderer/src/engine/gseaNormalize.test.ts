/** GSEA's NES / p from an observed ES and its permutation null. */
import { describe, expect, it } from 'vitest'

import { gseaNormalize } from './plotData'

const repeat = (v: number, n: number): number[] => Array(n).fill(v)

describe('gseaNormalize', () => {
  it('divides by the mean of the same-sign null, and takes p among it', () => {
    // 500 positive null scores of 0.2, 500 negative of −0.1
    const nul = [...repeat(0.2, 500), ...repeat(-0.1, 500)]
    const up = gseaNormalize(0.4, nul)
    expect(up.nes).toBeCloseTo(2, 10)
    expect(up.p).toBeCloseTo(1 / 501, 10)
    const down = gseaNormalize(-0.05, nul)
    expect(down.nes).toBeCloseTo(-0.5, 10)
    expect(down.p).toBe(1) // every negative null score is at least as extreme
  })

  it('stays finite and significant when no null score shares the sign', () => {
    // A large set: every random score came out positive. Before, NES was −0.1 / 1e-9 = −10⁸.
    const nul = repeat(0.05, 1000)
    const r = gseaNormalize(-0.1, nul)
    expect(r.nes).toBeCloseTo(-2, 10) // normalised by the whole null's mean |ES|
    expect(r.p).toBeCloseTo(1 / 1001, 10) // unmatched by any permutation
  })

  it('falls back when too few null scores share the sign to average', () => {
    const nul = [...repeat(0.05, 995), ...repeat(-0.001, 5)]
    const r = gseaNormalize(-0.1, nul)
    expect(Math.abs(r.nes)).toBeLessThan(10)
    expect(r.p).toBeLessThan(0.01)
  })
})
