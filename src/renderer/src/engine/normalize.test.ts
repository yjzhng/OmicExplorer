import { describe, expect, it } from 'vitest'

import { standardize } from './ingest'
import { MIN_SHARED_GENES, normalizeSamples } from './normalize'
import { buildMA, buildQc } from './plotData'
import {
  analysisScaleOf,
  plainLogOf,
  presentScaleOf,
  presentStd,
  quantityLabel,
  tableScaleOf,
  valueUnitOf,
  withLogDisplay
} from './scale'
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
  it('divides every value by that protein in its own sample, so it reads 1 everywhere', () => {
    // g0 loaded as every gene is (1×, 4×, ½×): dividing by it removes the loading exactly
    const input = table(10)
    const { rows, summary } = normalizeSamples(input, { reference: 'protein', protein: 'g0' })
    for (const v of rows.filter((r) => r.uniqID === 'g0').map((r) => r.value!))
      expect(v).toBeCloseTo(1, 9)
    // each value a fraction of the reference: g3 is 4× g0 in every sample (4000 / 1000 at 1×)
    for (const rep of [1, 2, 3]) {
      const g3 = rows.find((r) => r.uniqID === 'g3' && r.rep === rep)!.value!
      expect(g3).toBeCloseTo(4, 9)
    }
    expect(summary).toMatchObject({
      reference: 'protein',
      used: 'protein',
      protein: 'g0',
      samples: 3,
      missingSamples: 0
    })
    expect(summary.spread).toBeUndefined()
  })

  it('divides nothing when a sample lacks the protein, and names that sample', () => {
    const input = table(10).filter((r) => !(r.uniqID === 'g0' && r.rep === 3))
    const { rows, summary } = normalizeSamples(input, {
      reference: 'protein',
      protein: 'g0',
      spread: true
    })
    expect(summary).toMatchObject({ samples: 2, missingSamples: 1, missingLabels: ['A · r3'] })
    expect(summary.spread).toBeUndefined()
    expect(rows.map((r) => r.value)).toEqual(input.map((r) => r.value))
  })

  it('does nothing when the protein is nowhere', () => {
    const input = table(10)
    const { rows, summary } = normalizeSamples(input, { reference: 'protein', protein: 'nope' })
    expect(rows.map((r) => r.value)).toEqual(input.map((r) => r.value))
    expect(summary).toMatchObject({ samples: 0, missingSamples: 3, maxFold: 1 })
  })
})

describe('Clean data with a reference protein', () => {
  const DATA = ['id,a1,a2,b1,b2', 'R,1000,2000,500,1500', 'g1,100,200,200,600', 'g2,10,,5,15'].join(
    '\n'
  )
  const SS = ['sample,cmpd', 'a1,A', 'a2,A', 'b1,B', 'b2,B'].join('\n')
  const run = (data: string, logTransform?: 'log2' | 'log10') =>
    standardize({
      dataText: data,
      dataFilename: 'd.csv',
      samplesheetText: SS,
      normalize: { reference: 'protein', protein: 'R' },
      ...(logTransform ? { logTransform } : null)
    })

  it('holds the reference at 1 and every value as its fraction; logged, they show plain on a log axis', () => {
    const std = run(DATA, 'log2')
    for (const r of std.rows.filter((r) => r.uniqID === 'R')) expect(r.value).toBeCloseTo(1, 9)
    // g1 over R: 0.1, 0.1 (A) and 0.4, 0.4 (B)
    const g1 = std.rows.filter((r) => r.uniqID === 'g1').map((r) => r.value!)
    expect(g1.map((v) => Number(v.toFixed(6))).sort()).toEqual([0.1, 0.1, 0.4, 0.4])
    // plotted on the log-transform's scale (as tested), the values shown plain (LogDisplay)
    expect(presentScaleOf(std)).toBe('log2')
    expect(analysisScaleOf(std)).toBe('log2')
    expect(plainLogOf(std)).toBe(true)
    // the tables: the plain fractions
    expect(tableScaleOf(std)).toBe('linear')
    const shown = presentStd(std, tableScaleOf(std))
    for (const r of shown.rows.filter((r) => r.uniqID === 'R')) expect(r.value).toBeCloseTo(1, 9)
    // chosen as logs: log₂ fractions, the reference at 0
    const asLogs = withLogDisplay(std, 'log')
    expect(plainLogOf(asLogs)).toBe(false)
    const logged = presentStd(asLogs, tableScaleOf(asLogs))
    for (const r of logged.rows.filter((r) => r.uniqID === 'R')) expect(r.value).toBeCloseTo(0, 9)
  })

  it('names its values fractions on every quantity axis', () => {
    const std = run(DATA, 'log10')
    expect(valueUnitOf(std)).toBe('fraction')
    // shown plain on a log axis (the default for fractions), or as their logs
    expect(quantityLabel(presentScaleOf(std), valueUnitOf(std), plainLogOf(std))).toBe('fraction')
    expect(quantityLabel(presentScaleOf(std), valueUnitOf(std))).toBe('log fraction')
    expect(buildQc(std, 'intensity', presentScaleOf(std), undefined, true).yLabel).toBe('fraction')
    const ma = buildMA([], {
      fcLow: -1,
      fcHigh: 1,
      scale: 'log10',
      unit: 'fraction',
      plain: true
    })
    expect(ma.xLabel).toBe('mean fraction')
    // unlogged: plain values on a plain axis, whatever the display choice
    const linear = run(DATA, 'none' as never)
    expect(plainLogOf(linear)).toBe(false)
    expect(quantityLabel(presentScaleOf(linear), valueUnitOf(linear))).toBe('fraction')
    // without a reference protein: abundances, on the log-transform's scale, as before
    const plain = standardize({
      dataText: DATA,
      dataFilename: 'd.csv',
      samplesheetText: SS,
      logTransform: 'log10'
    })
    expect(valueUnitOf(plain)).toBe('abundance')
    expect(quantityLabel(presentScaleOf(plain), valueUnitOf(plain))).toBe('log abundance')
    // abundances read as logs by default; plain when chosen
    expect(plainLogOf(plain)).toBe(false)
    expect(plainLogOf(withLogDisplay(plain, 'plain'))).toBe(true)
  })

  it('stops, naming the samples, when one lacks the reference', () => {
    const data = DATA.replace('R,1000,2000,500,1500', 'R,1000,,500,1500')
    expect(() => run(data)).toThrow(/wasn't measured in 1 sample \(A · r2\)/)
  })
})

describe('how logged values show (LogDisplay)', () => {
  const DATA = ['id,a1,a2', 'g1,100,200', 'g2,10,30'].join('\n')
  const SS = ['sample,cmpd', 'a1,A', 'a2,A'].join('\n')
  it('is stamped from Clean data and carried by a re-clean', () => {
    const std = standardize({
      dataText: DATA,
      dataFilename: 'd.csv',
      samplesheetText: SS,
      logTransform: 'log10',
      logDisplay: 'plain'
    })
    expect(std.logDisplay).toBe('plain')
    expect(plainLogOf(std)).toBe(true)
    // the same positions either way: only the labels differ
    expect(presentScaleOf(std)).toBe('log10')
    expect(presentScaleOf(withLogDisplay(std, 'log'))).toBe('log10')
  })
})
