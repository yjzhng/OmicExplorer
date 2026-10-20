import { describe, expect, it } from 'vitest'

import type { CompareResultRow } from '../engine'
import { METRIC_IDS, metricBarsOf } from './metricBars'

const row = (rs: unknown, extra: Partial<CompareResultRow> = {}): CompareResultRow =>
  ({ uniqID: 'g1', cmpd: 'A', log2FC: 1.5, pQ: 3, rs, ...extra }) as unknown as CompareResultRow

describe('curve metrics as bars', () => {
  it('a curve: one bar per metric, pEC50 in molar on a log axis', () => {
    const r = row({
      axis: 'dose',
      F: 1,
      df1: 1,
      df2: 1,
      desc: { mid: 1, slope: 1.2, front: 0, back: 2, pec50: 0, r2: 0.9, lowShape: false }
    })
    const bars = metricBarsOf(r, METRIC_IDS, { unit: 'µM', scale: 1e-6 })
    const get = (id: string) => bars.find((b) => b.id === id)!
    expect(get('potency').label).toBe('pEC50')
    expect(get('potency').bars[0].value).toBeCloseTo(6)
    expect(get('slope').bars[0].value).toBe(1.2)
    expect(get('back').bars[0].value).toBe(2)
    expect(bars.map((b) => b.id)).toEqual(['potency', 'slope', 'front', 'back'])
    expect(bars.every((b) => b.bars.length === 1 && !b.by)).toBe(true)
  })

  it('a surface: per slice along its curve axis, named by its own conditions', () => {
    // dose × @temp tested for changes along @temp (linear): a temperature curve per dose
    const r = row({
      axis: 'surface',
      F: 1,
      df1: 1,
      df2: 1,
      pair: ['dose', '@temp'],
      maps: [
        { baseline: 'reference', base: 0 },
        { scale: 'linear', step: 3, baseline: 'reference', base: 42 }
      ],
      shift: {
        response: '@temp',
        across: 'dose',
        drift: 0,
        shape: 0,
        driftShare: 0,
        kind: 'shape'
      },
      surface: {
        method: 'doseSlices',
        byTime: [],
        byDose: [
          { at: 500, mid: 56, slope: 1, front: 0, back: -4, pec50: 0 },
          { at: 0, mid: 54, slope: 1, front: 0, back: -5, pec50: 0 }
        ],
        r2: 0.95
      }
    })
    const bars = metricBarsOf(r, ['potency', 'back'], { unit: 'dC', scale: 1 })
    expect(bars.map((b) => b.id)).toEqual(['potency', 'back'])
    const pot = bars[0]
    // EC50 itself on the linear temperature axis, in its unit; one bar per dose, in order
    expect(pot.label).toBe('EC50 (dC)')
    expect(pot.by).toBe('dose')
    expect(pot.bars).toEqual([
      { at: '0', value: 54 },
      { at: '500', value: 56 }
    ])
    expect(bars[1].bars.map((b) => b.value)).toEqual([-5, -4])
    // Δ: from the reference slice — the control level the fit records (dose 0), its own bar 0
    const d = metricBarsOf(r, ['potency'], { unit: 'dC', scale: 1, delta: true })[0]
    expect(d.label).toBe('ΔEC50 (dC)')
    expect(d.ref).toBe('0')
    expect(d.bars).toEqual([
      { at: '0', value: 0 },
      { at: '500', value: 2 }
    ])
    // a control that isn't the lowest level (a top-dose baseline): Δ follows it, not the lowest
    const top = { ...r, rs: { ...r.rs!, maps: [{ ...r.rs!.maps![0], base: 500 }, r.rs!.maps![1]] } }
    const dt = metricBarsOf(top as CompareResultRow, ['potency'], { scale: 1, delta: true })[0]
    expect(dt.ref).toBe('500')
    expect(dt.bars.map((b) => b.value)).toEqual([-2, 0])
  })
})
