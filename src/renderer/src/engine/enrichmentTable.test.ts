/** Enrichment as a table for the temp export: every facet, every tested term. */
import { describe, expect, it } from 'vitest'

import { enrichmentTable } from './plotData'
import type { CompareResultRow } from './types'

// 40 genes; the first 10 share "pathway A" and are strongly up at both doses.
const genes = Array.from({ length: 40 }, (_, i) => `g${i}`)
const ann = Object.fromEntries(
  genes.map((g, i) => [g, { GO_BP: i < 10 ? 'pathway A' : i < 25 ? 'pathway B' : 'pathway C' }])
)
const row = (uniqID: string, dose: number, log2FC: number): CompareResultRow => ({
  uniqID,
  cmpd: 'X',
  dose,
  time: null,
  comparison: 'X | DMSO',
  mean1: null,
  mean2: null,
  sd1: null,
  sd2: null,
  log2FC,
  pP: 0.5,
  pQ: 0.5,
  thrsh: '',
  signf: false,
  effect: 'none'
})
const rows = [1, 10].flatMap((dose) =>
  genes.map((g, i) => row(g, dose, i < 10 ? 3 + i / 10 : Math.sin(i) * 0.5))
)

describe('enrichmentTable', () => {
  it('covers every facet, labelling each row with it', () => {
    const t = enrichmentTable(rows, { method: 'gsea', source: 'go', annotationMap: ann })
    const facets = new Set(t.map((r) => r.facet))
    expect(facets).toEqual(new Set(['cmpd=X · dose=1', 'cmpd=X · dose=10']))
    const a = t.filter((r) => r.term === 'pathway A')
    expect(a).toHaveLength(2) // once per facet
    expect(a.every((r) => r.direction === 'up' && typeof r.NES === 'number')).toBe(true)
  })

  it('labels one already-split facet as given', () => {
    const t = enrichmentTable(
      rows.filter((r) => r.dose === 1),
      { method: 'gsea', source: 'go', annotationMap: ann },
      'dose=1'
    )
    expect(new Set(t.map((r) => r.facet))).toEqual(new Set(['dose=1']))
  })
})
