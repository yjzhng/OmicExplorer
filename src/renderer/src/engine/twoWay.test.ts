/**
 * Two-way ANOVA interaction test. The symmetric case is hand-checkable: under the former Welch
 * test a single df makes the t-tail a Cauchy; under the model (plain variance) the residual
 * variance pools all four cells, df = n − 4. The asymmetric case checks vehicle dose-exclusion cell
 * assembly.
 */
import { describe, expect, it } from 'vitest'

import { fSurvival } from './curveFit'
import { studentTTwoSided } from './stats'
import {
  missingCombinations,
  previewFactorAnova,
  runFactorAnova,
  type AnovaFactorPick
} from './twoWay'
import { isTermRow, termless, type ConditionKey, type StandardRow } from './types'

function r(
  uniqID: string,
  cell: string,
  cmpd: string,
  dose: number | null,
  time: number | null,
  rep: number,
  value: number
): StandardRow {
  return { uniqID, cell, cmpd, dose, time, rep, value }
}

describe('runFactorAnova — symmetric (cell × time)', () => {
  // interaction = mean(M,t1) − mean(M,t2) − mean(W,t1) + mean(W,t2), in log2.
  // M,t1: log2{3,4} mean 3.5 (var 0.5) ; the other three cells are flat at log2 2.
  // ⇒ interaction = 3.5 − 2 − 2 + 2 = 1.5 ; se = sqrt(0.5/2) = 0.5 ; df = 1 ; t = 3.
  const rows: StandardRow[] = [
    r('g1', 'M', '', null, 1, 1, 8),
    r('g1', 'M', '', null, 1, 2, 16),
    r('g1', 'M', '', null, 2, 1, 4),
    r('g1', 'M', '', null, 2, 2, 4),
    r('g1', 'W', '', null, 1, 1, 4),
    r('g1', 'W', '', null, 1, 2, 4),
    r('g1', 'W', '', null, 2, 1, 4),
    r('g1', 'W', '', null, 2, 2, 4)
  ]

  const res = runFactorAnova({
    rows,
    factors: [
      { condition: 'cell', pairs: [['M', 'W']] },
      { condition: 'time', pairs: [['1', '2']] }
    ],
    activeConditions: ['cell', 'time']
  })

  it('labels the comparison and cmp_cond; the model’s terms follow as their own rows', () => {
    expect(res.comparisons).toEqual(['M|W × 1|2', 'cell', 'time', 'cell × time'])
    expect(termless(res.rows)).toHaveLength(1)
    expect(res.rows[0].cmp_cond).toBe('cell:time')
    const terms = res.rows.filter(isTermRow)
    expect(terms.map((r) => r.comparison)).toEqual(['cell', 'time', 'cell × time'])
    // the same cmp_cond (so its factors don't become facets), no factor values, df 1 each
    for (const t of terms) {
      expect(t.cmp_cond).toBe('cell:time')
      expect(t.cell == null || t.cell === '').toBe(true)
      expect(t.ftest!.df1).toBe(1)
      expect(t.log2FC!).toBeGreaterThanOrEqual(0)
    }
  })

  it('computes the interaction log2FC', () => {
    expect(Math.abs((res.rows[0].log2FC as number) - 1.5)).toBeLessThan(1e-9)
  })

  it('matches the exact df=1 (Cauchy) two-sided p-value under the former Welch test', () => {
    // p = 1 − 2·atan(t)/π for df=1, t=3 → pP = −log10(p)
    const welch = runFactorAnova({
      rows,
      factors: [
        { condition: 'cell', pairs: [['M', 'W']] },
        { condition: 'time', pairs: [['1', '2']] }
      ],
      activeConditions: ['cell', 'time'],
      variance: 'welch'
    })
    const pExpected = 1 - (2 * Math.atan(3)) / Math.PI
    const pP = -Math.log10(pExpected)
    expect(Math.abs((welch.rows[0].pP as number) - pP)).toBeLessThan(1e-9)
  })

  it('tests on the model’s pooled residual variance (plain): s² = 0.5/4, se = √(s²·4/2), df 4', () => {
    const plain = runFactorAnova({
      rows,
      factors: [
        { condition: 'cell', pairs: [['M', 'W']] },
        { condition: 'time', pairs: [['1', '2']] }
      ],
      activeConditions: ['cell', 'time'],
      variance: 'plain'
    })
    const se = Math.sqrt((0.5 / 4) * 2)
    expect(plain.rows[0].fcSE).toBeCloseTo(se, 12)
    expect(plain.rows[0].pP).toBeCloseTo(-Math.log10(studentTTwoSided(1.5 / se, 4)), 10)
    // its F-test: the one-df contrast as F = t² on (1, 4) — the same test, the same p
    const ft = plain.rows[0].ftest!
    expect(ft.F).toBeCloseTo((1.5 / se) ** 2, 10)
    expect([ft.df1, ft.df2]).toEqual([1, 4])
    expect(-Math.log10(fSurvival(ft.F, 1, 4))).toBeCloseTo(plain.rows[0].pP as number, 10)
  })
})

