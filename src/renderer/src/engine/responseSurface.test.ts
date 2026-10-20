import { describe, expect, it } from 'vitest'

import { RESPONSE_THRESHOLD, runResponseSurface } from './responseSurface'
import { rng } from './sam'
import { jointPredict } from './surfaceJoint'
import type { StandardRow } from './types'

const DOSES = [1, 3, 10, 30, 100, 300, 1000, 3000]
const TIMES = [30, 120, 480, 1440]

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

// 200 genes: the first 20 respond to A (a sigmoid rising by 1.5 log₂ around dose 30), the rest flat.
const responds = (g: number): boolean => g < 20
const sig = (d: number): number => 1.5 / (1 + (30 / d) ** 1.5)

describe('runResponseSurface — one axis', () => {
  const r = rng(11)
  const rows: StandardRow[] = []
  for (let g = 0; g < 200; g++) {
    const a = 20 + 3 * r()
    for (let rep = 1; rep <= 3; rep++) {
      rows.push(row(`g${g}`, 'DMSO', 0, null, rep, a + 0.2 * normal(r)))
      for (const d of DOSES)
        rows.push(row(`g${g}`, 'A', d, null, rep, a + (responds(g) ? sig(d) : 0) + 0.2 * normal(r)))
    }
  }
  const res = runResponseSurface({
    rows,
    num: { cmpd: ['A'] },
    den: { cmpd: ['DMSO'] },
    match: [],
    activeConditions: ['cmpd', 'dose'],
    numericConditions: [],
    curveAxis: 'dose',
    threshold: RESPONSE_THRESHOLD
  })

  it('gives one row per curve with the standard columns', () => {
    expect(res.rows).toHaveLength(200)
    const x = res.rows[0]
    expect(x.cmpd).toBe('A')
    expect(x.rs?.axis).toBe('dose')
    expect(x.curve).toBeUndefined()
    expect(res.comparisons).toHaveLength(1)
  })
  it('calls by q at 5% and describes the called curves', () => {
    const called = res.rows.filter((x) => x.signf)
    expect(called.filter((x) => responds(Number(x.uniqID.slice(1)))).length).toBeGreaterThanOrEqual(
      18
    )
    expect(called.filter((x) => !responds(Number(x.uniqID.slice(1)))).length).toBeLessThanOrEqual(3)
    for (const x of called) {
      expect(x.pQ).toBeGreaterThanOrEqual(-Math.log10(0.05))
      expect(x.rs?.desc).toBeDefined()
      expect(x.rs?.line?.x.length).toBeGreaterThan(10)
    }
    // the peak is the effect size: about +1.5 for the responders
    const peaks = called.filter((x) => responds(Number(x.uniqID.slice(1)))).map((x) => x.log2FC!)
    expect(peaks.reduce((a, v) => a + v, 0) / peaks.length).toBeGreaterThan(1.1)
  })
})

