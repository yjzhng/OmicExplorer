import { describe, it, expect } from 'vitest'
import { buildDR, buildBubble } from './plotData'
import type { CompareResultRow } from './types'

/** N genes × D doses of compare rows (uniqID g0..g{N-1}), so per-gene plots have N genes. */
function rows(nGenes: number, doses = [2.5, 5, 10]): CompareResultRow[] {
  const out: CompareResultRow[] = []
  for (let g = 0; g < nGenes; g++) {
    for (const dose of doses) {
      out.push({
        uniqID: `g${g}`,
        cmpd: 'Amk',
        dose,
        time: null,
        cmp_cond: 'cmpd',
        comparison: 'Amk | H2O',
        mean1: 1,
        mean2: 1,
        sd1: 0,
        sd2: 0,
        log2FC: (g % 7) - 3 + dose / 10, // varied so ranking/curves are non-trivial
        pP: 1,
        pQ: 1,
        thrsh: '',
        signf: false,
        effect: 'none'
      })
    }
  }
  return out
}

describe('per-gene plot render caps (freeze fix)', () => {
  it('DR keeps every gene but highlights none by default (one merged trace)', () => {
    const dr = buildDR(rows(500), { axis: 'dose', topGenes: 0 })
    expect(dr.series.length).toBe(500) // all genes present (drawn as faint background)
    expect(dr.total).toBe(500)
    expect(dr.highlight).toBe(0) // nothing colored → 1 background trace, no explosion
  })

  it('DR highlight count follows explicit topGenes', () => {
    expect(buildDR(rows(500), { axis: 'dose', topGenes: 12 }).highlight).toBe(12)
  })

  it('bubble caps genes at 100 when topGenes=0, and the explicit N overrides', () => {
    const capped = buildBubble(rows(500), { axis: 'dose', topGenes: 0 })
    expect(capped.genes.length).toBe(100)
    expect(capped.total).toBe(500)
    expect(buildBubble(rows(500), { axis: 'dose', topGenes: 250 }).genes.length).toBe(250)
  })

  it('small gene sets are unaffected by the cap', () => {
    expect(buildBubble(rows(20), { axis: 'dose', topGenes: 0 }).genes.length).toBe(20)
    expect(buildDR(rows(20), { axis: 'dose', topGenes: 0 }).series.length).toBe(20)
  })
})
