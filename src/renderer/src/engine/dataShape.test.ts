import { describe, expect, it } from 'vitest'

import { analysisUnmet, dataShape, type DataShape } from './dataShape'
import type { ConditionKey, StandardRow } from './types'

const row = (p: Partial<StandardRow>): StandardRow => ({
  uniqID: 'g1',
  cell: 'A',
  cmpd: 'drug',
  dose: null,
  time: null,
  rep: null,
  value: 1,
  ...p
})

/** Every gene × dose × rep, as Clean data lays them out. */
const grid = (doses: number[], reps: number, genes = ['g1', 'g2']): StandardRow[] =>
  genes.flatMap((uniqID) =>
    doses.flatMap((dose) =>
      Array.from({ length: reps }, (_, i) => row({ uniqID, dose, rep: i + 1 }))
    )
  )

/** The verdicts, read both ways — off the sample list, and off the rows alone (a result saved
 *  before samples were kept) — which must agree. */
const unmet = (rows: StandardRow[], active: ConditionKey[]) => {
  const verdicts = (shape: DataShape) => ({
    t: analysisUnmet(shape, 'compare'),
    anova: analysisUnmet(shape, 'two_way_anova'),
    curve: analysisUnmet(shape, 'curve_fit')
  })
  const g = rows[0]?.uniqID
  const samples = rows
    .filter((r) => r.uniqID === g)
    .map((r, i) => ({
      sample: `s${i}`,
      cell: r.cell,
      cmpd: r.cmpd,
      dose: r.dose,
      time: r.time,
      rep: r.rep
    }))
  const fromRows = verdicts(dataShape({ rows, activeConditions: active }))
  expect(verdicts(dataShape({ rows, samples, activeConditions: active }))).toEqual(fromRows)
  return fromRows
}

describe('analysisUnmet (data shape gates the Compare analysis)', () => {
  it('replicated dose series: t-test and curve fit, but no second factor for an ANOVA', () => {
    const u = unmet(grid([0, 1, 10, 100], 3), ['cell', 'cmpd', 'dose'])
    expect(u.t).toBeNull()
    expect(u.curve).toBeNull()
    expect(u.anova).toMatch(/two conditions/)
  })

  it('one sample per group rules out the t-test and ANOVA, not a curve with enough doses', () => {
    const u = unmet(grid([0, 1, 3, 10, 30], 1), ['cell', 'cmpd', 'dose'])
    expect(u.t).toMatch(/replicates on both sides/)
    expect(u.curve).toBeNull()
  })

  it('replicates on one side only (a replicated control, single-sample treatments) ⇒ no t-test', () => {
    const rows = [
      ...[1, 2, 3, 4].map((rep) => row({ cmpd: 'DMSO', rep })),
      ...['a', 'b', 'c', 'd'].map((cmpd) => row({ cmpd, rep: 1 }))
    ]
    const u = unmet(rows, ['cell', 'cmpd'])
    expect(u.t).toMatch(/both sides/)
    expect(u.anova).not.toBeNull()
  })

  it('replicates are counted as samples per group, not read off the rep label', () => {
    // No rep given (ingest auto-numbers these; the shape doesn't depend on it either way).
    const rows = ['DMSO', 'drug'].flatMap((cmpd) => [0, 1, 2].map(() => row({ cmpd, rep: null })))
    expect(unmet(rows, ['cell', 'cmpd']).t).toBeNull()
  })

  it('a curve needs 4 points beyond the lowest dose', () => {
    expect(unmet(grid([0, 1, 10], 1), ['dose']).curve).toMatch(/at least 4 points/)
    // replicates count as points
    expect(unmet(grid([0, 1, 10], 2), ['dose']).curve).toBeNull()
  })

  it('no numeric condition ⇒ no curve fit', () => {
    const rows = ['A', 'B'].flatMap((cell) => [1, 2].map((rep) => row({ cell, rep })))
    const u = unmet(rows, ['cell', 'cmpd'])
    expect(u.t).toBeNull()
    expect(u.curve).toMatch(/numeric condition/)
  })

  it('two replicated factors allow the ANOVA', () => {
    const rows = ['A', 'B'].flatMap((cell) =>
      [0, 10].flatMap((dose) => [1, 2].map((rep) => row({ cell, dose, rep })))
    )
    expect(unmet(rows, ['cell', 'dose']).anova).toBeNull()
  })
})