describe('runFactorAnova — asymmetric (cmpd × cell, vehicle dose-excluded)', () => {
  // Treatment A at dose 1; vehicle DMSO at dose 0 (matched with dose excluded).
  // interaction = mean(A,M) − mean(A,W) − mean(DMSO,M) + mean(DMSO,W), log2.
  // = 4 − 2 − 2 + 2 = 2.
  const rows: StandardRow[] = [
    r('g1', 'M', 'A', 1, null, 1, 16),
    r('g1', 'M', 'A', 1, null, 2, 16),
    r('g1', 'W', 'A', 1, null, 1, 4),
    r('g1', 'W', 'A', 1, null, 2, 4),
    r('g1', 'M', 'DMSO', 0, null, 1, 4),
    r('g1', 'M', 'DMSO', 0, null, 2, 4),
    r('g1', 'W', 'DMSO', 0, null, 1, 4),
    r('g1', 'W', 'DMSO', 0, null, 2, 4)
  ]

  const res = runFactorAnova({
    rows,
    factors: [
      { condition: 'cmpd', pairs: [['A', 'DMSO']] },
      { condition: 'cell', pairs: [['M', 'W']] }
    ],
    activeConditions: ['cmpd', 'cell', 'dose']
  })

  it('assembles cells with vehicle dose-exclusion and reports the interaction', () => {
    expect(res.comparisons[0]).toBe('A|DMSO × M|W')
    expect(termless(res.rows)).toHaveLength(1)
    const row = res.rows[0]
    expect(row.cmp_cond).toBe('cmpd:cell')
    expect(row.dose).toBe(1) // treatment-side dose context preserved
    expect(Math.abs((row.log2FC as number) - 2)).toBeLessThan(1e-9)
  })
})

