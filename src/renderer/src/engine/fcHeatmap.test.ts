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

  it('sets the colour range at the 99th percentile of |log2FC|, not at one extreme cell', () => {
    // 200 genes within ±2, one runaway at −19
    const many: CompareResultRow[] = []
    for (let i = 0; i < 200; i++) many.push(row(`g${i}`, 'drugA | DMSO', 5, ((i % 41) - 20) / 10))
    many.push(row('wild', 'drugA | DMSO', 5, -19))
    const h = buildFcHeatmap(many, { cluster: false })
    expect(h.absMax).toBe(19)
    expect(h.colorMax).toBe(2)
  })

  it('respects the focus-gene subset', () => {
    const h = buildFcHeatmap(rows, { focus: ['g2'], cluster: false })
    expect(h.geneIds).toEqual(['g2'])
  })
})

describe('buildFcHeatmap — few columns (a dose × time Curve fit: one per compound)', () => {
  // genes up strongly, up mildly, down — interleaved in the input
  const fc = [2.1, -1.9, 0.6, 2.0, -2.2, 0.5, 1.9, -2.0, 0.7]
  const surfaceRow = (i: number, cmpd: string, v: number): CompareResultRow => ({
    ...row(`g${i}`, `${cmpd} | DMSO`, 0, v),
    dose: null
  })
  const groupOf = (v: number): number => (v > 1.5 ? 0 : v < -1.5 ? 1 : 2)
  const contiguous = (ids: string[], value: (id: string) => number): boolean => {
    // each group's genes in one run (no group reappears after another started)
    const seen: number[] = []
    for (const id of ids) {
      const g = groupOf(value(id))
      if (seen[seen.length - 1] !== g) {
        if (seen.includes(g)) return false
        seen.push(g)
      }
    }
    return true
  }
  it('one column: genes clustered by their fold change', () => {
    const d = buildFcHeatmap(fc.map((v, i) => surfaceRow(i, 'A', v)))
    expect(contiguous(d.geneIds, (id) => fc[Number(id.slice(1))])).toBe(true)
  })
  it('two columns: clustered on the fold changes, not on their sign alone', () => {
    const rows = fc.flatMap((v, i) => [surfaceRow(i, 'A', v), surfaceRow(i, 'B', v + 0.1)])
    const d = buildFcHeatmap(rows)
    expect(contiguous(d.geneIds, (id) => fc[Number(id.slice(1))])).toBe(true)
  })
})

describe('buildFcHeatmap — clusters the fold-change patches', () => {
  it('keeps genes up under one compound apart from genes down under another', () => {
    // Four columns: A at two doses, then B at two doses. "upA" genes rise under A only, "dnB"
    // genes fall under B only — different patches, but the same shape once each gene's mean is
    // taken off ([+, +, −, −]). Magnitudes vary within each group; the input interleaves them.
    const cols = ['A | V · dose=5', 'A | V · dose=10', 'B | V · dose=5', 'B | V · dose=10']
    // a little measurement noise (seeded), the same size as the gap between the doses' changes
    let seed = 7
    const noise = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.2
    const upA = (k: number): number[] => [1 + 0.4 * k, 1 + 0.4 * k, 0, 0].map((v) => v + noise())
    const dnB = (k: number): number[] => [0, 0, -1 - 0.4 * k, -1 - 0.4 * k].map((v) => v + noise())
    const rows: CompareResultRow[] = []
    for (let k = 0; k < 6; k++)
      for (const [g, p] of [
        [`upA${k}`, upA(k)],
        [`dnB${k}`, dnB(k)]
      ] as Array<[string, number[]]>)
        p.forEach((v, ci) => rows.push({ ...row(g, cols[ci], 0, v), dose: null }))
    const d = buildFcHeatmap(rows)
    const runs = d.geneIds.map((g) => (g.startsWith('up') ? 'u' : 'd')).join('')
    // one run of each group
    expect(runs).toMatch(/^(u{6}d{6}|d{6}u{6})$/)
  })

  it('keeps the near-zero genes in one block, not scattered through the strong ones', () => {
    // up under A, down under B, and genes barely changed anywhere (a faint wobble of either sign)
    const cols = ['A | V · dose=5', 'A | V · dose=10', 'B | V · dose=5', 'B | V · dose=10']
    let seed = 3
    const noise = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.3
    const prof: Record<string, (k: number) => number[]> = {
      u: (k) => [1.5 + 0.3 * k, 1.5 + 0.3 * k, 0, 0],
      d: (k) => [0, 0, -1.5 - 0.3 * k, -1.5 - 0.3 * k],
      w: () => [0, 0, 0, 0]
    }
    const rows: CompareResultRow[] = []
    for (let k = 0; k < 8; k++)
      for (const g of ['u', 'd', 'w'])
        prof[g](k).forEach((v, ci) =>
          rows.push({ ...row(`${g}${k}`, cols[ci], 0, v + noise()), dose: null })
        )
    const runs = buildFcHeatmap(rows)
      .geneIds.map((g) => g[0])
      .join('')
      .replace(/(.)\1*/g, '$1')
    // each group one run, ordered by mean fold change: down, near-zero, up
    expect(runs).toBe('dwu')
  })
})
