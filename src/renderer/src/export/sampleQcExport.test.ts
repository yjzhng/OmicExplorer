import { describe, expect, it } from 'vitest'

import type { StandardizeResult, StandardRow } from '../engine'
import { sampleQcExport, stdMatrixExport } from './tables'

const row = (uniqID: string, rep: number, value: number | null): StandardRow => ({
  uniqID,
  cell: 'WT',
  cmpd: '',
  dose: null,
  time: null,
  rep,
  value
})

describe('the QC view, downloaded', () => {
  it('one row per sample, as the view shows it', () => {
    const std = {
      rows: [row('a', 1, 10), row('b', 1, 100), row('a', 2, 30), row('b', 2, null)],
      activeConditions: ['cell'],
      scale: 'log10'
    } as unknown as StandardizeResult
    const t = sampleQcExport({ kind: 'standardize', std } as never)
    expect(t.columns).toEqual([
      'cell',
      'rep',
      'measured',
      'imputed',
      'missing',
      'missing %',
      'median (log abundance)',
      'Q1 (log abundance)',
      'Q3 (log abundance)',
      'group CV %'
    ])
    expect(t.rows.map((r) => r.slice(0, 6))).toEqual([
      ['WT', 1, 2, 0, 0, 0],
      ['WT', 2, 1, 0, 1, 50]
    ])
  })
})

describe('the matrix view, downloaded', () => {
  it('one row per gene, one column per sample', () => {
    const std = {
      rows: [row('a', 1, 10), row('b', 1, 100), row('a', 2, 30), row('b', 2, null)],
      activeConditions: ['cell'],
      displayMap: { a: 'A' },
      scale: 'log10',
      inputScale: 'linear'
    } as unknown as StandardizeResult
    const t = stdMatrixExport({ kind: 'standardize', std } as never)
    expect(t.columns).toEqual(['uniqID', 'gene', 'WT · r1', 'WT · r2'])
    expect(t.rows[0].slice(0, 3)).toEqual(['a', 'A', 1])
    expect(t.rows[1]).toEqual(['b', '', 2, null])
  })
})
