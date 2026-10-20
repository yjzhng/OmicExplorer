/**
 * The Compare's ANOVA beyond two factors: a one-way model (overall rows = each test level against
 * the control, contrasts of the model), a three-way one (overall rows = the 2×2×2 interaction, the
 * full factorial with no cap), the preview's nested-design caution, and the interaction plot's
 * averaging over a third factor.
 */
import { describe, expect, it } from 'vitest'

import { interactionAxes, interactionGene } from './anovaPlots'
import { fSurvival } from './curveFit'
import { studentTTwoSided } from './stats'
import { previewFactorAnova, runFactorAnova } from './twoWay'
import { isInteractionRow, isTermRow, termless, type StandardRow } from './types'

const row = (
  uniqID: string,
  c: { cell?: string; cmpd?: string; dose?: number | null; time?: number | null },
  rep: number,
  log2: number
): StandardRow => ({
  uniqID,
  cell: c.cell ?? '',
  cmpd: c.cmpd ?? '',
  dose: c.dose ?? null,
  time: c.time ?? null,
  rep,
  value: 2 ** log2
})

describe('one-way ANOVA (cmpd: A, B vs DMSO)', () => {
  // log₂ means DMSO 10, A 11, B 13; replicates ±0.5 around them (3 each)
  const means: Record<string, number> = { DMSO: 10, A: 11, B: 13 }
  const dev = [-0.5, 0, 0.5]
  const rows = Object.entries(means).flatMap(([cmpd, m]) =>
    dev.map((d, i) => row('g1', { cmpd }, i + 1, m + d))
  )
  const res = runFactorAnova({
    rows,
    factors: [
      {
        condition: 'cmpd',
        pairs: [
          ['A', 'DMSO'],
          ['B', 'DMSO']
        ]
      }
    ],
    activeConditions: ['cmpd'],
    variance: 'plain'
  })
  // pooled residual variance: each group's SS 0.5, 3 groups → 1.5 on 6 df
  const s2 = 1.5 / 6

  it('labels the overall rows as the t-test does, then the factor', () => {
    expect(res.comparisons).toEqual(['A | DMSO', 'B | DMSO', 'cmpd'])
    expect(res.rows.every((r) => r.cmp_cond === 'cmpd')).toBe(true)
    expect(res.rows.some(isInteractionRow)).toBe(false)
  })
  it('tests each level against the control on the pooled variance (all three groups)', () => {
    const b = termless(res.rows).find((r) => r.comparison === 'B | DMSO')!
    const se = Math.sqrt(s2 * (2 / 3))
    expect(b.log2FC).toBeCloseTo(3, 12)
    expect(b.fcSE).toBeCloseTo(se, 12)
    expect(b.pP).toBeCloseTo(-Math.log10(studentTTwoSided(3 / se, 6)), 10)
    expect(b.cmpd).toBe('B')
  })
  it('gives the classic one-way F', () => {
    const t = res.rows.find(isTermRow)!
    const grand = (10 + 11 + 13) / 3
    const ssb = 3 * Object.values(means).reduce((a, m) => a + (m - grand) ** 2, 0)
    const F = ssb / 2 / s2
    expect(t.ftest!.F).toBeCloseTo(F, 9)
    expect([t.ftest!.df1, t.ftest!.df2]).toEqual([2, 6])
    expect(t.pP).toBeCloseTo(-Math.log10(fSurvival(F, 2, 6)), 9)
  })
})

