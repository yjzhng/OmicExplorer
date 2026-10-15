/** A Contrast's features: what each input offers, each feature's per-gene value, and the switcher
 *  (a `feature` facet first, in the Contrast's own order). */
import { describe, expect, it } from 'vitest'

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
      'peak log₂FC',
      'pEC50'
    ])
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
    expect(facetCompareRows(rows, ['feature']).map((g) => g.values[0].value)).toEqual([
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
