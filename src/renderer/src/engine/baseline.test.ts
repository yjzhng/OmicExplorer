import { describe, expect, it } from 'vitest'

import { axisMapFor, axisModelFor, baseLevelOf, fromX } from './axisModel'
import { runCurveFit } from './direct'
import { RESPONSE_THRESHOLD, runResponseSurface } from './responseSurface'
import { rng } from './sam'
import type { CompareInput, CompareResultRow, ConditionKey, StandardRow } from './types'

const normal = (r: () => number): number =>
  Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())

describe('the baseline is the Curve fit’s to set, on any axis', () => {
  it('overrides the preset’s, keeping the scale', () => {
    expect(axisModelFor('dose', undefined, undefined, undefined, 'matched')).toEqual({
      scale: 'log',
      baseline: 'matched'
    })
    expect(axisModelFor('time', undefined, 'linear', undefined, 'reference')).toEqual({
      scale: 'linear',
      baseline: 'reference'
    })
  })
  it('a matched baseline sits at the control’s lowest level; above 0 it takes no offset', () => {
    expect(baseLevelOf([37, 37, null])).toBe(0)
    expect(baseLevelOf([37, 40])).toBe(37)
    expect(baseLevelOf([])).toBe(0)
    const m = { scale: 'log' as const, baseline: 'matched' as const }
    expect(axisMapFor(m, [40, 43], 37).offset).toBe(0)
    expect(axisMapFor(m, [30, 120]).offset).toBe(30)
  })
})

// ── ratio to the lowest level: a TPP-style melt, no control group ─────────────────────────────

const TEMPS = [37, 40, 43, 46, 49, 52, 55, 58, 61, 64, 67]
/** Compound A at every temperature, the soluble fraction melting with T; 12 of 60 genes are
 *  stabilised (their melt shifted 6 °C later). Nothing else: the baseline is the lowest temperature. */
function melt(): StandardRow[] {
  const r = rng(21)
  const rows: StandardRow[] = []
  for (let g = 0; g < 60; g++) {
    const a = 20 + 3 * r()
    const tm = 50 + 4 * r()
    for (let rep = 1; rep <= 3; rep++)
      for (const t of TEMPS) {
        // the share left soluble, log₂ — falls from 0 at 37 °C, later for the stabilised genes
        const shift = g < 12 ? 6 : 0
        const frac = 1 / (1 + Math.exp((t - tm - shift) / 2))
        rows.push({
          uniqID: `g${g}`,
          cell: '',
          cmpd: 'A',
          dose: null,
          time: null,
          rep,
          extra: { temp: String(t) },
          value:
            2 **
            (a + Math.log2(frac / (1 / (1 + Math.exp((37 - tm - shift) / 2)))) + 0.1 * normal(r))
        })
      }
  }
  return rows
}
const meltInput: CompareInput & { curveAxis: ConditionKey } = {
  rows: melt(),
  num: { '@temp': TEMPS.slice(1).map(String) },
  den: { '@temp': ['37'] },
  match: [],
  activeConditions: ['cmpd', '@temp'],
  numericConditions: ['@temp'],
  curveAxis: '@temp',
  axisBaseline: 'matched'
}

describe('a matched baseline above 0: ratio to the lowest temperature', () => {
  it('the spline curve starts at 37 °C, on the linear axis in steps', () => {
    const res = runResponseSurface({
      ...meltInput,
      threshold: RESPONSE_THRESHOLD,
      describeAll: true
    })
    const g = res.rows.find((r) => r.uniqID === 'g0')!.rs!
    expect(g.scale).toBe('linear')
    expect(g.step).toBe(3)
    expect(g.x).toEqual(TEMPS.map((t) => t / 3))
    expect(g.y![0]).toBe(0)
    // every melt is a response; its midpoint lies after the baseline, in °C
    const mids = res.rows.map((r) => r.rs!.desc?.mid).filter((m): m is number => m != null)
    expect(mids.length).toBeGreaterThan(40)
    expect(Math.min(...mids)).toBeGreaterThanOrEqual(37)
    const med = (a: number[]): number => [...a].sort((p, q) => p - q)[a.length >> 1]
    const midOf = (rs: CompareResultRow[]): number =>
      med(rs.map((r) => r.rs!.desc?.mid).filter((m): m is number => m != null))
    const stab = res.rows.filter((r) => Number(r.uniqID.slice(1)) < 12)
    const rest = res.rows.filter((r) => Number(r.uniqID.slice(1)) >= 12)
    expect(midOf(stab) - midOf(rest)).toBeGreaterThan(3)
  })
  it('the 4PL method puts the control at 37 °C, a real point, the midpoint after it', () => {
    const res = runCurveFit(meltInput)
    const c = res.rows.find((r) => r.uniqID === 'g0')!.curve!
    expect(c.scale).toBe('linear')
    expect(c.baseX).toBe(37 / 3)
    expect(c.timeOffset).toBeUndefined()
    for (const r of res.rows)
      expect(
        fromX({ scale: 'linear', offset: 0, step: 3 }, -r.curve!.pec50)
      ).toBeGreaterThanOrEqual(37 - 1e-9)
    // melting is a strong response: most curves beat flat
    // (pP is −log₁₀ p)
    expect(res.rows.filter((r) => (r.pP ?? 0) > -Math.log10(0.05)).length).toBeGreaterThan(40)
  })
  it('against one reference the 4PL’s control stays at −∞', () => {
    const res = runCurveFit({ ...meltInput, axisBaseline: 'reference' })
    expect(res.rows[0].curve!.baseX).toBeUndefined()
  })
})

