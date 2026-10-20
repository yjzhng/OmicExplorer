import { describe, expect, it } from 'vitest'

import { RESPONSE_THRESHOLD, runResponseSurface, type ResponseInput } from './responseSurface'
import { rng } from './sam'
import { fitJointCells, jointAt, jointParamCount, presetSpec, type JointSpec } from './surfaceJoint'
import type { CompareResultRow, StandardRow } from './types'

const TIMES = [30, 120, 480, 1440]
const DOSES = [1, 10, 100, 1000, 3000]
const normal = (r: () => number): number =>
  Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())

/** 60 genes, DMSO at every time; the first 12 respond to A (a dose sigmoid growing with time). */
function design(): StandardRow[] {
  const r = rng(8)
  const rows: StandardRow[] = []
  for (let g = 0; g < 60; g++) {
    const a = 20 + 3 * r()
    for (let rep = 1; rep <= 3; rep++) {
      for (const t of [0, ...TIMES])
        rows.push({
          uniqID: `g${g}`,
          cell: '',
          cmpd: 'DMSO',
          dose: 0,
          time: t,
          rep,
          value: 2 ** (a + 0.2 * normal(r))
        })
      for (const t of TIMES)
        for (const d of DOSES) {
          const e = g < 12 ? (1.5 / (1 + (30 / d) ** 1.5)) * (1 - Math.exp(-t / 200)) : 0
          rows.push({
            uniqID: `g${g}`,
            cell: '',
            cmpd: 'A',
            dose: d,
            time: t,
            rep,
            value: 2 ** (a + e + 0.2 * normal(r))
          })
        }
    }
  }
  return rows
}
const base: Omit<ResponseInput, 'rows'> = {
  num: { cmpd: ['A'], dose: DOSES.map(String) },
  den: { cmpd: ['DMSO'] },
  match: [],
  activeConditions: ['cmpd', 'dose', 'time'],
  numericConditions: [],
  curveAxis: 'surface',
  // detection alone: q ≤ 5%, no fold-change floor (the default's hyperbola would also gate on FC)
  threshold: { ...RESPONSE_THRESHOLD, type: 'linear', fcLow: 0, fcHigh: 0 },
  describeAll: true
}
const rows = design()
/** What a surface says, without its axes' names. */
const said = (rs: CompareResultRow[]): unknown =>
  rs.map((r) => ({
    id: r.uniqID,
    log2FC: r.log2FC,
    pP: r.pP,
    pQ: r.pQ,
    F: r.rs?.F,
    df1: r.rs?.df1,
    cells: r.rs?.cells,
    byTime: r.rs?.surface?.byTime
  }))

describe('a surface over any two numeric conditions', () => {
  it('time renamed a numeric custom condition, with time’s model: the same surfaces', () => {
    const time = runResponseSurface({ ...base, rows }).rows
    const temp = runResponseSurface({
      ...base,
      rows: rows.map((r) => ({ ...r, time: null, extra: { temp: String(r.time) } })),
      activeConditions: ['cmpd', 'dose', '@temp'],
      numericConditions: ['@temp'],
      surfacePair: ['dose', '@temp'],
      axisBaselines: { '@temp': 'matched' }
    }).rows
    expect(time.length).toBe(60)
    expect(said(temp)).toEqual(said(time))
    // named for its own pair, with its axes kept to draw it
    expect(temp[0].rs?.pair).toEqual(['dose', '@temp'])
    expect(temp[0].rs?.maps?.[1]).toMatchObject({ baseline: 'matched', base: 0, timeOffset: 30 })
    expect(time[0].rs?.pair).toBeUndefined()
  })

  it('a straight line along one axis (dose; time’s 4 levels are a line already): fewer columns, the responders still found', () => {
    const spline = runResponseSurface({ ...base, rows }).rows
    const line = runResponseSurface({
      ...base,
      rows,
      axisFits: { dose: { detect: 'linear' } }
    }).rows
    expect(line[0].rs!.df1).toBeLessThan(spline[0].rs!.df1)
    const called = line.filter((r) => r.signf)
    expect(called.filter((r) => Number(r.uniqID.slice(1)) < 12).length).toBeGreaterThanOrEqual(10)
    expect(called.filter((r) => Number(r.uniqID.slice(1)) >= 12).length).toBeLessThanOrEqual(2)
  })

  it('no change along one axis (constant): the dose curve shared by every time', () => {
    const flat = runResponseSurface({
      ...base,
      rows,
      axisFits: { time: { detect: 'constant' } }
    }).rows
    // the dose spline's columns only (plus the step from the vehicle): no time columns
    const spline = runResponseSurface({ ...base, rows }).rows
    expect(flat[0].rs!.df1).toBeLessThan(spline[0].rs!.df1)
    expect(
      flat.filter((r) => r.signf && Number(r.uniqID.slice(1)) < 12).length
    ).toBeGreaterThanOrEqual(8)
  })
})

