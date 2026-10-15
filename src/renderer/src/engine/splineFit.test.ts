import { describe, expect, it } from 'vitest'

import { rng } from './sam'
import {
  describeCurve,
  describeRun,
  describeSurface,
  describeSurfaceRun,
  fitSplineCurve,
  fitSurface,
  nsBasis,
  runSplineFit,
  runSurfaceFit,
  splineDf,
  storeyPi0
} from './splineFit'
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

describe('storeyPi0', () => {
  it('estimates the null share from uniform plus small p-values', () => {
    const r = rng(1)
    const p = [
      ...Array.from({ length: 700 }, () => r()),
      ...Array.from({ length: 300 }, () => 1e-4 * r())
    ]
    expect(storeyPi0(p)).toBeGreaterThan(0.6)
    expect(storeyPi0(p)).toBeLessThan(0.8)
    expect(storeyPi0(Array.from({ length: 500 }, () => r()))).toBeGreaterThan(0.9)
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
  it('describes called curves only; flags the transient ones, not the saturated', () => {
    const desc = describeRun(res)
    res.rows.forEach((x, i) => expect(desc.has(i)).toBe(x.q <= 0.05 && x.curve.x.length >= 5))
    const share = (k: string): number => {
      const ds = res.rows.flatMap(
        (x, i) => (kind(Number(x.uniqID.slice(1))) === k && desc.get(i)) || []
      )
      return ds.filter((d) => d.lowShape).length / ds.length
    }
    expect(share('transient')).toBeGreaterThan(0.8)
    expect(share('saturated')).toBeLessThan(0.2)
  })
})

describe('describeCurve — 4PL description of detected curves', () => {
  // noiseless log₂ level means: a sigmoid rising by 2 with its midpoint at 30 (x = log₁₀ 30), and
  // a bell
  const lx = DOSES.map(Math.log10)
  const x = [lx[0] - 0.5, ...lx]
  const sig = [0, ...lx.map((v) => 2 / (1 + 10 ** (-1.5 * (v - Math.log10(30)))))]
  const bell = [0, ...lx.map((v) => 2 * Math.exp(-((v - 1.7) ** 2) / 0.3))]

  it('recovers a sigmoid’s midpoint and plateaus, and explains what the spline does', () => {
    const d = describeCurve({ ...fitSplineCurve(x, sig, 0)!, scale: { axis: 'dose' } })!
    expect(Math.log10(d.mid)).toBeCloseTo(Math.log10(30), 1)
    expect(d.front).toBeCloseTo(0, 2)
    expect(d.back).toBeCloseTo(2, 1)
    expect(d.shapeRatio).toBeGreaterThan(0.95)
    expect(d.lowShape).toBe(false)
  })
  it('flags a non-monotonic curve as not this shape', () => {
    const d = describeCurve({ ...fitSplineCurve(x, bell, 0)!, scale: { axis: 'dose' } })!
    expect(d.shapeRatio).toBeLessThan(0.8)
    expect(d.lowShape).toBe(true)
  })
  it('maps the time midpoint back from log(t + offset), t₀ as a real point', () => {
    const off = 30
    const tx = [0, ...TIMES].map((t) => Math.log10(t + off))
    const y = [0, ...TIMES].map((t) => -2 * (1 - Math.exp(-t / 200)))
    const d = describeCurve({ ...fitSplineCurve(tx, y, 0)!, scale: { axis: 'time', offset: off } })!
    // half the effect at t = 200·ln 2 ≈ 139 min; a 4PL only approximates the exponential, so loosely
    expect(d.mid).toBeGreaterThan(70)
    expect(d.mid).toBeLessThan(280)
    expect(d.back).toBeLessThan(-1.7)
  })
  it('never puts a time midpoint before t₀', () => {
    const off = 30
    const tx = [0, ...TIMES].map((t) => Math.log10(t + off))
    // full response from the first time point on (sustained), with some wobble
    const y = [0, 1.35, 0.88, 0.68, 1.1, 0.87, 0.96, 0.98, 1.25]
    const d = describeCurve({ ...fitSplineCurve(tx, y, 0)!, scale: { axis: 'time', offset: off } })!
    expect(d.front).toBe(0)
    expect(d.mid).toBeGreaterThan(0)
    expect(d.mid).toBeLessThan(TIMES[0])
    expect(d.back).toBeCloseTo(1.01, 1)
  })
  it('has no description for surfaces', () => {
    expect(describeCurve(fitSplineCurve(x, sig, 0)!)).toBeNull()
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

describe('describeSurface — 4PL slices of a dose × time surface', () => {
  // noiseless effects on a 5 × 5 grid, a vehicle at t₀ and at every time (level 0)
  const doses = [1, 10, 100, 1000, 3000]
  const times = [30, 120, 480, 1440, 2880]
  const vt = [0, ...times]
  const surface = (e: (d: number, t: number) => number): ReturnType<typeof fitSurface> =>
    fitSurface(
      vt.map((time) => ({ time, mean: 0 })),
      times.flatMap((t) =>
        doses.map((d) => ({ dose: d, time: t, mean: e(d, t), group: vt.indexOf(t) }))
      ),
      20,
      { ss: 1, df: 10, nPerLevel: 3 }
    )
  const sig = (d: number): number => 1 / (1 + 10 ** (-1.5 * (Math.log10(d) - Math.log10(30))))

  it('reads pEC50 and top at each time, and the arrival time at each dose', () => {
    const d = describeSurface(surface((dd, t) => 2 * sig(dd) * (1 - Math.exp(-t / 200))))!
    expect(d.byTime.map((s) => s.at)).toEqual(times)
    for (const s of d.byTime.slice(1)) expect(Math.log10(s.mid)).toBeCloseTo(Math.log10(30), 1)
    const tops = d.byTime.map((s) => s.back)
    tops.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(tops[i]))
    expect(d.byDose.map((s) => s.at)).toEqual(doses)
    for (const s of d.byDose) {
      expect(s.front).toBe(0)
      expect(s.mid).toBeGreaterThanOrEqual(0)
    }
    expect(d.lowShape).toBe(false)
  })
  it('flags a response that comes and goes in time', () => {
    const d = describeSurface(surface((dd, t) => 2 * sig(dd) * (t / 300) * Math.exp(1 - t / 300)))!
    expect(d.lowShape).toBe(true)
  })
  it('describes only the direction with 4+ levels per slice', () => {
    const d = describeSurface(
      fitSurface(
        [0, 30, 480, 2880].map((time) => ({ time, mean: 0 })),
        [30, 480, 2880].flatMap((t, k) =>
          doses.map((dd) => ({ dose: dd, time: t, mean: sig(dd), group: k + 1 }))
        ),
        20,
        { ss: 1, df: 10, nPerLevel: 3 }
      )!
    )!
    expect(d.byTime).toHaveLength(3)
    expect(d.byDose).toHaveLength(0)
  })
  it('joint option: one model over the grid recovers a midpoint drifting with time', () => {
    // midpoint log₁₀ dose 2 − 0.3·(u − 2), u = log₁₀(t + 30): more potent later; top builds up
    const off = 30
    const e = (dd: number, t: number): number => {
      const u = Math.log10(t + off)
      const m = 2 - 0.3 * (u - 2)
      return 2 / (1 + 10 ** (-3 * (u - 2))) / (1 + 10 ** (-1.5 * (Math.log10(dd) - m)))
    }
    const d = describeSurface(surface(e), 0.8, 'joint')!
    expect(d.method).toBe('joint')
    expect(d.byDose).toHaveLength(0)
    expect(d.byTime.map((x) => x.at)).toEqual(times)
    for (const x of d.byTime) {
      const u = Math.log10(x.at + off)
      expect(Math.log10(x.mid)).toBeCloseTo(2 - 0.3 * (u - 2), 1)
      expect(x.front).toBe(0)
    }
    expect(d.joint!.h).toBeCloseTo(1.5, 1)
    expect(d.lowShape).toBe(false)
    expect(describeSurface(surface(e))!.method).toBe('slices')
    // the joint model carries the ū its midpoint is centred on: the mean log time over the cells
    expect(d.jointUbar).toBeTypeOf('number')
  })
  it('describes by dose slice with the same fits as by time slice — only drawn the other way', () => {
    const e = (dd: number, t: number): number => 2 * sig(dd) * (1 - Math.exp(-t / 200))
    const byTime = describeSurface(surface(e))!
    const byDose = describeSurface(surface(e), 0.8, 'doseSlices')!
    expect(byDose.method).toBe('doseSlices')
    expect(byDose.byDose.length).toBeGreaterThan(0)
    expect({ ...byDose, method: 'slices' }).toEqual(byTime)
  })
  it('has no surface description for one-axis curves', () => {
    const x = [-0.5, 0, 0.5, 1, 1.5, 2]
    expect(describeSurface(fitSplineCurve(x, [0, 0, 0.2, 1, 1.8, 2], 0)!)).toBeNull()
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
  it('describes the called surfaces, with the responders’ EC50 near 100', () => {
    const res = run([0, ...times], 3)
    const desc = describeSurfaceRun(res)
    res.rows.forEach((x, i) => expect(desc.has(i)).toBe(x.q <= 0.05))
    // at 480 min, where the (transient) response is near its peak
    const mids = res.rows.flatMap((x, i) =>
      resp(x) ? (desc.get(i)?.byTime.find((s) => s.at === 480)?.mid ?? []) : []
    )
    expect(mids.length).toBeGreaterThanOrEqual(25)
    const med = Math.log10([...mids].sort((p, q) => p - q)[mids.length >> 1])
    expect(Math.abs(med - 2)).toBeLessThan(0.3)
  })
  it('with a t₀ vehicle only, estimates drift from the compounds', () => {
    const res = run([0], 5)
    const nullsDrift = res.rows.filter((x) => !resp(x) && Number(x.uniqID.slice(1)) % 2)
    expect(nullsDrift.filter((x) => x.q < 0.05).length / nullsDrift.length).toBeLessThan(0.05)
    expect(res.rows.filter((x) => resp(x) && x.q < 0.05).length).toBeGreaterThanOrEqual(24)
  })
})
