/** The 2-way ANOVA's plot data: the slice for a context, the shares, and the interaction profile's
 *  cell means (the model's fit — here the cell means themselves) and replicates, on the plot scale. */
import { describe, expect, it } from 'vitest'

import { anovaSliceFor, geneShares, interactionGene, rankByQ } from './anovaPlots'
import { runFactorAnova } from './twoWay'
import type { StandardRow } from './types'

// cmpd A / DMSO × cell M / W at doses 1 and 10 (DMSO only at dose 0: it serves both), 3 replicates
const rows: StandardRow[] = []
const lv: Record<string, number> = { 'A,M': 12, 'A,W': 10, 'DMSO,M': 10, 'DMSO,W': 10 }
for (const g of ['g1', 'g2', 'g3', 'g4'])
  for (const [k, base] of Object.entries(lv)) {
    const [cmpd, cell] = k.split(',')
    const doses = cmpd === 'DMSO' ? [0] : [1, 10]
    for (const dose of doses)
      for (let rep = 0; rep < 3; rep++)
        rows.push({
          uniqID: g,
          cell,
          cmpd,
          dose,
          time: null,
          rep,
          // g1 carries the interaction (A in M only) and a dose step (+1 on A at dose 10); the rest
          // are flat, with replicate scatter
          value: 2 ** ((g === 'g1' ? base + (dose === 10 ? 1 : 0) : 10) + (rep - 1) * 0.1)
        })
  }
const res = runFactorAnova({
  rows,
  factors: [
    { condition: 'cmpd', pairs: [['A', 'DMSO']] },
    { condition: 'cell', pairs: [['M', 'W']] }
  ],
  activeConditions: ['cmpd', 'cell', 'dose'],
  variance: 'plain'
})
const a = res.anova!

describe('anova plot data', () => {
  it('picks the slice of the facet’s context', () => {
    expect(a.slices).toHaveLength(2)
    const at10 = res.rows.find((r) => r.term && r.dose === 10)!
    expect(anovaSliceFor(a, at10)!.context).toEqual([['dose', 10]])
    expect(anovaSliceFor(a)).toBe(a.slices[0])
  })
  it('shares: per factor, the residual what they leave', () => {
    const s = geneShares(a.slices[0].genes.find((g) => g.uniqID === 'g1')!)
    expect(s.shares).toHaveLength(3)
    expect(s.residual).toBeCloseTo(1 - s.shares.reduce((x, y) => x + y, 0), 12)
    expect(s.residual).toBeGreaterThanOrEqual(0)
  })
  it('ranks by the interaction’s q: the interacting gene first', () => {
    expect(rankByQ(a.slices[0].genes, 2)[0].uniqID).toBe('g1')
  })
  it('the interaction profile: the cell means on the plot scale, the replicates at their context', () => {
    const slice = anovaSliceFor(
      a,
      res.rows.find((r) => r.term && r.dose === 10)
    )!
    const g1 = slice.genes.find((g) => g.uniqID === 'g1')!
    // x = cmpd (A, DMSO), lines = cell (M, W); log₂ model → log₁₀ plot
    const p = interactionGene(a, slice, g1, { x: 0, line: 1 }, 'log10', rows)
    const l10 = (v: number): number => v * Math.log10(2)
    expect(p.means[0][0]).toBeCloseTo(l10(13), 9) // A·M at dose 10: 12 + 1
    expect(p.means[1][0]).toBeCloseTo(l10(11), 9) // A·W at dose 10: 10 + 1
    expect(p.means[0][1]).toBeCloseTo(l10(10), 9) // DMSO·M
    // replicates: A·M's three at dose 10 (not dose 1's); DMSO's three at dose 0 serve this slice
    expect(p.reps[0][0]).toHaveLength(3)
    expect(Math.max(...p.reps[0][0])).toBeCloseTo(l10(13.1), 9)
    expect(p.reps[0][1]).toHaveLength(3)
    // each mean's standard error: √(residual variance / n), n = 3 here, on the plot scale
    const se = Math.sqrt(g1.s2Post / 3)
    expect(g1.cellN).toEqual(slice.cells.map(() => 3))
    expect(p.lo[0][0]).toBeCloseTo(l10(13 - se), 9)
    expect(p.hi[0][0]).toBeCloseTo(l10(13 + se), 9)
    // x = cell instead: the lines are the compounds
    const q = interactionGene(a, slice, g1, { x: 1, line: 0 }, 'log2', rows)
    expect(q.means[0][0]).toBeCloseTo(13, 9) // line A, x M
    expect(q.means[0][1]).toBeCloseTo(11, 9) // line A, x W
  })
})
