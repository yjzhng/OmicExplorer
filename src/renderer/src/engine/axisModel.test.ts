import { describe, expect, it } from 'vitest'

import {
  axisMapFor,
  axisModelFor,
  DEFAULT_MODEL,
  detectAxisScale,
  treatedLevel,
  DOSE_MODEL,
  fromX,
  TIME_MODEL,
  toX
} from './axisModel'
import { numValue } from './compare'
import { curveMetrics } from './curveFit'
import { controlIsBaseline, runCurveFit } from './direct'
import { responseCurve } from './plotData'
import {
  RESPONSE_THRESHOLD,
  responseMetrics,
  runResponseSurface,
  type ResponseInput
} from './responseSurface'
import { rng } from './sam'
import type { CompareResultRow, ConditionKey, StandardRow } from './types'

const normal = (r: () => number): number =>
  Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())

describe('axis model', () => {
  it('dose and time are presets; any other condition starts linear, against one reference', () => {
    expect(axisModelFor('dose')).toEqual({ scale: 'log', baseline: 'reference' })
    expect(axisModelFor('time')).toEqual({ scale: 'log', baseline: 'matched' })
    expect(axisModelFor('@temp')).toEqual(DEFAULT_MODEL)
    expect(axisModelFor('@temp', TIME_MODEL)).toBe(TIME_MODEL)
  })
  it('only a log axis with a matched baseline takes an offset: the smallest gap with 0', () => {
    expect(axisMapFor(TIME_MODEL, [30, 120, 480]).offset).toBe(30)
    expect(axisMapFor(TIME_MODEL, [5, 6, 60]).offset).toBe(1)
    expect(axisMapFor(DOSE_MODEL, [1, 10]).offset).toBe(0)
    expect(axisMapFor({ scale: 'linear', baseline: 'matched' }, [2, 4]).offset).toBe(0)
  })
  it('maps levels to x and back', () => {
    const t = axisMapFor(TIME_MODEL, [30, 120])
    expect(toX(t, 0)).toBeCloseTo(Math.log10(30))
    expect(fromX(t, toX(t, 120))).toBeCloseTo(120)
    // a linear axis counts in steps of its median spacing
    const lin = axisMapFor(DEFAULT_MODEL, [37, 41, 45, 53])
    expect(lin.step).toBe(4)
    expect(toX(lin, 41)).toBe(41 / 4)
    expect(fromX(lin, toX(lin, 52.5))).toBeCloseTo(52.5)
  })
})

describe('numValue', () => {
  it('reads a preset or a custom value as a number; absent or not a number is null', () => {
    const r = { dose: 10, time: null, extra: { temp: '37.5', none: '', word: 'hot' } }
    expect(numValue(r, 'dose')).toBe(10)
    expect(numValue(r, 'time')).toBeNull()
    expect(numValue(r, '@temp')).toBe(37.5)
    expect(numValue(r, '@none')).toBeNull()
    expect(numValue(r, '@word')).toBeNull()
    expect(numValue(r, '@missing')).toBeNull()
  })
})

describe('controlIsBaseline follows the axis model, not the name', () => {
  const ctl = [{ cmpd: 'A', dose: 0, extra: { hours: '0' } }] as unknown as StandardRow[]
  const treatedAt0 = [{ cmpd: 'A', dose: 5, extra: { hours: '0' } }] as unknown as StandardRow[]
  it('against one reference, only untreated samples are a baseline', () => {
    expect(controlIsBaseline(ctl, '@hours')).toBe(true)
    expect(controlIsBaseline(treatedAt0, '@hours')).toBe(false)
  })
  it('against a matched control, a sample at the axis’s level 0 is one too', () => {
    expect(controlIsBaseline(treatedAt0, '@hours', TIME_MODEL)).toBe(true)
    // an absent custom value ('') is no level, so it counts as 0
    const absent = [{ cmpd: 'A', dose: 5, extra: { hours: '' } }] as unknown as StandardRow[]
    expect(controlIsBaseline(absent, '@hours', TIME_MODEL)).toBe(true)
  })
})

