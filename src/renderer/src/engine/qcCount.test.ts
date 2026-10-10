import { describe, expect, it } from 'vitest'

import { buildQc } from './plotData'
import type { StandardizeResult, StandardRow } from './types'

const row = (uniqID: string, rep: number, value: number | null, imputed = false): StandardRow => ({
  uniqID,
  cell: 'WT',
  cmpd: '',
  dose: null,
  time: null,
  rep,
  value,
  ...(imputed ? { imputed } : null)
})

describe('buildQc proteins', () => {
  it('counts measured values, with the imputed ones apart (stacked on top in the bar)', () => {
    // Sample r1 measured 3 proteins; r2 measured 1, with 2 filled in by imputation.
    const std = {
      rows: [
        row('a', 1, 10),
        row('b', 1, 20),
        row('c', 1, 30),
        row('a', 2, 11),
        row('b', 2, 2, true),
        row('c', 2, 3, true)
      ],
      activeConditions: ['cell']
    } as unknown as StandardizeResult
    const qc = buildQc(std, 'proteins')
    expect(qc.groups.map((g) => [g.label, g.values[0], g.imputed])).toEqual([
      ['WT · r1', 3, undefined],
      ['WT · r2', 1, 2]
    ])
    // Each group carries its sample's conditions, for colouring by condition.
    expect(qc.groups.map((g) => [g.meta.cell, g.meta.rep])).toEqual([
      ['WT', 1],
      ['WT', 2]
    ])
  })
})