describe('the joint model, built from one model per axis', () => {
  it('the preset’s six parameters; others by their shapes and couplings', () => {
    expect(jointParamCount(presetSpec(Math.log10(30)))).toBe(6)
    const lin: JointSpec = {
      a: { shape: '4pl', baseline: 'reference', baseX: -Infinity, coupled: true },
      b: { shape: 'linear', baseline: 'matched', baseX: Math.log10(30) }
    }
    expect(jointParamCount(lin)).toBe(4)
    const both: JointSpec = {
      a: { shape: '4pl', baseline: 'reference', baseX: -Infinity, coupled: true },
      b: { shape: '4pl', baseline: 'matched', baseX: Math.log10(30), coupled: true }
    }
    expect(jointParamCount(both)).toBe(7)
    expect(
      jointParamCount({
        a: { shape: 'constant', baseline: 'reference', baseX: 0 },
        b: { shape: 'constant', baseline: 'reference', baseX: 0 }
      })
    ).toBe(1)
  })

  it('recovers a dose 4PL that grows linearly along a second axis', () => {
    const spec: JointSpec = {
      a: { shape: '4pl', baseline: 'reference', baseX: -Infinity },
      b: { shape: 'linear', baseline: 'matched', baseX: 0 }
    }
    const cells = []
    for (const xa of [-1, 0, 1, 2, 3])
      for (const xb of [1, 2, 3, 4])
        cells.push({ xa, xb, e: 2 * (1 / (1 + 10 ** (-1.2 * (xa - 1)))) * (xb / 4) })
    const fit = fitJointCells(cells, spec)
    expect(fit.rss).toBeLessThan(1e-8)
    expect(fit.params.m0).toBeCloseTo(1, 4)
    expect(fit.params.h).toBeCloseTo(1.2, 4)
    expect(jointAt(fit.params, fit.ubar, 1, 2)).toBeCloseTo(0.5, 6)
  })

  it('a 4PL detector with a straight line along time: its own adjusted F, 4 parameters', () => {
    const res = runResponseSurface({
      ...base,
      rows,
      detector: '4pl',
      axisFits: { time: { detect: 'linear', describe: 'linear' } },
      surfaceDescription: 'joint'
    }).rows
    expect(res[0].rs!.df1).toBe(4)
    expect(res[0].rs!.surface?.joint?.spec?.b.shape).toBe('linear')
    expect(
      res.filter((r) => r.signf && Number(r.uniqID.slice(1)) < 12).length
    ).toBeGreaterThanOrEqual(8)
  }, 120000)
})

describe('a line as a single curve’s detector and description', () => {
  // over dose (5 levels), 12 of 60 genes rising linearly in log dose
  const r = rng(4)
  const lin: StandardRow[] = []
  for (let g = 0; g < 60; g++) {
    const a = 20 + 3 * r()
    for (let rep = 1; rep <= 3; rep++) {
      lin.push({
        uniqID: `g${g}`,
        cell: '',
        cmpd: 'DMSO',
        dose: 0,
        time: null,
        rep,
        value: 2 ** (a + 0.15 * normal(r))
      })
      for (const d of [1, 10, 100, 1000, 10000])
        lin.push({
          uniqID: `g${g}`,
          cell: '',
          cmpd: 'A',
          dose: d,
          time: null,
          rep,
          value: 2 ** (a + (g < 12 ? 0.4 * (Math.log10(d) + 1) : 0) + 0.15 * normal(r))
        })
    }
  }
  const one = (axisFits: ResponseInput['axisFits']) =>
    runResponseSurface({
      rows: lin,
      num: { cmpd: ['A'] },
      den: { cmpd: ['DMSO'] },
      match: [],
      activeConditions: ['cmpd', 'dose'],
      numericConditions: [],
      curveAxis: 'dose',
      threshold: RESPONSE_THRESHOLD,
      describeAll: true,
      axisFits
    }).rows
  it('detects with a line (1 df) and describes by one: slope per log₁₀ dose, no midpoint', () => {
    const res = one({ dose: { detect: 'linear', describe: 'linear' } })
    const g0 = res.find((x) => x.uniqID === 'g0')!.rs!
    expect(g0.df1).toBe(2) // the baseline's step + the line
    expect(g0.desc?.model).toBe('linear')
    expect(g0.desc!.slope).toBeCloseTo(0.4, 1)
    expect(Number.isNaN(g0.desc!.mid)).toBe(true)
    expect(
      res.filter((x) => x.signf && Number(x.uniqID.slice(1)) < 12).length
    ).toBeGreaterThanOrEqual(10)
  })
  it('no description when asked for none', () => {
    expect(one({ dose: { describe: 'none' } })[0].rs!.desc).toBeUndefined()
  })
})