describe('runResponseSurface — dose × time surface', () => {
  const build = (control: 'vehicle' | 'dose0'): StandardRow[] => {
    const r = rng(5)
    const rows: StandardRow[] = []
    for (let g = 0; g < 200; g++) {
      const a = 20 + 3 * r()
      for (let rep = 1; rep <= 3; rep++) {
        for (const t of [0, ...TIMES])
          rows.push(
            row(`g${g}`, control === 'vehicle' ? 'DMSO' : 'A', 0, t, rep, a + 0.2 * normal(r))
          )
        for (const t of TIMES)
          for (const d of [1, 10, 100, 1000, 3000])
            rows.push(
              row(
                `g${g}`,
                'A',
                d,
                t,
                rep,
                a + (responds(g) ? sig(d) * (1 - Math.exp(-t / 200)) : 0) + 0.2 * normal(r)
              )
            )
      }
    }
    return rows
  }
  const run = (
    rows: StandardRow[],
    den: Record<string, string[]>
  ): ReturnType<typeof runResponseSurface> =>
    runResponseSurface({
      rows,
      num: { cmpd: den.dose ? ['A', 'B'] : ['A'], dose: ['1', '10', '100', '1000', '3000'] },
      den,
      match: [],
      activeConditions: ['cmpd', 'dose', 'time'],
      numericConditions: [],
      curveAxis: 'surface',
      threshold: RESPONSE_THRESHOLD
    })

  it('tests each gene × compound once, against the vehicle', () => {
    const res = run(build('vehicle'), { cmpd: ['DMSO'] })
    expect(res.rows).toHaveLength(200)
    expect(res.comparisons).toEqual(['A | DMSO'])
    const called = res.rows.filter((x) => x.signf)
    expect(called.filter((x) => responds(Number(x.uniqID.slice(1)))).length).toBeGreaterThanOrEqual(
      18
    )
    expect(called.filter((x) => !responds(Number(x.uniqID.slice(1)))).length).toBeLessThanOrEqual(3)
    const x = called[0]
    expect(x.rs?.axis).toBe('surface')
    expect(x.rs?.cells).toHaveLength(20)
    expect(x.rs?.surface?.byTime.length).toBeGreaterThan(0)
    expect(x.dose).toBeNull()
    expect(x.time).toBeNull()
  })
  it('keeps the reference for drawing: the vehicle’s replicates and the t₀ samples', () => {
    // A at t₀ too: a matched time's baseline level — not cells, kept as samples
    const rows = build('vehicle')
    const r = rng(9)
    for (let rep = 1; rep <= 3; rep++)
      for (const d of [1, 10, 100, 1000, 3000])
        rows.push(row('g0', 'A', d, 0, rep, 21 + 0.2 * normal(r)))
    const x = run(rows, { cmpd: ['DMSO'] }).rows.find((y) => y.uniqID === 'g0')!
    const ctl = x.rs?.controls ?? []
    const veh = ctl.filter((c) => c.vehicle)
    // the vehicle at each of its times, at dose 0, three replicates scattering about its mean
    expect(veh.map((c) => c.time)).toEqual([0, ...TIMES])
    for (const c of veh) {
      expect(c.dose).toBe(0)
      expect(c.reps).toHaveLength(3)
      expect(Math.abs(c.y)).toBeLessThan(1e-9)
      expect(c.reps.some((v) => Math.abs(v) > 1e-6)).toBe(true)
    }
    // the treated samples at t₀: one per dose, not among the cells
    const base = ctl.filter((c) => !c.vehicle)
    expect(base.map((c) => c.dose)).toEqual([1, 10, 100, 1000, 3000])
    expect(base.every((c) => c.time === 0 && c.reps.length === 3)).toBe(true)
    expect(x.rs?.cells?.some((c) => c.time === 0)).toBe(false)
  })
  it('with the 4PL surface detector: adjusted-F p and BH q, the 4PL’s fit and peak', () => {
    const rows = build('vehicle')
    const run4 = (): ReturnType<typeof runResponseSurface> =>
      runResponseSurface({
        rows,
        num: { cmpd: ['A'], dose: ['1', '10', '100', '1000', '3000'] },
        den: { cmpd: ['DMSO'] },
        match: [],
        activeConditions: ['cmpd', 'dose', 'time'],
        numericConditions: [],
        curveAxis: 'surface',
        detector: '4pl',
        threshold: RESPONSE_THRESHOLD
      })
    const a = run4()
    const called = a.rows.filter((x) => x.signf)
    const responder = (x: { uniqID: string }): boolean => responds(Number(x.uniqID.slice(1)))
    expect(called.filter(responder).length).toBeGreaterThanOrEqual(18)
    expect(called.filter((x) => !responder(x)).length).toBeLessThanOrEqual(3)
    // the flat surfaces' p roughly uniform: about 5% of them below 0.05
    const flatP = a.rows.filter((x) => !responder(x)).map((x) => 10 ** -(x.pP ?? 0))
    expect(flatP.filter((v) => v < 0.05).length / flatP.length).toBeLessThan(0.1)
    expect(flatP.filter((v) => v > 0.5).length / flatP.length).toBeGreaterThan(0.35)
    const x = called.find((r) => r.rs?.detector)!
    expect(x.rs?.detector).toBe('4pl')
    expect(x.rs?.df1).toBe(6)
  })
  it('with the 4PL surface detector: every surface described on request, the joint one its test’s own fit, no shape check', () => {
    const res = runResponseSurface({
      rows: build('vehicle'),
      num: { cmpd: ['A'], dose: ['1', '10', '100', '1000', '3000'] },
      den: { cmpd: ['DMSO'] },
      match: [],
      activeConditions: ['cmpd', 'dose', 'time'],
      numericConditions: [],
      curveAxis: 'surface',
      detector: '4pl',
      surfaceDescription: 'joint',
      describeAll: true,
      threshold: RESPONSE_THRESHOLD
    })
    // describeAll reaches the flat surfaces too (q far above DESCRIBE_Q)
    const described = res.rows.filter((x) => x.rs?.surface)
    expect(described.length).toBe(res.rows.length)
    for (const x of described) {
      const d = x.rs!.surface!
      // the detector's fit, reused: the description draws exactly the test's fitted cells
      for (const c of x.rs!.cells!)
        expect(jointPredict(d.joint!, d.jointUbar!, c.dose, c.time, x.rs!.timeOffset!)).toBeCloseTo(
          c.fitted,
          10
        )
      // no spline to check the shape against: R² only
      expect(d.shapeRatio).toBeUndefined()
      expect(d.lowShape).toBeUndefined()
      expect(Number.isFinite(d.r2)).toBe(true)
    }
  })
  it('with the 4PL surface detector, CurveCurator’s relevance score and decoy-surface FDR', () => {
    const cc = {
      ...RESPONSE_THRESHOLD,
      type: 'curvecurator' as const,
      statType: 'pP' as const,
      statMin: -Math.log10(0.05),
      fcHigh: 0.45,
      fcLow: -0.45
    }
    const res = runResponseSurface({
      rows: build('vehicle'),
      num: { cmpd: ['A'], dose: ['1', '10', '100', '1000', '3000'] },
      den: { cmpd: ['DMSO'] },
      match: [],
      activeConditions: ['cmpd', 'dose', 'time'],
      numericConditions: [],
      curveAxis: 'surface',
      detector: '4pl',
      threshold: { ...cc, ccCallBy: 'fdr' }
    })
    // one decoy surface per surface, filed under its comparison group; every row a CurveCurator test
    expect(Object.values(res.decoys ?? {}).flat()).toHaveLength(200)
    expect(res.rows.every((x) => x.rs?.cc && Number.isFinite(x.rs.cc.f))).toBe(true)
    expect(res.rows.every((x) => x.rs?.cc?.q != null)).toBe(true)
    const responder = (x: { uniqID: string }): boolean => responds(Number(x.uniqID.slice(1)))
    const called = res.rows.filter((x) => x.signf)
    expect(called.filter(responder).length).toBeGreaterThanOrEqual(15)
    expect(called.filter((x) => !responder(x)).length).toBeLessThanOrEqual(3)
    // called by FDR: every call within the target, and the run reports the FDR it reached
    for (const x of called) expect(x.rs!.cc!.q!).toBeLessThanOrEqual(0.05)
    expect(res.curveFdr).toBeLessThanOrEqual(0.05)
    // the calls respect the fold-change limit
    for (const x of called) expect(Math.abs(x.log2FC!)).toBeGreaterThanOrEqual(0.45)
  })
  it('takes the compound’s own dose 0 as the control, without mixing it into the treatment', () => {
    const res = run(build('dose0'), { cmpd: ['A'], dose: ['0'] })
    expect(res.rows).toHaveLength(200)
    expect(res.rows.every((x) => x.cmpd === 'A')).toBe(true)
    expect(
      res.rows.filter((x) => x.signf && responds(Number(x.uniqID.slice(1)))).length
    ).toBeGreaterThanOrEqual(18)
  })
  it('a time pin on the curves filters the surface to those times (both sides)', () => {
    const rows = build('vehicle')
    const keep = TIMES.slice(0, -1).map(String)
    const res = runResponseSurface({
      rows,
      num: { cmpd: ['A'], dose: ['1', '10', '100', '1000', '3000'], time: keep },
      den: { cmpd: ['DMSO'] },
      match: [],
      activeConditions: ['cmpd', 'dose', 'time'],
      numericConditions: [],
      curveAxis: 'surface',
      threshold: RESPONSE_THRESHOLD
    })
    const times = new Set(res.rows.flatMap((x) => (x.rs?.cells ?? []).map((c) => c.time)))
    expect(times.size).toBeGreaterThan(0)
    expect(times.has(TIMES[TIMES.length - 1])).toBe(false)
    expect([...times].every((t) => keep.includes(String(t)))).toBe(true)
  })
  it('with dose 0 as the reference, matches each compound to its own dose 0', () => {
    // B: the same design, flat, its dose 0 shifted far from A's — pooled controls would call it
    const a = build('dose0')
    const b = a.map((r) => ({
      ...r,
      cmpd: 'B',
      value:
        (r.dose
          ? (r.value as number) /
            2 **
              (responds(Number(r.uniqID.slice(1)))
                ? sig(r.dose as number) * (1 - Math.exp(-(r.time as number) / 200))
                : 0)
          : (r.value as number)) * 4
    }))
    const res = run([...a, ...b] as StandardRow[], { dose: ['0'] })
    expect(res.rows).toHaveLength(400)
    expect(res.comparisons.sort()).toEqual(['A | dose 0', 'B | dose 0'])
    const called = (c: string): number => res.rows.filter((x) => x.cmpd === c && x.signf).length
    expect(called('A')).toBeGreaterThanOrEqual(18)
    expect(called('B')).toBeLessThanOrEqual(3)
  })
})
