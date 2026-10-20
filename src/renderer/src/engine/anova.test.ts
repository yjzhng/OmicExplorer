/**
 * The n-way ANOVA against independent computations: a balanced 2×3 against the textbook sums of
 * squares, an unbalanced 2×2's type II SS against an additive fit by backfitting (a different
 * algorithm), contrasts against their closed forms, and the moderated variance's direction.
 */
import { describe, expect, it } from 'vitest'

import { anovaTerms, runAnova } from './anova'
import { fSurvival } from './curveFit'
import { studentTTwoSided } from './stats'
import type { StandardRow } from './types'

const row = (uniqID: string, cell: string, cmpd: string, rep: number, log2: number): StandardRow =>
  ({ uniqID, cell, cmpd, dose: null, time: null, rep, value: 2 ** log2 }) as StandardRow

const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length

describe('anovaTerms', () => {
  it('lists the main effects, then the interactions up to the cap', () => {
    const f = ['cell', 'cmpd', 'time'].map((c) => ({ condition: c, levels: ['a', 'b'] }))
    expect(anovaTerms(f, 2).map((t) => t.label)).toEqual([
      'cell',
      'cmpd',
      'time',
      'cell × cmpd',
      'cell × time',
      'cmpd × time'
    ])
    expect(anovaTerms(f, 1)).toHaveLength(3)
  })
})

describe('runAnova — balanced 2 × 3', () => {
  // cell ∈ {M, W} × cmpd ∈ {A, B, C}, 2 replicates; values chosen to have every effect.
  const y: Record<string, [number, number]> = {
    'M,A': [5.0, 5.4],
    'M,B': [6.1, 6.5],
    'M,C': [4.0, 4.6],
    'W,A': [3.0, 3.2],
    'W,B': [5.5, 5.1],
    'W,C': [2.9, 3.5]
  }
  const rows = Object.entries(y).flatMap(([k, vs]) => {
    const [cell, cmpd] = k.split(',')
    return vs.map((v, i) => row('g', cell, cmpd, i + 1, v))
  })
  const res = runAnova({
    rows,
    factors: [
      { condition: 'cell', levels: ['M', 'W'] },
      { condition: 'cmpd', levels: ['A', 'B', 'C'] }
    ],
    activeConditions: ['cell', 'cmpd'],
    variance: 'plain',
    contrasts: [
      {
        kind: 'interaction',
        a: { factor: 0, num: 'M', den: 'W' },
        b: { factor: 1, num: 'B', den: 'A' }
      },
      { kind: 'main', a: { factor: 1, num: 'C', den: 'A' } }
    ]
  })
  const g = res.slices[0].genes[0]
  // textbook: SS_A = b·n·Σ(ȳᵢ − ȳ)², SS_B = a·n·Σ(ȳⱼ − ȳ)², SS_AB = n·Σ(ȳᵢⱼ − ȳᵢ − ȳⱼ + ȳ)²
  const cellMean = (c: string, d: string): number => mean(y[`${c},${d}`])
  const all = mean(Object.values(y).flat())
  const mCell = (c: string): number => mean(['A', 'B', 'C'].flatMap((d) => y[`${c},${d}`]))
  const mCmpd = (d: string): number => mean(['M', 'W'].flatMap((c) => y[`${c},${d}`]))
  const ssA = 3 * 2 * ['M', 'W'].reduce((s, c) => s + (mCell(c) - all) ** 2, 0)
  const ssB = 2 * 2 * ['A', 'B', 'C'].reduce((s, d) => s + (mCmpd(d) - all) ** 2, 0)
  const ssAB =
    2 *
    ['M', 'W'].reduce(
      (s, c) =>
        s +
        ['A', 'B', 'C'].reduce((t, d) => t + (cellMean(c, d) - mCell(c) - mCmpd(d) + all) ** 2, 0),
      0
    )
  const ssE = Object.values(y).reduce(
    (s, vs) => s + vs.reduce((t, v) => t + (v - mean(vs)) ** 2, 0),
    0
  )
  const s2 = ssE / 6

  it('has the textbook sums of squares and df', () => {
    expect(g.ss[0]).toBeCloseTo(ssA, 10)
    expect(g.ss[1]).toBeCloseTo(ssB, 10)
    expect(g.ss[2]).toBeCloseTo(ssAB, 10)
    expect(g.df).toEqual([1, 2, 2])
    expect(g.dfResid).toBe(6)
    expect(g.s2).toBeCloseTo(s2, 10)
  })
  it('tests each term by F on the residual variance', () => {
    expect(g.F[1]).toBeCloseTo(ssB / 2 / s2, 10)
    expect(g.p[1]).toBeCloseTo(fSurvival(ssB / 2 / s2, 2, 6), 12)
  })
  it('attributes: grand mean plus the terms reproduce every cell mean; shares sum to the model', () => {
    const cells = res.slices[0].cells
    cells.forEach((c, ci) => {
      const fit = g.grand + g.contrib.reduce((s, tc) => s + tc[ci], 0)
      const name = `${['M', 'W'][c[0]]},${['A', 'B', 'C'][c[1]]}`
      expect(fit).toBeCloseTo(mean(y[name]), 10)
    })
    expect(g.grand).toBeCloseTo(all, 10)
    // balanced: each share is the term's SS over the total
    const sst = Object.values(y)
      .flat()
      .reduce((s, v) => s + (v - all) ** 2, 0)
    expect(g.share[1]).toBeCloseTo(ssB / sst, 10)
  })
  it('estimates contrasts from the cell means, tested on the model variance', () => {
    const ia = res.slices[0].contrasts[0].genes[0]
    const est = cellMean('M', 'B') - cellMean('W', 'B') - cellMean('M', 'A') + cellMean('W', 'A')
    expect(ia.estimate).toBeCloseTo(est, 10)
    expect(ia.se).toBeCloseTo(Math.sqrt(s2 * (4 / 2)), 10)
    expect(ia.p).toBeCloseTo(studentTTwoSided(Math.abs(est / ia.se), 6), 12)
    // a main contrast averages over the other factor's levels
    const main = res.slices[0].contrasts[1].genes[0]
    expect(main.estimate).toBeCloseTo(mCmpd('C') - mCmpd('A'), 10)
    expect(main.se).toBeCloseTo(Math.sqrt(s2 * (4 * 0.25 * 0.5)), 10)
  })
})

