import { describe, expect, it } from 'vitest'

import { runCompare } from './direct'
import { samBoundary, samTest, type SamValue } from './sam'
import { DEFAULT_THRESHOLD, studentTTwoSided } from './stats'
import type { StandardRow } from './types'

/** A seeded normal draw, for reproducible noise. */
function gaussian(seed: number): () => number {
  let a = seed >>> 0
  const u = (): number => {
    a = (a * 1103515245 + 12345) % 2147483648
    return (a + 1) / 2147483649
  }
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u())
}

const values = (gene: string, side: string, xs: number[]): SamValue[] =>
  xs.map((value, i) => ({ uniqID: gene, sample: `${side}${i}`, value }))

describe('samTest', () => {
  it('computes d = Δ / (s + s0) with the pooled standard error, and its pooled t p-value', () => {
    // num 1,2,3 (mean 2), den 0,1,2 (mean 1): pooled var = (2 + 2)/4 = 1, s = √(2/3).
    const res = samTest(values('g', 'n', [1, 2, 3]), values('g', 'd', [0, 1, 2]), {
      s0: 0.1,
      permutations: 100
    }).get('g')!
    const s = Math.sqrt(2 / 3)
    expect(res.d).toBeCloseTo(1 / (s + 0.1), 10)
    expect(res.df).toBe(4)
    expect(res.pVal).toBeCloseTo(studentTTwoSided(1 / s, 4), 10)
  })

  it('separates planted changes from noise in its q-values', () => {
    const z = gaussian(7)
    const num: SamValue[] = []
    const den: SamValue[] = []
    for (let g = 0; g < 400; g++) {
      const shift = g < 20 ? 2 : 0 // 20 truly changed genes
      num.push(
        ...values(
          `g${g}`,
          'n',
          [0, 1, 2, 3].map(() => shift + 0.3 * z())
        )
      )
      den.push(
        ...values(
          `g${g}`,
          'd',
          [0, 1, 2, 3].map(() => 0.3 * z())
        )
      )
    }
    const res = samTest(num, den, { s0: 0.1, permutations: 250 })
    const q = (g: number): number => res.get(`g${g}`)!.q
    for (let g = 0; g < 20; g++) expect(q(g)).toBeLessThan(0.05)
    const nullCalled = Array.from({ length: 380 }, (_, i) => q(i + 20)).filter((x) => x < 0.05)
    expect(nullCalled.length).toBeLessThan(5)
    // q never falls as |d| falls.
    const byD = [...res.values()].sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    for (let i = 1; i < byD.length; i++) expect(byD[i].q).toBeGreaterThanOrEqual(byD[i - 1].q)
  })

  it('leaves out genes with fewer than two values on a side', () => {
    const res = samTest(
      [...values('a', 'n', [1, 2, 3]), ...values('b', 'n', [1])],
      [...values('a', 'd', [0, 1, 2]), ...values('b', 'd', [0, 1, 2])],
      { s0: 0.1, permutations: 50 }
    )
    expect(res.has('a')).toBe(true)
    expect(res.has('b')).toBe(false)
  })
})

describe('samBoundary', () => {
  it('passes through a gene sitting exactly at the cutoff', () => {
    const s0 = 0.1
    const df = 6
    for (const [fc, s] of [
      [1, 0.3],
      [2.5, 0.8],
      [0.4, 0.05]
    ]) {
      const c = fc / (s + s0) // this gene's |d| — use it as the cutoff
      expect(samBoundary(fc, c, s0, df)).toBeCloseTo(-Math.log10(studentTTwoSided(fc / s, df)), 8)
    }
    expect(samBoundary(0.1, 2, 0.1, 6)).toBe(Infinity) // inside the wall |FC| ≤ c·s0
  })
})

describe('runCompare with SAM', () => {
  it('reports the permutation q as pQ and calls from it', () => {
    const z = gaussian(3)
    const rows: StandardRow[] = []
    for (let g = 0; g < 200; g++)
      for (const [cmpd, shift] of [
        ['drug', g < 10 ? 1.5 : 0],
        ['dmso', 0]
      ] as const)
        for (let rep = 1; rep <= 4; rep++)
          rows.push({
            uniqID: `g${g}`,
            cell: '',
            cmpd,
            dose: null,
            time: null,
            rep,
            value: 2 ** (10 + shift + 0.2 * z())
          })
    const res = runCompare({
      rows,
      num: { cmpd: ['drug'] },
      den: { cmpd: ['dmso'] },
      match: [],
      activeConditions: ['cmpd'],
      threshold: { ...DEFAULT_THRESHOLD, type: 'sam_fdr', statMin: -Math.log10(0.05) }
    })
    // Every planted change called; a 5% FDR allows the odd null gene just past the cutoff.
    const called = new Set(res.rows.filter((r) => r.signf).map((r) => r.uniqID))
    for (let g = 0; g < 10; g++) expect(called.has(`g${g}`)).toBe(true)
    expect(called.size - 10).toBeLessThanOrEqual(3)
    for (const r of res.rows) {
      expect(r.sam).toBeDefined()
      expect(r.signf).toBe((r.pQ ?? 0) >= -Math.log10(0.05))
    }
  })
})