describe('three-way ANOVA (cmpd × cell × time, 2×2×2)', () => {
  // log₂ cell means: 10 everywhere but A·M·t2 = 14, A·M·t1 = 11 (3 replicates, ±0.1)
  const mean = (cmpd: string, cell: string, time: number): number =>
    cmpd === 'A' && cell === 'M' ? (time === 2 ? 14 : 11) : 10
  const rows: StandardRow[] = []
  for (const cmpd of ['A', 'DMSO'])
    for (const cell of ['M', 'W'])
      for (const time of [1, 2])
        [-0.1, 0, 0.1].forEach((d, i) =>
          rows.push(row('g1', { cmpd, cell, time }, i + 1, mean(cmpd, cell, time) + d))
        )
  const res = runFactorAnova({
    rows,
    factors: [
      { condition: 'cmpd', pairs: [['A', 'DMSO']] },
      { condition: 'cell', pairs: [['M', 'W']] },
      { condition: 'time', pairs: [['2', '1']] }
    ],
    activeConditions: ['cmpd', 'cell', 'time'],
    variance: 'plain'
  })

  it('fits the full factorial: 7 terms, the three-way included', () => {
    expect(res.anova!.maxOrder).toBe(3)
    expect(res.anova!.terms.map((t) => t.label)).toEqual([
      'cmpd',
      'cell',
      'time',
      'cmpd × cell',
      'cmpd × time',
      'cell × time',
      'cmpd × cell × time'
    ])
  })
  it('one overall row: the 2×2×2 interaction', () => {
    const o = termless(res.rows)
    expect(o).toHaveLength(1)
    expect(o[0].comparison).toBe('A|DMSO × M|W × 2|1')
    expect(o[0].cmp_cond).toBe('cmpd:cell:time')
    expect(isInteractionRow(o[0])).toBe(true)
    // (A·M·t2 − A·W·t2 − D·M·t2 + D·W·t2) − (the same at t1) = (14 − 10) − (11 − 10)
    expect(o[0].log2FC).toBeCloseTo(3, 9)
    expect(o[0].ftest!.df1).toBe(1)
  })
})

describe('the preview', () => {
  // cmpd × dose with the vehicle only at dose 0: nested (DMSO@0, A@1, A@10)
  const nested: StandardRow[] = [
    ...[1, 2].map((rep) => row('g1', { cmpd: 'DMSO', dose: 0 }, rep, 10)),
    ...[1, 2].map((rep) => row('g1', { cmpd: 'A', dose: 1 }, rep, 11)),
    ...[1, 2].map((rep) => row('g1', { cmpd: 'A', dose: 10 }, rep, 12))
  ]
  it('cautions on a nested design, naming what it can’t test', () => {
    const pv = previewFactorAnova({
      rows: nested,
      factors: [
        { condition: 'cmpd', pairs: [['A', 'DMSO']] },
        {
          condition: 'dose',
          pairs: [
            ['1', '0'],
            ['10', '0']
          ]
        }
      ],
      activeConditions: ['cmpd', 'dose']
    })
    expect(pv.warnings).toEqual([])
    expect(pv.cautions[0]).toMatch(/^Nested design: cmpd, cmpd × dose can’t be told apart/)
    expect(pv.tested).toEqual(['dose'])
    expect(pv.rows).toEqual([])
  })
  it('lists a one-way’s comparisons, one per level against the control', () => {
    const pv = previewFactorAnova({
      rows: nested,
      factors: [
        {
          condition: 'dose',
          pairs: [
            ['1', '0'],
            ['10', '0']
          ]
        }
      ],
      activeConditions: ['cmpd', 'dose']
    })
    expect(pv.columns).toEqual(['comparison', 'cmpd'])
    expect(pv.rows.map((r) => r[0])).toEqual(['1 | 0', '10 | 0'])
    expect(pv.cautions).toEqual([])
    expect(pv.tested).toEqual(['dose'])
  })
})

