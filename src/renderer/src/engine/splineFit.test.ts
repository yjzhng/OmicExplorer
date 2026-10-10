import { describe, expect, it } from 'vitest'

import { rng } from './sam'
import { fitSplineCurve, nsBasis, runSplineFit, runSurfaceFit, splineDf } from './splineFit'
import type { StandardRow } from './types'

const DOSES = [1, 3, 10, 30, 100, 300, 1000, 3000]
const TIMES = [30, 60, 120, 240, 480, 960, 1440, 2880]

function normal(r: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
}
const row = (
  uniqID: string,
  cmpd: string,
  dose: number,
  time: number | null,
  rep: number,
  log2: number
): StandardRow => ({ uniqID, cell: '', cmpd, dose, time, rep, value: 2 ** log2 }) as StandardRow

describe('spline basis', () => {
  it('follows the df rule', () => {
    expect([2, 3, 4, 5, 6, 7, 8, 12].map(splineDf)).toEqual([null, 1, 1, 2, 3, 3, 4, 4])
  })
  it('has df + 1 columns and fits a line exactly', () => {
    const x = [-0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
    const X = nsBasis(x, 4)
    expect(X[0]).toHaveLength(5)
    const fit = fitSplineCurve(
      x,
      x.map((v) => 2 + 3 * v),
      0
    )!
    fit.fitted.forEach((f, i) => expect(f).toBeCloseTo(2 + 3 * x[i], 6))
    expect(fit.rss).toBeLessThan(1e-12)
  })
  it('reports the signed peak relative to the baseline level, wherever it is', () => {
    const x = [-0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
    const bump = x.map((v) => -1.5 * Math.exp(-((v - 1.5) ** 2)))
    bump[0] = 0
    expect(fitSplineCurve(x, bump, 0)!.peak).toBeLessThan(-1)
  })
})

describe('runSplineFit — dose', () => {
  // 300 flat genes, 30 transient (peak mid-dose, back to 0), 30 saturated (full effect at every
  // dose — the lowest → highest fold change is 0); 3 replicates, vehicle DMSO.
  const r = rng(7)
  const rows: StandardRow[] = []
  const kind = (g: number): string => (g < 30 ? 'transient' : g < 60 ? 'saturated' : 'flat')
  for (let g = 0; g < 360; g++) {
    const a = 20 + 3 * r()
    const id = `g${g}`
    for (let rep = 1; rep <= 3; rep++) rows.push(row(id, 'DMSO', 0, null, rep, a + 0.2 * normal(r)))
    DOSES.forEach((d, i) => {
      const e =
        kind(g) === 'transient'
          ? 2 * Math.exp(-((i - 3.5) ** 2) / 2)
          : kind(g) === 'saturated'
            ? -1.5
            : 0
      for (let rep = 1; rep <= 3; rep++)
        rows.push(row(id, 'A', d, null, rep, a + e + 0.2 * normal(r)))
    })
  }
  const res = runSplineFit({
    rows,
    num: { cmpd: ['A'] },
    den: { cmpd: ['DMSO'] },
    match: [],
    activeConditions: ['cmpd', 'dose'],
    curveAxis: 'dose'
  })
  const by = (k: string): typeof res.rows =>
    res.rows.filter((x) => kind(Number(x.uniqID.slice(1))) === k)

  it('finds transient and saturated responses with their peak size', () => {
    for (const k of ['transient', 'saturated']) {
      const rs = by(k)
      expect(rs.filter((x) => x.q < 0.05).length).toBeGreaterThanOrEqual(28)
      expect(Math.abs(rs.reduce((s, x) => s + x.peak, 0) / rs.length)).toBeGreaterThan(1.2)
    }
    expect(by('saturated').every((x) => x.peak < 0)).toBe(true)
  })
  it('keeps flat genes near the nominal false-positive rate', () => {
    const flat = by('flat')
    expect(flat).toHaveLength(300)
    expect(flat.filter((x) => x.p < 0.05).length / flat.length).toBeLessThan(0.1)
    expect(flat.filter((x) => x.q < 0.05).length).toBeLessThanOrEqual(6)
  })
})

describe('runSplineFit — time', () => {
  // Vehicle drift (same in vehicle and treated) must cancel against the vehicle at each time;
  // a sustained response must be found.
  const r = rng(11)
  const rows: StandardRow[] = []
  for (let g = 0; g < 200; g++) {
    const a = 20 + 3 * r()
    const id = `g${g}`
    const drift = (t: number): number => (g % 2 ? 1.2 * (1 - Math.exp(-t / 300)) : 0)
    const effect = (t: number): number => (g < 20 && t > 0 ? 1.5 : 0)
    for (const t of [0, ...TIMES]) {
      for (let rep = 1; rep <= 3; rep++)
        rows.push(row(id, 'DMSO', 0, t, rep, a + drift(t) + 0.2 * normal(r)))
      if (t > 0)
        for (let rep = 1; rep <= 3; rep++)
          rows.push(row(id, 'A', 1000, t, rep, a + drift(t) + effect(t) + 0.2 * normal(r)))
    }
  }
  const res = runSplineFit({
    rows,
    num: { cmpd: ['A'] },
    den: { cmpd: ['DMSO'] },
    match: [],
    activeConditions: ['cmpd', 'dose', 'time'],
    curveAxis: 'time'
  })
  it('cancels vehicle drift and finds the responders', () => {
    const resp = res.rows.filter((x) => Number(x.uniqID.slice(1)) < 20)
    const nulls = res.rows.filter((x) => Number(x.uniqID.slice(1)) >= 20)
    expect(resp.filter((x) => x.q < 0.05).length).toBeGreaterThanOrEqual(18)
    expect(nulls.filter((x) => x.q < 0.05).length).toBeLessThanOrEqual(4)
    // drift cancels: the drifting nulls' level means sit at 0, like the others'
    const drifting = nulls.filter((x) => Number(x.uniqID.slice(1)) % 2)
    for (let i = 1; i < drifting[0].curve.y.length; i++)
      expect(
        Math.abs(drifting.reduce((a, x) => a + x.curve.y[i], 0) / drifting.length)
      ).toBeLessThan(0.08)
    expect(nulls.filter((x) => x.p < 0.05).length / nulls.length).toBeLessThan(0.1)
  })
})

describe('runSurfaceFit — dose × time', () => {
  // 300 genes: 30 with a transient-in-time × sigmoid-in-dose response, the rest flat; half of all
  // genes drift in the vehicle (shared by vehicle and treated). One surface per gene.
  const doses = [1, 10, 100, 1000]
  const times = [30, 120, 480, 1440]
  const build = (vehicleTimes: number[], seed: number): StandardRow[] => {
    const r = rng(seed)
    const rows: StandardRow[] = []
    for (let g = 0; g < 300; g++) {
      const a = 20 + 3 * r()
      const id = `g${g}`
      const drift = (t: number): number => (g % 2 ? 1 - Math.exp(-t / 300) : 0)
      const eff = (d: number, t: number): number =>
        g < 30
          ? (1.5 / (1 + (100 / d) ** 1.5)) * (1 - Math.exp(-t / 60)) * Math.exp(-t / 2000) * 1.8
          : 0
      for (const t of vehicleTimes)
        for (let rep = 1; rep <= 3; rep++)
          rows.push(row(id, 'DMSO', 0, t, rep, a + drift(t) + 0.2 * normal(r)))
      for (const cmpd of ['A', 'B'])
        for (const t of times)
          for (const d of doses)
            for (let rep = 1; rep <= 3; rep++)
              rows.push(
                row(
                  id,
                  cmpd,
                  d,
                  t,
                  rep,
                  a + drift(t) + (cmpd === 'A' ? eff(d, t) : 0) + 0.2 * normal(r)
                )
              )
    }
    return rows
  }
  const run = (vehicleTimes: number[], seed: number): ReturnType<typeof runSurfaceFit> =>
    runSurfaceFit({
      rows: build(vehicleTimes, seed),
      num: { cmpd: ['A', 'B'] },
      den: { cmpd: ['DMSO'] }
    })
  const resp = (x: { uniqID: string; cmpd: string }): boolean =>
    x.cmpd === 'A' && Number(x.uniqID.slice(1)) < 30

  it('tests each gene × compound once and finds the responders', () => {
    const res = run([0, ...times], 3)
    expect(res.rows).toHaveLength(600)
    expect(res.rows.filter((x) => resp(x) && x.q < 0.05).length).toBeGreaterThanOrEqual(27)
    expect(res.rows.filter((x) => !resp(x) && x.q < 0.05).length).toBeLessThanOrEqual(6)
  })
  it('with a t₀ vehicle only, estimates drift from the compounds', () => {
    const res = run([0], 5)
    const nullsDrift = res.rows.filter((x) => !resp(x) && Number(x.uniqID.slice(1)) % 2)
    expect(nullsDrift.filter((x) => x.q < 0.05).length / nullsDrift.length).toBeLessThan(0.05)
    expect(res.rows.filter((x) => resp(x) && x.q < 0.05).length).toBeGreaterThanOrEqual(24)
  })
})