describe('runFactorAnova — on Clean data’s scale', () => {
  // 3 replicates per cell, linear values; cell means 10/20 (M) and 10/10 (W) at t1/t2
  const lin: Record<string, number[]> = {
    'M,1': [9, 10, 11],
    'M,2': [18, 20, 22],
    'W,1': [9.5, 10, 10.5],
    'W,2': [9, 10, 11]
  }
  const rows = Object.entries(lin).flatMap(([k, vs]) => {
    const [cell, time] = k.split(',')
    return vs.map((v, i) => r('g1', cell, '', null, Number(time), i + 1, v))
  })
  const run = (transform: boolean) =>
    runFactorAnova({
      rows,
      factors: [
        { condition: 'cell', pairs: [['M', 'W']] },
        { condition: 'time', pairs: [['2', '1']] }
      ],
      activeConditions: ['cell', 'time'],
      variance: 'plain',
      transform
    })
  const m = (k: string): number => lin[k].reduce((s, v) => s + v, 0) / 3
  const ss = Object.values(lin).reduce((s, vs) => {
    const mu = vs.reduce((a, v) => a + v, 0) / vs.length
    return s + vs.reduce((a, v) => a + (v - mu) ** 2, 0)
  }, 0)

  it('linear: tests the linear interaction; its fold change is the log₂ ratio of the cell means', () => {
    const row = run(false).rows[0]
    const s2 = ss / 8
    const est = m('M,2') - m('M,1') - m('W,2') + m('W,1')
    const se = Math.sqrt((s2 * 4) / 3)
    expect(row.pP).toBeCloseTo(-Math.log10(studentTTwoSided(est / se, 8)), 10)
    expect(row.log2FC).toBeCloseTo(Math.log2((m('M,2') * m('W,1')) / (m('M,1') * m('W,2'))), 12)
    // delta method: Var(log₂ m) = Var(m) / (m ln 2)², each cell mean's variance s²/3
    const fcSE = Math.sqrt(
      ['M,2', 'M,1', 'W,2', 'W,1'].reduce((a, k) => a + s2 / 3 / (m(k) * Math.LN2) ** 2, 0)
    )
    expect(row.fcSE).toBeCloseTo(fcSE, 12)
  })
  it('logged: on log₂ values (a different test from the linear one)', () => {
    const logged = run(true).rows[0]
    const lm = (k: string): number => lin[k].reduce((s, v) => s + Math.log2(v), 0) / 3
    expect(logged.log2FC).toBeCloseTo(lm('M,2') - lm('M,1') - lm('W,2') + lm('W,1'), 12)
    expect(logged.pP).not.toBeCloseTo(run(false).rows[0].pP as number, 3)
  })
  it('linear: a term row’s effect size is on log₂ (the log₂ cell means decomposed)', () => {
    const row = run(false).rows.find((x) => x.comparison === 'cell × time')!
    // balanced 2×2: the interaction contribution is ±¼ of the log₂ interaction in every cell
    const li = Math.log2((m('M,2') * m('W,1')) / (m('M,1') * m('W,2')))
    expect(row.log2FC).toBeCloseTo(Math.abs(li) / 4, 12)
  })
  it('keeps the model with the result: its terms, scale and per-gene fits', () => {
    const a = run(false).anova!
    expect(a.scale).toBe('linear')
    expect(a.terms.map((t) => t.label)).toEqual(['cell', 'time', 'cell × time'])
    const g = a.slices[0].genes[0]
    expect(g.uniqID).toBe('g1')
    expect(g.df).toEqual([1, 1, 1])
    // the interaction's F is the 2×2 contrast's t² (balanced, one df)
    const est = m('M,2') - m('M,1') - m('W,2') + m('W,1')
    expect(g.F[2]).toBeCloseTo(est ** 2 / ((ss / 8) * (4 / 3)), 8)
  })
})

describe('previewFactorAnova — a design not fully crossed', () => {
  // cmpd A / DMSO × dose 10 / 0, but DMSO only at dose 0: nested, not crossed
  const rows: StandardRow[] = [
    r('g1', 'M', 'A', 10, null, 1, 8),
    r('g1', 'M', 'A', 10, null, 2, 9),
    r('g1', 'M', 'A', 0, null, 1, 4),
    r('g1', 'M', 'A', 0, null, 2, 5),
    r('g1', 'M', 'DMSO', 0, null, 1, 4),
    r('g1', 'M', 'DMSO', 0, null, 2, 4)
  ]
  const input = {
    rows,
    factors: [
      { condition: 'cmpd' as const, pairs: [['A', 'DMSO']] as Array<[string, string]> },
      { condition: 'dose' as const, pairs: [['10', '0']] as Array<[string, string]> }
    ] as [AnovaFactorPick, AnovaFactorPick],
    activeConditions: ['cmpd', 'dose'] as ConditionKey[]
  }
  it('names the missing combination, in a note (not a blocking warning)', () => {
    expect(missingCombinations(input)).toEqual(['DMSO · 10'])
    const pv = previewFactorAnova(input)
    expect(pv.notes[0]).toBe('Full condition matrix not complete — no samples at DMSO · 10')
  })
  it('says nothing when every combination is measured', () => {
    const crossed = [...rows, r('g1', 'M', 'DMSO', 10, null, 1, 4)]
    expect(previewFactorAnova({ ...input, rows: crossed }).notes).toEqual([])
  })
})
