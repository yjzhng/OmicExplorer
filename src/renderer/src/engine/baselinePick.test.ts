/** A baseline picked anywhere on a one-axis curve: dose 100 picked, every dose — dose 0 too — is
 *  against dose 100, by either method (the spline detector, CurveCurator's 4PL). */
import { describe, expect, it } from 'vitest'

import { curveModel } from '../graph/curveModel'
import { sampleRows } from '../graph/compareModel'
import { runCurveFit } from './direct'
import { RESPONSE_THRESHOLD, runResponseSurface } from './responseSurface'
import { rng } from './sam'
import { numericConds, type StandardRow } from './types'

const DOSES = [0, 1, 3, 10, 30, 100, 300, 1000, 3000]
const r = rng(5)
const normal = (): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
// a falling response: log₂ −2 at full effect, half at 30
const effect = (d: number): number => (d > 0 ? -2 / (1 + 30 / d) : 0)
const rows: StandardRow[] = []
for (let g = 0; g < 40; g++)
  for (const d of DOSES)
    for (let rep = 1; rep <= 3; rep++)
      rows.push({
        uniqID: `g${g}`,
        cell: '',
        cmpd: 'X',
        dose: d,
        rep,
        value: 2 ** (20 + (g < 20 ? effect(d) : 0) + 0.1 * normal())
      } as StandardRow)
const levelsBut = (v: number) => DOSES.filter((d) => d !== v).map(String)
const input = {
  rows,
  num: { dose: levelsBut(100) },
  den: { dose: ['100'] },
  match: [],
  activeConditions: ['cmpd', 'dose'] as Array<'cmpd' | 'dose'>,
  numericConditions: [],
  curveAxis: 'dose' as const,
  describeAll: true
}

describe('a one-axis curve against a baseline among its levels', () => {
  it('the spline method: dose 0 a point, dose 100 the baseline, values against it', () => {
    const res = runResponseSurface({ ...input, threshold: RESPONSE_THRESHOLD })
    const rs = res.rows.find((x) => x.uniqID === 'g0')!.rs!
    // x[0] the baseline (dose 100, 0), then every other level — dose 0 among them, lowest
    expect(rs.y![0]).toBe(0)
    expect(rs.x!.length).toBe(DOSES.length)
    expect(rs.x!.slice(1).some((v) => v < rs.x![0])).toBe(true)
    // dose 0 (placed lowest) reads its effect less dose 100's: +2·100/130
    expect(rs.y![1]).toBeCloseTo(-effect(100), 0)
    expect(res.rows.find((x) => x.uniqID === 'g0')!.signf).toBe(true)
    expect(rs.desc).toBeTruthy()
  })
  it('CurveCurator: the control’s ratio 1 at dose 100, dose 0 a point below it', () => {
    const res = runCurveFit(input)
    const c = res.rows.find((x) => x.uniqID === 'g0')!.curve!
    expect(c.x.length).toBe(3 * (DOSES.length - 1))
    expect(c.baseX).toBeGreaterThan(Math.min(...c.x))
    // dose 0's ratio to dose 100: 2^(−effect(100))
    const low = Math.min(...c.x)
    const at0 = c.y.filter((_, i) => c.x[i] === low)
    expect(Math.log2(at0.reduce((a, v) => a + v, 0) / at0.length)).toBeCloseTo(-effect(100), 0)
  })
})

describe('one position with a vehicle compound: its dose 0 at every other time a cell', () => {
  const TIMES = [0, 60, 120, 240]
  const SURF_DOSES = [1, 10, 100, 1000]
  const rs2: StandardRow[] = []
  // the vehicle drifts with time (+0.3 per step): against one position (dose 0 at t₀) that's
  // response, at dose 0 too
  for (let g = 0; g < 6; g++)
    for (const [k, t] of TIMES.entries())
      for (let rep = 1; rep <= 2; rep++) {
        const drift = 0.3 * k
        rs2.push({
          uniqID: `g${g}`,
          cell: '',
          cmpd: 'DMSO',
          dose: 0,
          time: t,
          rep,
          value: 2 ** (20 + drift + 0.05 * normal())
        } as StandardRow)
        for (const d of SURF_DOSES)
          rs2.push({
            uniqID: `g${g}`,
            cell: '',
            cmpd: 'X',
            dose: d,
            time: t,
            rep,
            value: 2 ** (20 + drift + effect(d) + 0.05 * normal())
          } as StandardRow)
      }
  it('compiled as the Curve fit dialog does: the dose-0 column measured at every time but t₀', () => {
    const active: Array<'cmpd' | 'dose' | 'time'> = ['cmpd', 'dose', 'time']
    const m = curveModel(
      {
        detection: 'spline',
        axis: 'surface',
        intent: 'shape',
        filter: {},
        drop: {},
        base: { dose: ['0'], time: ['0'] }
      },
      sampleRows(rs2, active),
      active,
      numericConds([])
    )
    const fit = runResponseSurface({
      rows: rs2,
      num: m.num,
      den: m.den,
      match: m.match,
      activeConditions: active,
      numericConditions: [],
      curveAxis: 'surface',
      axisBaselines: m.baselines,
      describeAll: true,
      threshold: RESPONSE_THRESHOLD
    })
    const rs = fit.rows.find((x) => x.uniqID === 'g0' && x.cmpd === 'X')!.rs!
    const d0 = rs.cells!.filter((c) => c.dose === 0).sort((a, b) => a.time - b.time)
    expect(d0.map((c) => c.time)).toEqual([60, 120, 240])
    // the vehicle's own drift against t₀
    d0.forEach((c, i) => expect(c.y).toBeCloseTo(0.3 * (i + 1), 0))
    expect((rs.controls ?? []).filter((c) => c.vehicle).map((c) => [c.dose, c.time])).toEqual([
      [0, 0]
    ])
  })
})