// ── the same experiment over a preset and over a custom condition ────────────────────────────

const DOSES = [1, 3, 10, 30, 100, 300, 1000]
const TIMES = [30, 120, 480, 1440]

/** A dose × time design: DMSO at every time, A at every dose and time; 15 of 60 genes respond (in
 *  dose and time), every fifth drifts with time. */
function design(vehAllTimes: boolean): StandardRow[] {
  const r = rng(3)
  const rows: StandardRow[] = []
  for (let g = 0; g < 60; g++) {
    const a = 20 + 3 * r()
    const resp = g < 15 ? (g % 2 ? 1.6 : -1.2) : 0
    const drift = g % 5 === 0 ? 0.4 : 0
    for (let rep = 1; rep <= 3; rep++)
      for (const t of [0, ...TIMES]) {
        const dr = drift * Math.log10(t + 30)
        const at = (cmpd: string, dose: number, e: number): StandardRow => ({
          uniqID: `g${g}`,
          cell: 'c1',
          cmpd,
          dose,
          time: t,
          rep,
          value: 2 ** (a + dr + e + 0.2 * normal(r))
        })
        if (vehAllTimes || t === 0) rows.push(at('DMSO', 0, 0))
        if (t > 0)
          for (const d of DOSES)
            rows.push(at('A', d, (resp / (1 + (30 / d) ** 1.3)) * (1 - Math.exp(-t / 200))))
      }
  }
  return rows
}

/** The rows with one preset condition moved into a custom one (its values as text, as imported). */
const asCustom = (rows: StandardRow[], from: 'dose' | 'time', to: string): StandardRow[] =>
  rows.map((r) => ({ ...r, [from]: null, extra: { [to]: String(r[from] ?? '') } }))

/** What a fit says, without its labels (a custom axis is named differently). */
const fitOf = (r: CompareResultRow): unknown => {
  const { baseline: _b, axis: _a, ...rs } = r.rs!
  void _b
  void _a
  return { id: r.uniqID, log2FC: r.log2FC, pP: r.pP, pQ: r.pQ, signf: r.signf, rs }
}

const run = (
  rows: StandardRow[],
  axis: ConditionKey,
  active: ConditionKey[],
  extra: Partial<ResponseInput> = {}
): CompareResultRow[] =>
  runResponseSurface({
    rows,
    num: { cmpd: ['A'] },
    den: { cmpd: ['DMSO'] },
    match: [],
    activeConditions: active,
    numericConditions: [],
    curveAxis: axis,
    threshold: RESPONSE_THRESHOLD,
    describeAll: true,
    ...extra
  }).rows

describe('a custom condition fitted with a preset’s model fits as the preset does', () => {
  it('time → @hours with the time model: the same curves, offset and descriptions', () => {
    const rows = design(true)
    const time = run(rows, 'time', ['cell', 'cmpd', 'dose', 'time'])
    const hours = run(
      asCustom(rows, 'time', 'hours'),
      '@hours',
      ['cell', 'cmpd', 'dose', '@hours'],
      {
        axisModel: TIME_MODEL
      }
    )
    expect(time.length).toBeGreaterThan(0)
    expect(time.some((r) => r.signf)).toBe(true)
    expect(time[0].rs?.timeOffset).toBe(30)
    expect(hours.map(fitOf)).toEqual(time.map(fitOf))
    expect(hours[0].rs?.axis).toBe('@hours')
  })
  it('dose → @conc with the dose model, its control at t₀ only: the same curves and drift', () => {
    const rows = design(false)
    const active: ConditionKey[] = ['cell', 'cmpd', 'time']
    const dose = run(rows, 'dose', [...active, 'dose'])
    const conc = run(asCustom(rows, 'dose', 'conc'), '@conc', [...active, '@conc'], {
      axisModel: DOSE_MODEL
    })
    expect(dose.some((r) => r.signf)).toBe(true)
    expect(dose[0].rs?.timeOffset).toBeUndefined()
    expect(conc.map(fitOf)).toEqual(dose.map(fitOf))
  })
})

