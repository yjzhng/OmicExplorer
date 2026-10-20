import { describe, expect, it } from 'vitest'

import { MIN_SHARED_GENES, normalizeSamples } from './normalize'
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

/** `n` shared genes in 3 samples, the same profile in each but sample 2 loaded 4× and sample 3
 *  ½× — plus, when `deep`, extra low-abundance genes seen only in sample 3. */
function table(n: number, deep = 0): StandardRow[] {
  const load = [1, 4, 0.5]
  const out: StandardRow[] = []
  for (let g = 0; g < n; g++)
    for (const rep of [1, 2, 3]) out.push(row(`g${g}`, rep, 1000 * (g + 1) * load[rep - 1]))
  for (let g = 0; g < deep; g++) out.push(row(`low${g}`, 3, 1 + g))
  return out
}

const valuesOf = (rows: StandardRow[], rep: number): number[] =>
  rows.filter((r) => r.rep === rep && r.uniqID.startsWith('g')).map((r) => r.value!)

describe('normalizeSamples', () => {
  it('removes per-sample loading differences on the shared genes', () => {
    const { rows, summary } = normalizeSamples(table(MIN_SHARED_GENES))
    // Every sample brought to the median sample (rep 1), so the profiles coincide.
    for (const rep of [2, 3])
      valuesOf(rows, rep).forEach((v, i) => expect(v).toBeCloseTo(valuesOf(rows, 1)[i], 6))
    expect(summary).toMatchObject({ reference: 'shared', used: 'shared', samples: 3 })
    expect(summary.sharedGenes).toBe(MIN_SHARED_GENES)
    expect(summary.maxFold).toBeCloseTo(4, 6)
  })

  it("isn't pulled by genes only a deeper sample detected — unlike 'all'", () => {
    const deep = table(MIN_SHARED_GENES, 200)
    const shared = normalizeSamples(deep).rows
    valuesOf(shared, 3).forEach((v, i) => expect(v).toBeCloseTo(valuesOf(shared, 1)[i], 6))
    // Over all values, sample 3's low-abundance genes drag its median down, so it's over-raised.
    const all = normalizeSamples(deep, { reference: 'all' }).rows
    expect(valuesOf(all, 3)[0]).toBeGreaterThan(valuesOf(all, 1)[0] * 1.5)
  })

  it('falls back to all values when too few genes are in every sample', () => {
    const { rows, summary } = normalizeSamples(table(MIN_SHARED_GENES - 1))
    expect(summary).toMatchObject({ reference: 'shared', used: 'all' })
    valuesOf(rows, 2).forEach((v, i) => expect(v).toBeCloseTo(valuesOf(rows, 1)[i], 6))
  })

  it('leaves missing values missing', () => {
    const t = table(MIN_SHARED_GENES)
    t.push(row('gap', 1, null), row('gap', 2, 5), row('gap', 3, null))
    const { rows } = normalizeSamples(t)
    const gap = rows.filter((r) => r.uniqID === 'gap')
    expect(gap.find((r) => r.rep === 1)!.value).toBeNull()
    expect(gap.find((r) => r.rep === 2)!.value).toBeCloseTo(5 / 4, 6)
  })

  it('equalises each half of the spread when asked (Perseus width adjustment)', () => {
    // Sample 2 the same genes stretched 2× around its median in log₂, sample 3 squeezed ½×.
    const stretch = [1, 2, 0.5]
    const t: StandardRow[] = []
    for (let g = 0; g < 101; g++)
      for (const rep of [1, 2, 3])
        t.push(row(`g${g}`, rep, Math.pow(2, 10 + (g - 50) * 0.05 * stretch[rep - 1])))
    // Medians alone leave the stretch.
    const plain = normalizeSamples(t).rows
    expect(valuesOf(plain, 2)[0]).not.toBeCloseTo(valuesOf(plain, 1)[0], 3)
    const { rows, summary } = normalizeSamples(t, { spread: true })
    for (const rep of [2, 3])
      valuesOf(rows, rep).forEach((v, i) => expect(v).toBeCloseTo(valuesOf(rows, 1)[i], 6))
    expect(summary.spread!.min).toBeCloseTo(0.5, 6)
    expect(summary.spread!.max).toBeCloseTo(2, 6)
  })

  it('scales the two halves separately', () => {
    // Sample 2's upper half stretched 2×, its lower half untouched.
    const t: StandardRow[] = []
    for (let g = 0; g < 101; g++) {
      const d = (g - 50) * 0.05
      t.push(row(`g${g}`, 1, Math.pow(2, 10 + d)))
      t.push(row(`g${g}`, 2, Math.pow(2, 10 + (d > 0 ? 2 * d : d))))
    }
    const out = normalizeSamples(t, { spread: true }).rows
    // Two samples: the target widths are the means of the two, so both meet in the middle.
    const log = (rep: number, g: number): number =>
      Math.log2(out.find((r) => r.rep === rep && r.uniqID === `g${g}`)!.value!)
    expect(log(1, 100)).toBeCloseTo(log(2, 100), 6)
    expect(log(1, 0)).toBeCloseTo(log(2, 0), 6)
    expect(log(2, 0)).toBeCloseTo(10 - 2.5, 6) // the lower half kept its width
  })
})

describe('normalizeSamples on a reference protein', () => {
  it('brings that protein to the same level in every sample, shifting each sample by it', () => {
    // g0 loaded as every gene is (1×, 4×, ½×): normalising on it removes the loading exactly
    const { rows, summary } = normalizeSamples(table(10), { reference: 'protein', protein: 'g0' })
    const g0 = rows.filter((r) => r.uniqID === 'g0').map((r) => r.value!)
    expect(g0[1]).toBeCloseTo(g0[0], 6)
    expect(g0[2]).toBeCloseTo(g0[0], 6)
    // …at the median of its own values (1000 · {1, 4, ½} → 1000)
    expect(g0[0]).toBeCloseTo(1000, 6)
    for (const rep of [2, 3])
      valuesOf(rows, rep).forEach((v, i) => expect(v).toBeCloseTo(valuesOf(rows, 1)[i], 6))
    expect(summary).toMatchObject({
      reference: 'protein',
      used: 'protein',
      protein: 'g0',
      samples: 3,
      missingSamples: 0
    })
    expect(summary.spread).toBeUndefined()
  })

  it('leaves a sample without the protein as it is, and ignores the spread option', () => {
    const input = table(10).filter((r) => !(r.uniqID === 'g0' && r.rep === 3))
    const { rows, summary } = normalizeSamples(input, {
      reference: 'protein',
      protein: 'g0',
      spread: true
    })
    expect(summary).toMatchObject({ samples: 2, missingSamples: 1 })
    expect(summary.spread).toBeUndefined()
    // sample 3 untouched
    const before = input.filter((r) => r.rep === 3).map((r) => r.value)
    expect(rows.filter((r) => r.rep === 3).map((r) => r.value)).toEqual(before)
  })

  it('does nothing when the protein is nowhere', () => {
    const input = table(10)
    const { rows, summary } = normalizeSamples(input, { reference: 'protein', protein: 'nope' })
    expect(rows.map((r) => r.value)).toEqual(input.map((r) => r.value))
    expect(summary).toMatchObject({ samples: 0, missingSamples: 3, maxFold: 1 })
  })
})
