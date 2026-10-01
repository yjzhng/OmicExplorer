/** Data scale: detecting what values arrived on, converting to linear, and presenting on a chosen
 *  log — and Clean data analysing raw and already-logged input identically. */
import { describe, expect, it } from 'vitest'

import { previewScale, standardize } from './ingest'
import {
  defaultTransform,
  detectScale,
  fromLinear,
  histogram,
  outputScale,
  presentStd,
  toLinear
} from './scale'

describe('detectScale', () => {
  it('calls raw intensities linear', () => {
    expect(detectScale([1200, 35000, 8.4e8, 0, 410]).scale).toBe('linear')
  })

  it('calls log₂ intensities log2 and log₁₀ ones log10', () => {
    expect(detectScale([14.2, 22.8, 31.5, 18.0, 25.1]).scale).toBe('log2')
    expect(detectScale([3.1, 5.4, 8.9, 6.2, 4.4]).scale).toBe('log10')
  })

  it('calls anything negative logged (log2)', () => {
    expect(detectScale([-1.2, 0.4, 2.3]).scale).toBe('log2')
  })

  it('calls log₁₀ data with values near zero log10, not linear', () => {
    // The reported case: a max/min ratio test read these as linear — 0.05 against 8 is 160×.
    expect(detectScale([0.05, 2.8, 3.9, 4.4, 5.1, 5.6, 6.2, 7.0, 8.0]).scale).toBe('log10')
    // log₁₀ of raw values just above 1 (≈ 0.0004) next to log₁₀ of 10⁹ (9).
    const logged = [1.001, 25, 300, 4e3, 5e4, 6e5, 7e6, 8e7, 1e9].map(Math.log10)
    expect(detectScale(logged).scale).toBe('log10')
  })

  it('calls small but strongly right-skewed values linear', () => {
    // Linear data with a low ceiling still has raw intensity's shape: a pile near zero, a tail.
    const v = [...Array(40).fill(0.2), ...Array(8).fill(1.5), 6, 12, 25, 48]
    expect(detectScale(v).scale).toBe('linear')
  })

  it('reports what it saw', () => {
    const { evidence } = detectScale([0, 4, 10, 20])
    expect(evidence).toMatchObject({ min: 0, max: 20, nonPositive: 0.25 })
  })
})

describe('scale conversions', () => {
  it('round-trips through linear', () => {
    for (const s of ['log2', 'log10'] as const)
      expect(fromLinear(toLinear(7.5, s), s)).toBeCloseTo(7.5, 12)
  })

  it('has no log for a non-positive value', () => {
    expect(fromLinear(0, 'log10')).toBeNull()
    expect(fromLinear(-3, 'log2')).toBeNull()
  })

  it('defaults to log10 for linear input and none for logged', () => {
    expect(defaultTransform('linear')).toBe('log10')
    expect(defaultTransform('log2')).toBe('none')
    expect(outputScale(undefined, 'linear')).toBe('log10')
    expect(outputScale(undefined, 'log2')).toBe('log2')
    expect(outputScale('none', 'linear')).toBe('linear')
    expect(outputScale('log2', 'log10')).toBe('log2')
  })

  it('bins every value', () => {
    const h = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5)
    expect(h.counts).toEqual([2, 2, 2, 2, 2])
    expect(h.n).toBe(10)
  })
})

describe('Clean data on raw vs already-logged input', () => {
  const sheet = ['sample,cell,cmpd', 's1,WT,A', 's2,WT,A', 's3,WT,B', 's4,WT,B'].join('\n')
  const raw = [
    [1200, 1500, 900, 1100],
    [52000, 61000, 48000, 70000],
    [8.0e6, 7.5e6, 9.1e6, 8.8e6]
  ]
  const wide = (vals: number[][], f: (v: number) => number) =>
    ['id,s1,s2,s3,s4', ...vals.map((row, i) => `g${i + 1},${row.map(f).join(',')}`)].join('\n')
  const run = (dataText: string, logTransform?: 'none' | 'log2' | 'log10') =>
    standardize({ dataText, dataFilename: 'd_wide.csv', samplesheetText: sheet, logTransform })
  const values = (r: ReturnType<typeof run>) =>
    [...r.rows]
      .sort((a, b) => (a.uniqID + a.sample).localeCompare(b.uniqID + b.sample))
      .map((x) => x.value as number)

  it('gives the same linear rows whether the input arrived raw or log₂', () => {
    const a = run(wide(raw, (v) => v))
    const b = run(wide(raw, (v) => Math.log2(v)))
    expect(a.inputScale).toBe('linear')
    expect(b.inputScale).toBe('log2')
    values(a).forEach((v, i) => expect(values(b)[i]).toBeCloseTo(v, 6))
  })

  it('presents on the chosen scale, defaulting to log10 for raw input', () => {
    const r = run(wide(raw, (v) => v))
    expect(r.scale).toBe('log10')
    expect(presentStd(r).rows[0].value).toBeCloseTo(Math.log10(r.rows[0].value as number), 12)
    // 'none' on raw input presents it as it arrived: the very same rows.
    const none = run(
      wide(raw, (v) => v),
      'none'
    )
    expect(none.scale).toBe('linear')
    expect(presentStd(none)).toBe(none)
  })

  it('records the input distribution as it arrived', () => {
    const r = run(wide(raw, (v) => Math.log2(v)))
    expect(r.inputHistogram?.n).toBe(12)
    expect(r.inputHistogram?.max).toBeCloseTo(Math.log2(9.1e6), 6)
  })
})

describe('previewScale — before any run', () => {
  const sheet = ['sample,cell,cmpd', 's1,WT,A', 's2,WT,A', 's3,WT,B', 's4,WT,B'].join('\n')
  const wideLog2 = [
    'id,s1,s2,s3,s4',
    'g1,10.2,10.5,9.9,10.1',
    'g2,15.7,15.9,15.5,16.1',
    'g3,22.9,22.8,23.1,23.0'
  ].join('\n')
  const longRaw = [
    'UniProtID,sample,value',
    'P1,s1,1200',
    'P1,s2,1500',
    'P2,s1,8.0e6',
    'P2,s2,7.5e6'
  ].join('\n')

  it('judges a data file exactly as the run does', () => {
    const p = previewScale(wideLog2, 'd_wide.csv')
    const r = standardize({
      dataText: wideLog2,
      dataFilename: 'd_wide.csv',
      samplesheetText: sheet
    })
    expect(p.inputScale).toBe('log2')
    expect(p.inputScale).toBe(r.inputScale)
    expect(p.evidence).toEqual(r.scaleEvidence)
  })

  it("reads a wide file's sample columns and a long file's value column", () => {
    expect(previewScale(wideLog2, 'd_wide.csv').sample).toHaveLength(12)
    const long = previewScale(longRaw, 'd_long.csv')
    expect(long.sample).toEqual([1200, 1500, 8.0e6, 7.5e6])
    expect(long.inputScale).toBe('linear')
  })
})
