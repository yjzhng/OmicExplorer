/** A Contrast's features: what each input offers, each feature's per-gene value, and the switcher
 *  (a `feature` facet first, in the Contrast's own order). */
import { describe, expect, it } from 'vitest'
import { numericConds } from '../engine'

import {
  facetCompareRows,
  facetDims,
  rowsOfFeatureNamed,
  type CompareResultRow,
  type ContrastResultRow
} from '../engine'
import {
  compareFeatureValue,
  contrastFeatures,
  stdFeatureValue,
  surfaceSideRows
} from './contrastPair'
import type { NodeResult } from './types'

/** dose and time numeric, no custom condition declared (the schema of these tests' data) */
const numeric = numericConds()

const cmpRow = (over: Partial<CompareResultRow>): CompareResultRow => ({
  uniqID: 'g1',
  cmpd: 'X',
  dose: null,
  time: null,
  cmp_cond: 'cmpd',
  comparison: 'X | DMSO',
  mean1: null,
  mean2: null,
  sd1: null,
  sd2: null,
  log2FC: 1.5,
  pP: 3,
  pQ: 2,
  thrsh: '',
  signf: true,
  effect: 'up',
  ...over
})
const compare = (rows: CompareResultRow[], statType: 'pP' | 'pQ' = 'pQ'): NodeResult =>
  ({
    kind: 'compare',
    cmp: { rows, comparisons: ['X | DMSO'], threshold: { statType } },
    displayMap: {}
  }) as unknown as NodeResult