describe('runAnova — unbalanced 2 × 2', () => {
  const data: Array<[string, string, number]> = [
    ['M', 'A', 5.0],
    ['M', 'A', 5.6],
    ['M', 'A', 5.2],
    ['M', 'B', 7.1],
    ['W', 'A', 3.0],
    ['W', 'A', 3.4],
    ['W', 'B', 6.0],
    ['W', 'B', 5.2],
    ['W', 'B', 5.7],
    ['W', 'B', 5.5]
  ]
  const rows = data.map(([c, d, v], i) => row('g', c, d, i, v))
  const res = runAnova({
    rows,
    factors: [
      { condition: 'cell', levels: ['M', 'W'] },
      { condition: 'cmpd', levels: ['A', 'B'] }
    ],
    activeConditions: ['cell', 'cmpd'],
    variance: 'plain'
  })
  const g = res.slices[0].genes[0]
  // the additive model's RSS by backfitting — independent of the QR fit
  const additiveRss = (): number => {
    const a: Record<string, number> = { M: 0, W: 0 }
    const b: Record<string, number> = { A: 0, B: 0 }
    let mu = mean(data.map((d) => d[2]))
    for (let it = 0; it < 5000; it++) {
      for (const k of Object.keys(a))
        a[k] = mean(data.filter((d) => d[0] === k).map((d) => d[2] - mu - b[d[1]]))
      for (const k of Object.keys(b))
        b[k] = mean(data.filter((d) => d[1] === k).map((d) => d[2] - mu - a[d[0]]))
      mu = mean(data.map((d) => d[2] - a[d[0]] - b[d[1]]))
    }
    return data.reduce((s, d) => s + (d[2] - mu - a[d[0]] - b[d[1]]) ** 2, 0)
  }
  const oneWayRss = (k: 0 | 1): number => {
    const groups = new Set(data.map((d) => d[k]))
    return [...groups].reduce((s, gk) => {
      const vs = data.filter((d) => d[k] === gk).map((d) => d[2])
      return s + vs.reduce((t, v) => t + (v - mean(vs)) ** 2, 0)
    }, 0)
  }
  it('has type II SS: each main effect after the other, the interaction after both', () => {
    const add = additiveRss()
    const cellRss = ['M,A', 'M,B', 'W,A', 'W,B'].reduce((s, k) => {
      const vs = data.filter((d) => `${d[0]},${d[1]}` === k).map((d) => d[2])
      return s + vs.reduce((t, v) => t + (v - mean(vs)) ** 2, 0)
    }, 0)
    expect(g.ss[0]).toBeCloseTo(oneWayRss(1) - add, 8) // cell after cmpd
    expect(g.ss[1]).toBeCloseTo(oneWayRss(0) - add, 8) // cmpd after cell
    expect(g.ss[2]).toBeCloseTo(add - cellRss, 8) // interaction after both
    expect(g.dfResid).toBe(6)
  })
})