describe('a surface described slice by slice with a line along one axis', () => {
  it('its time curves are lines, its dose curves still 4PLs', () => {
    const res = runResponseSurface({
      ...base,
      rows,
      axisFits: { time: { describe: 'linear' } }
    }).rows
    const s = res.find((x) => x.uniqID === 'g0')!.rs!.surface!
    expect(s.byTime.every((t) => t.model == null)).toBe(true)
    expect(s.byDose.length).toBeGreaterThan(0)
    expect(s.byDose.every((t) => t.model === 'linear')).toBe(true)
  })
})

describe('a surface against one position (dose 0 at the lowest temperature)', () => {
  const TEMPS = [37, 41, 45, 49, 53, 57, 61]
  const DOSE = [0, 1, 10, 100, 1000]
  // every protein melts; the first 12 are stabilised by the drug (their melt shifted up to 8 °C)
  const r2 = rng(17)
  const tpp: StandardRow[] = []
  for (let g = 0; g < 40; g++) {
    const a = 20 + 3 * r2()
    const tm = 47 + 4 * r2()
    for (let rep = 1; rep <= 3; rep++)
      for (const t of TEMPS)
        for (const d of DOSE) {
          const shift = g < 12 ? 8 / (1 + 30 / Math.max(d, 1e-9)) : 0
          const frac = 1 / (1 + Math.exp((t - tm - shift) / 2))
          tpp.push({
            uniqID: `g${g}`,
            cell: '',
            cmpd: 'A',
            dose: d,
            time: null,
            rep,
            extra: { temp: String(t) },
            value: 2 ** (a + Math.log2(frac) + 0.1 * normal(r2))
          })
        }
  }
  const pos: ResponseInput = {
    rows: tpp,
    num: { cmpd: ['A'] },
    den: { dose: ['0'], '@temp': ['37'] },
    match: [],
    activeConditions: ['cmpd', 'dose', '@temp'],
    numericConditions: ['@temp'],
    curveAxis: 'surface',
    surfacePair: ['dose', '@temp'],
    axisBaselines: { '@temp': 'matched' },
    threshold: RESPONSE_THRESHOLD,
    describeAll: true
  }
  it('every cell but the position, dose 0’s melt included, on dose’s log axis a step below', () => {
    const res = runResponseSurface(pos).rows
    expect(res).toHaveLength(40)
    const rs = res[0].rs!
    expect(rs.cells).toHaveLength(TEMPS.length * DOSE.length - 1)
    expect(rs.cells!.some((c) => c.dose === 0 && c.time === 37)).toBe(false)
    expect(rs.cells!.filter((c) => c.dose === 0)).toHaveLength(TEMPS.length - 1)
    expect(rs.maps?.[0].zeroX).toBeLessThan(0)
    // the vehicle's melt is response here: every protein is called (as the window warns)
    expect(res.filter((x) => x.signf).length).toBeGreaterThan(35)
    // a dose curve at a hot temperature starts from dose 0's own (melted) value
    const sl = rs.surface!.byTime.find((t) => t.at === 53)!
    expect(sl.front).toBeLessThan(-0.5)
  })
  it('the 4PL detector and the joint description take the vehicle’s own melt as a term', () => {
    const res = runResponseSurface({ ...pos, detector: '4pl', surfaceDescription: 'joint' }).rows
    const g = res.find((x) => x.uniqID === 'g20')!.rs!
    // the preset's 6 + the vehicle's size, slope and midpoint
    expect(g.df1).toBe(9)
    expect(g.surface?.joint?.spec?.vehicle).toBe(true)
    expect(g.surface!.joint!.V!).toBeLessThan(-1)
  }, 180000)
})