describe('contrast features', () => {
  it('offers each input its own: Clean data, a t-test, a curve fit', () => {
    const std = { kind: 'standardize', std: { rows: [] } } as unknown as NodeResult
    expect(contrastFeatures(std).map((f) => f.label)).toEqual(['abundance', 'SD', 'CV %'])
    expect(contrastFeatures(compare([cmpRow({})])).map((f) => f.label)).toEqual([
      'log₂FC',
      '−log₁₀ q'
    ])
    expect(contrastFeatures(compare([cmpRow({})], 'pP')).map((f) => f.label)).toEqual([
      'log₂FC',
      '−log₁₀ p'
    ])
    const curve = cmpRow({
      curve: { axis: 'dose', pec50: 6 } as unknown as CompareResultRow['curve']
    })
    expect(contrastFeatures(compare([curve])).map((f) => f.label)).toEqual([
      'curve log₂FC',
      'pEC50'
    ])
  })

  it("reads each feature's value", () => {
    const ctx = { statType: 'pQ' as const, doseScale: 1e-6 }
    const r = cmpRow({ curve: { axis: 'dose', pec50: 0 } as unknown as CompareResultRow['curve'] })
    expect(compareFeatureValue(r, 'value', ctx)).toBe(1.5)
    expect(compareFeatureValue(r, 'p', ctx)).toBe(2)
    expect(compareFeatureValue(r, 'p', { ...ctx, statType: 'pP' })).toBe(3)
    // EC50 = 10⁰ = 1 µM → pEC50 6 in molar
    expect(compareFeatureValue(r, 'pec50', ctx)).toBeCloseTo(6)
    // abundances 10 and 30: mean of the logs, SD of the logs, CV of the abundances (%)
    const logs = [1, Math.log10(30)]
    expect(stdFeatureValue(logs, 'value')).toBeCloseTo((1 + Math.log10(30)) / 2)
    expect(stdFeatureValue(logs, 'sd')).toBeCloseTo(Math.abs(1 - Math.log10(30)) / Math.SQRT2)
    expect(stdFeatureValue(logs, 'cv')).toBeCloseTo(((Math.SQRT2 * 10) / 20) * 100)
    expect(stdFeatureValue([1], 'sd')).toBeNull()
  })

  it('contrasts a dose × time surface time by time', () => {
    const surface = cmpRow({
      rs: {
        axis: 'surface',
        F: 1,
        df1: 1,
        df2: 1,
        cells: [
          { dose: 1, time: 2, y: 0, fitted: 0.5 },
          { dose: 10, time: 2, y: 0, fitted: -1.2 },
          { dose: 1, time: 24, y: 0, fitted: 2 },
          { dose: 10, time: 24, y: 0, fitted: 1 }
        ],
        surface: { byTime: [{ at: 24, mid: 1 }] }
      } as unknown as CompareResultRow['rs']
    })
    expect(contrastFeatures(compare([surface])).map((f) => f.label)).toEqual([
      'curve log₂FC',
      'pEC50'
    ])
    // named with the dose's unit: molar → pEC50 in molar; another unit → −log₁₀ of it
    expect(contrastFeatures(compare([surface]), { dose: 'nM' })[1].label).toBe('pEC50 (M)')
    expect(contrastFeatures(compare([surface]), { dose: 'ng/mL' })[1].label).toBe(
      'pEC50 (−log₁₀ ng/mL)'
    )
    const ctx = { statType: 'pQ' as const, doseScale: 1e-6 }
    // the fit's signed peak at each time
    expect(surfaceSideRows(surface, 'value', ctx).map((r) => [r.time, r.value])).toEqual([
      [2, -1.2],
      [24, 2]
    ])
    // pEC50 at each described time (1 µM → 6)
    const p = surfaceSideRows(surface, 'pec50', ctx)
    expect(p.map((r) => r.time)).toEqual([24])
    expect(p[0].value).toBeCloseTo(6)
  })

  it('contrasts a surface along its own axes — never assumed time', () => {
    // dose × @temp, tested for changes along @temp: temperature curves at each dose
    const surface = cmpRow({
      rs: {
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
        cells: [
          { dose: 0, time: 50, y: 0, fitted: -1 },
          { dose: 0, time: 60, y: 0, fitted: -3 },
          { dose: 10, time: 50, y: 0, fitted: -0.5 },
          { dose: 10, time: 60, y: 0, fitted: -1 }
        ],
        surface: { byTime: [], byDose: [{ at: 10, mid: 57 }] }
      } as unknown as CompareResultRow['rs']
    })
    const fs = contrastFeatures(compare([surface]))
    // a linear temperature axis: EC50 itself — in its unit, else named by its axis
    expect(fs.map((f) => f.label)).toEqual(['curve log₂FC', 'EC50 (temp)'])
    expect(contrastFeatures(compare([surface]), { '@temp': '°C' })[1].label).toBe('EC50 (°C)')
    const ctx = { statType: 'pQ' as const, doseScale: 1e-9 }
    // per dose (the slices), the shift from the dose-0 curve at its largest: dose 10 at 60° (+2)
    const v = surfaceSideRows(surface, 'value', ctx)
    expect(v.map((r) => [r.dose, r.time, r.value])).toEqual([
      [0, null, 0],
      [10, null, 2]
    ])
    // the potency: each dose's temperature curve's midpoint, as it is (°)
    const p = surfaceSideRows(surface, 'pec50', ctx)
    expect(p.map((r) => [r.dose, r.value])).toEqual([[10, 57]])
    // capturing the shape instead: dose curves at each temperature — the slices carry @temp (in
    // the rows' custom values), not time
    const shape = cmpRow({ rs: { ...surface.rs!, shift: undefined } })
    const t = surfaceSideRows(shape, 'value', ctx)
    expect(t.map((r) => [r.extra?.temp, r.time, r.value])).toEqual([
      ['50', null, -1],
      ['60', null, -3]
    ])
  })

  it('switches by a feature facet, first, in its own order', () => {
    const row = (feature: string, cell: string): ContrastResultRow =>
      ({
        uniqID: 'g1',
        cell,
        dose: null,
        time: null,
        cmp_cond: 'dataset',
        comparison: 'A | B',
        FC1: 1,
        FC2: 0,
        featureId: feature === 'log₂FC' ? 'value' : 'p',
        feature
      }) as unknown as ContrastResultRow
    const rows = [row('log₂FC', 'WT'), row('log₂FC', 'KO'), row('−log₁₀ q', 'WT')]
    expect(facetDims(rows)).toEqual(['feature', 'cell'])
    // the Contrast's order (its own value first), not A–Z
    expect(facetCompareRows(rows, ['feature'], numeric).map((g) => g.values[0].value)).toEqual([
      'log₂FC',
      '−log₁₀ q'
    ])
    // a table shows the switcher's feature, else the first
    expect(rowsOfFeatureNamed(rows, '−log₁₀ q')).toHaveLength(1)
    expect(rowsOfFeatureNamed(rows, undefined)).toHaveLength(2)
    // one feature: nothing to switch
    expect(facetDims(rows.slice(0, 2).map((r) => ({ ...r, feature: undefined })))).toEqual(['cell'])
  })
})