describe('a linear axis', () => {
  // An evenly sampled time course in hours, its control at every time point.
  const HOURS = [0, 2, 4, 6, 8, 10, 12, 14]
  const r = rng(9)
  const rows: StandardRow[] = []
  for (let g = 0; g < 60; g++) {
    const a = 20 + 3 * r()
    const resp = g < 12 ? 2 : 0
    for (let rep = 1; rep <= 3; rep++)
      for (const h of HOURS) {
        const extra = { hours: String(h) }
        const at = (cmpd: string, e: number): StandardRow => ({
          uniqID: `g${g}`,
          cell: '',
          cmpd,
          dose: null,
          time: null,
          rep,
          extra,
          value: 2 ** (a + e + 0.15 * normal(r))
        })
        rows.push(at('DMSO', 0))
        if (h > 0) rows.push(at('A', resp / (1 + Math.exp(-(h - 7)))))
      }
  }
  const res = run(rows, '@hours', ['cmpd', '@hours'], {
    axisModel: { scale: 'linear', baseline: 'matched' }
  })

  it('places the levels at their own values, the level 0 the baseline', () => {
    expect(res).toHaveLength(60)
    const x = res[0].rs!
    expect(x.scale).toBe('linear')
    expect(x.timeOffset).toBeUndefined()
    // in steps of its spacing (2 h)
    expect(x.step).toBe(2)
    expect(x.x).toEqual(HOURS.map((h) => h / 2))
  })
  it('finds the responders and describes them in hours', () => {
    const called = res.filter((x) => x.signf)
    expect(called.filter((x) => Number(x.uniqID.slice(1)) < 12).length).toBeGreaterThanOrEqual(10)
    expect(called.filter((x) => Number(x.uniqID.slice(1)) >= 12).length).toBeLessThanOrEqual(2)
    const mids = called
      .filter((x) => Number(x.uniqID.slice(1)) < 12)
      .map((x) => x.rs!.desc!.mid)
      .sort((a, b) => a - b)
    expect(mids[mids.length >> 1]).toBeGreaterThan(5)
    expect(mids[mids.length >> 1]).toBeLessThan(9)
  })
  it('draws on the axis’s own units', () => {
    const c = responseCurve(res[0], 'curve')!
    expect(c.points.map((p) => p.x)).toEqual(HOURS.slice(1))
    expect(c.x[0]).toBeCloseTo(2)
    expect(c.x[c.x.length - 1]).toBeCloseTo(14)
  })
})

describe('detectAxisScale', () => {
  it('reads the scale off the levels’ spacing, 0 ignored', () => {
    expect(detectAxisScale([0, 0.1, 1, 10, 100]).scale).toBe('log')
    expect(detectAxisScale([1, 3, 10, 30, 100]).scale).toBe('log')
    expect(detectAxisScale([1, 2, 4, 8, 16]).scale).toBe('log')
    expect(detectAxisScale([0, 24, 48, 72]).scale).toBe('linear')
    expect(detectAxisScale([-10, -9, -8, -7]).scale).toBe('linear')
  })
  it('can’t tell from two levels, or from a spacing neither even', () => {
    expect(detectAxisScale([0, 1, 10]).scale).toBeNull()
    expect(detectAxisScale([1, 2, 5, 6]).scale).toBeNull()
  })
  it('when it can’t tell, every axis is linear — dose and time too', () => {
    expect(axisModelFor('dose', undefined, undefined, [0, 1, 10]).scale).toBe('linear')
    expect(axisModelFor('time', undefined, undefined, [1, 2, 5, 6]).scale).toBe('linear')
    // the baseline stays the axis's own
    expect(axisModelFor('time', undefined, undefined, [1, 2, 5, 6]).baseline).toBe('matched')
    expect(axisModelFor('dose', undefined, undefined, [0, 1, 10, 100]).scale).toBe('log')
  })
  it('treated levels: above 0 on a log axis, any but 0 on a linear one', () => {
    expect(treatedLevel('log', -8)).toBe(false)
    expect(treatedLevel('linear', -8)).toBe(true)
    expect(treatedLevel('linear', 0)).toBe(false)
    expect(treatedLevel('linear', null)).toBe(false)
  })
})