describe('runAnova — a missing cell', () => {
  // W × B never measured: the interaction can't be estimated, the main effects still can
  const rows = [
    ['M', 'A', 5.0],
    ['M', 'A', 5.4],
    ['M', 'B', 7.0],
    ['M', 'B', 7.2],
    ['W', 'A', 3.0],
    ['W', 'A', 3.3]
  ].map(([c, d, v], i) => row('g', c as string, d as string, i, v as number))
  const res = runAnova({
    rows,
    factors: [
      { condition: 'cell', levels: ['M', 'W'] },
      { condition: 'cmpd', levels: ['A', 'B'] }
    ],
    activeConditions: ['cell', 'cmpd'],
    variance: 'plain',
    contrasts: [
      {
        kind: 'interaction',
        a: { factor: 0, num: 'M', den: 'W' },
        b: { factor: 1, num: 'B', den: 'A' }
      },
      { kind: 'main', a: { factor: 0, num: 'M', den: 'W' } }
    ]
  })
  const g = res.slices[0].genes[0]
  it('drops the inestimable interaction (0 df) and fits the cells it has', () => {
    expect(g.df[2]).toBe(0)
    expect(Number.isNaN(g.F[2])).toBe(true)
    expect(g.dfResid).toBe(3)
  })
  it('reports no contrast that reads the missing cell', () => {
    expect(res.slices[0].contrasts[0].genes).toHaveLength(0)
    // the main contrast averages only over cmpd levels present at both cells: A
    expect(res.slices[0].contrasts[1].genes[0].estimate).toBeCloseTo(5.2 - 3.15, 10)
  })
})

describe('runAnova — moderated variance', () => {
  it('pulls each gene’s variance towards the run’s prior, and raises the tests’ df', () => {
    const rows: StandardRow[] = []
    for (let gi = 0; gi < 60; gi++)
      for (const [c, d] of [
        ['M', 'A'],
        ['M', 'B'],
        ['W', 'A'],
        ['W', 'B']
      ])
        for (let r = 0; r < 2; r++) {
          // per-gene noise between 0.05 and 0.6, deterministic
          const sd = 0.05 + ((gi * 7) % 12) * 0.05
          rows.push(row(`g${gi}`, c, d, r, 4 + (r ? sd : -sd) + (c === 'M' ? 1 : 0)))
        }
    const run = (variance: 'plain' | 'moderated') =>
      runAnova({
        rows,
        factors: [
          { condition: 'cell', levels: ['M', 'W'] },
          { condition: 'cmpd', levels: ['A', 'B'] }
        ],
        activeConditions: ['cell', 'cmpd'],
        variance
      })
    const plain = run('plain').slices[0].genes
    const mod = run('moderated').slices[0].genes
    const lo = plain.reduce((a, b) => (b.s2 < a.s2 ? b : a))
    const hi = plain.reduce((a, b) => (b.s2 > a.s2 ? b : a))
    const m = (id: string) => mod.find((x) => x.uniqID === id)!
    expect(m(lo.uniqID).s2Post).toBeGreaterThan(lo.s2)
    expect(m(hi.uniqID).s2Post).toBeLessThan(hi.s2)
    expect(m(lo.uniqID).dfTest).toBeGreaterThan(lo.dfTest)
  })
})