// ── drift along any numeric condition, not only time ──────────────────────────────────────────

const DOSES = [1, 3, 10, 30, 100, 300, 1000]
const HOURS = [1, 4, 16, 48]
/** DMSO measured at hour 0 only, A at every dose and hour; every fifth gene drifts with the hour. */
function driftDesign(): StandardRow[] {
  const r = rng(5)
  const rows: StandardRow[] = []
  for (let g = 0; g < 40; g++) {
    const a = 20 + 3 * r()
    const resp = g < 10 ? 1.5 : 0
    const drift = g % 5 === 0 ? 0.6 : 0
    for (let rep = 1; rep <= 3; rep++)
      for (const h of [0, ...HOURS]) {
        const at = (cmpd: string, dose: number, e: number): StandardRow => ({
          uniqID: `g${g}`,
          cell: 'c1',
          cmpd,
          dose,
          time: h,
          rep,
          value: 2 ** (a + drift * Math.log10(h + 1) + e + 0.2 * normal(r))
        })
        if (h === 0) rows.push(at('DMSO', 0, 0))
        else for (const d of DOSES) rows.push(at('A', d, resp / (1 + 30 / d)))
      }
  }
  return rows
}

describe('drift is estimated along any numeric condition the vehicle wasn’t measured at', () => {
  const rows = driftDesign()
  const base = {
    num: { cmpd: ['A'] },
    den: { cmpd: ['DMSO'] },
    match: [],
    curveAxis: 'dose' as const,
    threshold: RESPONSE_THRESHOLD,
    describeAll: true
  }
  const fits = (rs: CompareResultRow[]): unknown =>
    rs.map((r) => ({ id: r.uniqID, log2FC: r.log2FC, pP: r.pP, y: r.rs?.y }))
  it('a numeric custom condition drifts as time does', () => {
    const time = runResponseSurface({
      ...base,
      rows,
      activeConditions: ['cell', 'cmpd', 'dose', 'time'],
      numericConditions: []
    }).rows
    const hours = runResponseSurface({
      ...base,
      rows: rows.map((r) => ({ ...r, time: null, extra: { hours: String(r.time) } })),
      activeConditions: ['cell', 'cmpd', 'dose', '@hours'],
      numericConditions: ['@hours']
    }).rows
    expect(time.length).toBeGreaterThan(0)
    expect(fits(hours)).toEqual(fits(time))
  })
  it('a categorical one doesn’t (its values aren’t levels to drift along)', () => {
    const cat = runResponseSurface({
      ...base,
      rows: rows.map((r) => ({ ...r, time: null, extra: { batch: String(r.time) } })),
      activeConditions: ['cell', 'cmpd', 'dose', '@batch'],
      numericConditions: []
    }).rows
    const time = runResponseSurface({
      ...base,
      rows,
      activeConditions: ['cell', 'cmpd', 'dose', 'time'],
      numericConditions: []
    }).rows
    // the drifting genes' curves differ once the drift isn't taken out
    const g0 = (rs: CompareResultRow[]): number[] =>
      rs.find((r) => r.uniqID === 'g0' && r.rs)!.rs!.y!
    expect(g0(cat)).not.toEqual(g0(time))
  })
})

describe('a time curve under the 4PL method: its control is t₀, a real point', () => {
  it('sits at log₁₀(0 + offset), the offset kept to map x back', () => {
    const rows = driftDesign().map((r) => ({ ...r, cmpd: r.cmpd === 'DMSO' ? 'A' : r.cmpd }))
    const res = runCurveFit({
      rows,
      num: { dose: ['30'] },
      den: { time: ['0'] },
      match: [],
      activeConditions: ['cell', 'cmpd', 'dose', 'time'],
      numericConditions: [],
      curveAxis: 'time',
      axisScale: 'log'
    })
    const c = res.rows[0].curve!
    expect(c.timeOffset).toBe(1)
    expect(c.baseX).toBeCloseTo(0)
  })
})
