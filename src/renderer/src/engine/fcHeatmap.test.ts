/**
 * buildFcHeatmap: pivots a comparison result into a genes × (comparison × context) matrix of
 * log2FC, one column per vehicle-normalised / compared condition.
 */
import { describe, expect, it } from 'vitest'

import { buildFcHeatmap } from './plotData'
import type { CompareResultRow } from './types'

function row(uniqID: string, comparison: string, dose: number, log2FC: number): CompareResultRow {
  return {
    uniqID,
    cmpd: comparison.split(' | ')[0],
    dose,
    time: null,
    cmp_cond: 'cmpd',
    comparison,
    mean1: null,
    mean2: null,
    sd1: null,
    sd2: null,
    log2FC,
    pP: null,
    pQ: null,
    thrsh: '',
    signf: false,
    effect: 'none'
  }
}

describe('buildFcHeatmap', () => {
  // Two compounds vs DMSO, each at dose 5 and 10 → 4 comparison columns; two genes.
  const rows: CompareResultRow[] = [
    row('g1', 'drugA | DMSO', 5, 1.0),
    row('g1', 'drugA | DMSO', 10, 2.0),
    row('g1', 'drugB | DMSO', 5, -1.5),
    row('g2', 'drugA | DMSO', 5, 0.5),
    row('g2', 'drugB | DMSO', 10, 3.0)
  ]

  it('makes one column per comparison × context and one row per gene', () => {
    const h = buildFcHeatmap(rows, { displayMap: { g1: 'GeneOne', g2: 'GeneTwo' }, cluster: false })
    expect(h.columns).toEqual([
      'drugA | DMSO · dose=5',
      'drugA | DMSO · dose=10',
      'drugB | DMSO · dose=5',
      'drugB | DMSO · dose=10'
    ])
    expect(new Set(h.geneIds)).toEqual(new Set(['g1', 'g2']))
    expect(new Set(h.genes)).toEqual(new Set(['GeneOne', 'GeneTwo']))
  })

  it('places log2FC in the right cell and leaves missing cells null', () => {
    const h = buildFcHeatmap(rows, { cluster: false })
    const gi = h.geneIds.indexOf('g1')
    const ci = h.columns.indexOf('drugA | DMSO · dose=10')
    expect(h.z[gi][ci]).toBe(2.0)
    // g2 has no drugA·dose10 row → null
    const g2 = h.geneIds.indexOf('g2')
    expect(h.z[g2][ci]).toBeNull()
  })

  it('reports a symmetric colour limit = max |log2FC|', () => {
    const h = buildFcHeatmap(rows, { cluster: false })
    expect(h.absMax).toBe(3.0)
  })

  it('respects the focus-gene subset', () => {
    const h = buildFcHeatmap(rows, { focus: ['g2'], cluster: false })
    expect(h.geneIds).toEqual(['g2'])
  })
})