describe('the scale follows the data, for every axis', () => {
  // A dose series supplied already logged (log₁₀ M), the vehicle with no dose.
  const LOGD = [-10, -9.5, -9, -8.5, -8, -7.5, -7, -6.5]
  const r = rng(13)
  const rows: StandardRow[] = []
  for (let g = 0; g < 60; g++) {
    const a = 20 + 3 * r()
    const resp = g < 12 ? 2 : 0
    for (let rep = 1; rep <= 3; rep++) {
      const at = (cmpd: string, dose: number | null, e: number): StandardRow => ({
        uniqID: `g${g}`,
        cell: '',
        cmpd,
        dose,
        time: null,
        rep,
        value: 2 ** (a + e + 0.15 * normal(r))
      })
      rows.push(at('DMSO', null, 0))
      for (const d of LOGD) rows.push(at('A', d, resp / (1 + 10 ** (-1.5 * (d + 8.5)))))
    }
  }
  const input = {
    rows,
    num: { cmpd: ['A'] },
    den: { cmpd: ['DMSO'] },
    match: [],
    activeConditions: ['cmpd', 'dose'] as ConditionKey[],
    numericConditions: [],
    curveAxis: 'dose' as const
  }

  it('already-logged doses fit on their own values; the potency is EC50 there', () => {
    const res = runResponseSurface({ ...input, threshold: RESPONSE_THRESHOLD, describeAll: true })
    const x = res.rows.find((r) => r.uniqID === 'g0')!
    expect(x.rs?.scale).toBe('linear')
    expect(x.rs?.step).toBe(0.5)
    const m = responseMetrics(x, 1e-9)
    expect(m.pEC50).toBeUndefined()
    expect(m.EC50 as number).toBeGreaterThan(-9.3)
    expect(m.EC50 as number).toBeLessThan(-7.7)
  })
  it('the 4PL method follows it too', () => {
    const res = runCurveFit(input)
    const x = res.rows.find((r) => r.uniqID === 'g0')!
    expect(x.curve?.scale).toBe('linear')
    const m = curveMetrics(x.log2FC, x.curve!, undefined, 1e-9)
    expect(m.pEC50).toBeUndefined()
    expect(m.EC50 as number).toBeGreaterThan(-9.3)
    expect(m.EC50 as number).toBeLessThan(-7.7)
  })
  it('an override wins over the detection', () => {
    const lin = rows.map((r) => ({ ...r, dose: r.dose == null ? 0 : 10 ** (r.dose + 10) }))
    const res = runResponseSurface({
      ...input,
      rows: lin,
      threshold: RESPONSE_THRESHOLD,
      axisScale: 'linear'
    })
    expect(res.rows[0].rs?.scale).toBe('linear')
    const detected = runResponseSurface({ ...input, rows: lin, threshold: RESPONSE_THRESHOLD })
    expect(detected.rows[0].rs?.scale).toBeUndefined()
  })
  it('evenly spaced time is linear', () => {
    const t = rows.map((r) => ({
      ...r,
      dose: null,
      time: r.dose == null ? 0 : (r.dose + 10.5) * 48
    }))
    const res = runResponseSurface({
      ...input,
      rows: t,
      activeConditions: ['cmpd', 'time'],
      numericConditions: [],
      curveAxis: 'time',
      threshold: RESPONSE_THRESHOLD
    })
    expect(res.rows[0].rs?.scale).toBe('linear')
    expect(res.rows[0].rs?.timeOffset).toBeUndefined()
  })
})