describe('the interaction plot over three factors', () => {
  // log₂ 10 + 2·[cmpd A] + 1·[time 2] + 0.5·[cell W], 2 replicates (exact)
  const rows: StandardRow[] = []
  for (const cmpd of ['A', 'DMSO'])
    for (const cell of ['M', 'W'])
      for (const time of [1, 2])
        for (const rep of [1, 2])
          rows.push(
            row(
              'g1',
              { cmpd, cell, time },
              rep,
              10 + (cmpd === 'A' ? 2 : 0) + (time === 2 ? 1 : 0) + (cell === 'W' ? 0.5 : 0)
            )
          )
  const res = runFactorAnova({
    rows,
    factors: [
      { condition: 'cmpd', pairs: [['A', 'DMSO']] },
      { condition: 'cell', pairs: [['M', 'W']] },
      { condition: 'time', pairs: [['2', '1']] }
    ],
    activeConditions: ['cmpd', 'cell', 'time']
  })
  const a = res.anova!
  it('picks x and the lines, defaulting to the first two', () => {
    expect(interactionAxes(a)).toEqual({ x: 0, line: 1 })
    expect(interactionAxes(a, 'time', 'cmpd')).toEqual({ x: 2, line: 0 })
    // a line factor equal to x falls back to the first other
    expect(interactionAxes(a, 'cell', 'cell')).toEqual({ x: 1, line: 0 })
    expect(interactionAxes({ factors: [a.factors[0]] })).toEqual({ x: 0, line: null })
  })
  it('averages the third factor: the marginal means, the replicates pooled', () => {
    const slice = a.slices[0]
    const g = slice.genes[0]
    // x = time (2, 1), lines = cmpd (A, DMSO); cell averaged (+0.25)
    const p = interactionGene(a, slice, g, { x: 2, line: 0 }, 'log2', rows)
    expect(p.means[0][0]).toBeCloseTo(13.25, 9) // A at time 2
    expect(p.means[1][1]).toBeCloseTo(10.25, 9) // DMSO at time 1
    expect(p.reps[0][0]).toHaveLength(4) // both cells' replicates
  })
})

describe('a numeric condition as a slope', () => {
  // log₂ = 10 + β · x, x = log₁₀ dose; dose 0 one decade below 1 (x = −1); ±0.1 replicates
  const at = (dose: number): number => (dose > 0 ? Math.log10(dose) : -1)
  const dev = [-0.1, 0, 0.1]
  const doses = [0, 1, 10, 100]

  it('places a 0 one step below the lowest level on a log axis', async () => {
    const { slopePositions } = await import('./twoWay')
    expect(slopePositions(['0', '1', '10', '100'], 'log')).toEqual([-1, 0, 1, 2])
    expect(slopePositions(['0', '2', '4'], 'linear')).toEqual([0, 2, 4])
  })

  it('alone: one row, its change per decade; one df', () => {
    const rows = doses.flatMap((dose) =>
      dev.map((d, i) => row('g1', { dose }, i + 1, 10 + 0.5 * at(dose) + d))
    )
    const res = runFactorAnova({
      rows,
      factors: [
        { condition: 'dose', pairs: doses.slice(1).map((d) => [String(d), '0']), slope: 'log' }
      ],
      activeConditions: ['dose'],
      variance: 'plain'
    })
    expect(res.comparisons).toEqual(['dose slope', 'dose'])
    const o = termless(res.rows)
    expect(o).toHaveLength(1)
    expect(o[0].slope).toBe(true)
    expect(o[0].log2FC).toBeCloseTo(0.5, 9)
    expect(res.rows.find(isTermRow)!.ftest!.df1).toBe(1)
  })

  it('with a crossed factor: the difference of its slopes', () => {
    const rows = ['M', 'W'].flatMap((cell) =>
      doses.flatMap((dose) =>
        dev.map((d, i) =>
          row('g1', { cell, dose }, i + 1, 10 + (cell === 'M' ? 1 : 0.2) * at(dose) + d)
        )
      )
    )
    const res = runFactorAnova({
      rows,
      factors: [
        { condition: 'cell', pairs: [['M', 'W']] },
        { condition: 'dose', pairs: doses.slice(1).map((d) => [String(d), '0']), slope: 'log' }
      ],
      activeConditions: ['cell', 'dose'],
      variance: 'plain'
    })
    const o = termless(res.rows)
    expect(o.map((r) => r.comparison)).toEqual(['M|W × dose slope'])
    expect(o[0].log2FC).toBeCloseTo(0.8, 9)
    expect(isInteractionRow(o[0])).toBe(false)
    expect(res.anova!.terms.map((t) => t.label)).toEqual(['cell', 'dose', 'cell × dose'])
  })

  it('the vehicle design: a shared baseline, a slope per compound from it, no cmpd term', () => {
    const slope: Record<string, number> = { A: 1, B: 0.3 }
    const rows = [
      ...dev.map((d, i) => row('g1', { cmpd: 'DMSO', dose: 0 }, i + 1, 10 + d)),
      ...['A', 'B'].flatMap((cmpd) =>
        [1, 10, 100].flatMap((dose) =>
          dev.map((d, i) => row('g1', { cmpd, dose }, i + 1, 10 + slope[cmpd] * (at(dose) + 1) + d))
        )
      )
    ]
    const input = {
      rows,
      factors: [
        {
          condition: 'cmpd' as const,
          pairs: [
            ['A', 'DMSO'],
            ['B', 'DMSO']
          ] as Array<[string, string]>
        },
        {
          condition: 'dose' as const,
          pairs: ['1', '10', '100'].map((d) => [d, '0']) as Array<[string, string]>,
          slope: 'log' as const
        }
      ],
      activeConditions: ['cmpd', 'dose'] as Array<'cmpd' | 'dose'>,
      variance: 'plain' as const
    }
    const res = runFactorAnova(input)
    expect(res.anova!.sharedBaseline).toEqual({ factor: 0, slope: 1, control: 'DMSO' })
    expect(res.anova!.terms.map((t) => t.label)).toEqual(['dose', 'cmpd × dose'])
    const o = termless(res.rows)
    expect(o.map((r) => r.comparison)).toEqual(['A|DMSO × dose slope', 'B|DMSO × dose slope'])
    expect(o[0].log2FC).toBeCloseTo(1, 9)
    expect(o[1].log2FC).toBeCloseTo(0.3, 9)
    // the compounds' slopes differ: one df
    const ix = res.rows.find((r) => isTermRow(r) && r.comparison === 'cmpd × dose')!
    expect(ix.ftest!.df1).toBe(1)
    const pv = previewFactorAnova(input)
    expect(pv.cautions).toEqual([])
    expect(pv.notes[0]).toMatch(/^Vehicle design: DMSO only at the lowest dose/)
    expect(pv.rows.map((r) => r[0])).toEqual(['A|DMSO × dose slope', 'B|DMSO × dose slope'])
  })
})

describe('the interaction plot with a slope', () => {
  it('places the slope’s levels on its axis; the vehicle starts every compound’s line', () => {
    const rows = [
      ...[1, 2].map((rep) => row('g1', { cmpd: 'DMSO', dose: 0 }, rep, 10)),
      ...[1, 10].flatMap((dose) =>
        [1, 2].map((rep) => row('g1', { cmpd: 'A', dose }, rep, 10 + (Math.log10(dose) + 1)))
      )
    ]
    const res = runFactorAnova({
      rows,
      factors: [
        { condition: 'cmpd', pairs: [['A', 'DMSO']] },
        {
          condition: 'dose',
          pairs: [
            ['1', '0'],
            ['10', '0']
          ],
          slope: 'log'
        }
      ],
      activeConditions: ['cmpd', 'dose']
    })
    const a = res.anova!
    const slice = a.slices[0]
    // x = dose (levels 1, 10, 0), lines = cmpd (A, DMSO)
    const p = interactionGene(a, slice, slice.genes[0], { x: 1, line: 0 }, 'log2', rows)
    expect(p.xPositions).toEqual([0, 1, -1])
    expect(p.means[0][2]).toBeCloseTo(10, 9) // A's line from the vehicle at dose 0
    expect(p.means[0][1]).toBeCloseTo(12, 9) // A at dose 10
    expect(p.reps[0][2]).toHaveLength(0) // the vehicle's replicates stay on its own line
  })
})
