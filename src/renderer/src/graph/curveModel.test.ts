/**
 * The Curve fit window's model against the engine: each baseline it offers compiles to a config the
 * engine runs with that baseline, the picks it can't run are disabled, and saved configs read back.
 */
import { describe, expect, it } from 'vitest'

import { compareSlices, previewCompare, type CompareInput, type CondSelector, type StandardRow } from '../engine'
import { sampleRows, valuesOf } from './compareModel'
import { curveModel, readCurveState, type CurveState } from './curveModel'

const active = ['cell', 'cmpd', 'dose', 'time']
const DOSES = [1, 3, 10, 30, 100]
// cmpd A, B at five doses, and a baseline: DMSO at dose 0 (shared) or each compound's own dose 0.
function design(own: boolean): StandardRow[] {
  const out: StandardRow[] = []
  const cmpds: Array<[string, number[]]> = own
    ? [['A', [0, ...DOSES]], ['B', [0, ...DOSES]]]
    : [['A', DOSES], ['B', DOSES], ['DMSO', [0]]]
  let k = 0
  for (const cell of ['M', 'W'])
    for (const time of [0, 8, 24])
      for (const [cmpd, doses] of cmpds)
        for (const dose of doses)
          for (const rep of [1, 2])
            for (const uniqID of ['g1', 'g2'])
              out.push({ uniqID, cell, cmpd, dose, time, rep, value: 10 + (k++ % 7) })
  return out
}
const shared = design(false)
const own = design(true)

const fresh = (axis: CurveState['axis'] = 'dose'): CurveState => ({
  detection: '4pl',
  axis,
  surfaceFit: 'slices',
  filter: {},
  drop: {},
  bDose: axis === 'time' ? [] : ['0'],
  bTime: axis === 'time' ? ['0'] : []
})
const run = (rows: StandardRow[], s: CurveState) => {
  const m = curveModel(s, sampleRows(rows, active), active)
  const input: CompareInput = { rows, activeConditions: active, num: m.num, den: m.den, match: m.match, curveAxis: m.refAx }
  return { m, input, preview: previewCompare(input), slices: m.picked ? compareSlices(input).slices : [] }
}
// each curve's group and its baseline, as "cmpd|cell|time ← baseline cmpd|time"
const pairs = (slices: ReturnType<typeof run>['slices']): string[] =>
  slices
    .map((s) => {
      const g = (c: string): string => valuesOf(s.grp, c).join('+')
      const gd = valuesOf(s.grp, 'dose')
      const b = (c: string): string => valuesOf(s.denSlice, c).join('+')
      return `${g('cmpd')}${gd.length === 1 ? `@${gd[0]}` : ''}|${g('cell')}|${g('time')} ← ${b('cmpd')}@${b('dose')}|${b('cell')}|${b('time')}`
    })
    .sort()

describe('baselines the engine runs', () => {
  it('a dose column (dose 0): each time against the baseline at that time; DMSO shared', () => {
    const { m, preview, slices } = run(shared, fresh())
    expect(m.num).toEqual({ dose: ['1', '3', '10', '30', '100'] })
    expect(m.den).toEqual({ dose: ['0'] })
    expect(preview.warnings).toEqual([])
    expect(preview.controlTreated).toBeFalsy()
    expect(pairs(slices)).toContain('A|M|8 ← DMSO@0|M|8')
    expect(slices).toHaveLength(2 * 2 * 3) // cmpd × cell × time
  })

  it('a dose column on the own-dose-0 design: each compound against its own dose 0', () => {
    const { preview, slices } = run(own, fresh())
    expect(preview.warnings).toEqual([])
    expect(pairs(slices)).toContain('B|W|24 ← B@0|W|24')
  })

  it('one position (dose 0 at time 0): every time against the 0 h baseline', () => {
    const { m, preview, slices } = run(own, { ...fresh(), bTime: ['0'] })
    expect(m.den).toEqual({ dose: ['0'], time: ['0'] })
    expect(preview.warnings).toEqual([])
    expect(pairs(slices)).toContain('A|M|24 ← A@0|M|0')
  })

  it('a time row on a time axis: each dose against itself at time 0', () => {
    const { m, preview, slices } = run(own, fresh('time'))
    expect(m.num).toEqual({ time: ['8', '24'] })
    expect(m.den).toEqual({ time: ['0'] })
    expect(preview.warnings.filter((w) => !w.includes('at least 4'))).toEqual([])
    expect(pairs(slices)).toContain('A@10|M|8+24 ← A@10|M|0')
  })

  it('a surface: dose 0 per time, its time never pinned', () => {
    const { m, preview } = run(shared, fresh('surface'))
    expect(m.surface).toBe(true)
    expect(m.den).toEqual({ dose: ['0'] })
    expect(m.num.time).toBeUndefined()
    expect(m.timeChips.every((h) => h.why)).toBe(true)
    expect(preview.warnings).toEqual([])
  })

  it('a surface with a time filtered out: the curves keep the other times', () => {
    const { m, preview } = run(shared, { ...fresh('surface'), filter: { time: ['24'] } })
    expect(m.num.time).toEqual(['0', '8'])
    expect(m.den.time).toBeUndefined()
    expect(m.gy).toEqual(['0', '8'])
    expect(preview.warnings).toEqual([])
  })
})

describe('picks the engine cannot run are disabled', () => {
  const m = curveModel(fresh(), sampleRows(own, active), active)
  it('a second dose (a pooled baseline)', () => {
    expect(m.doseChips.find((h) => h.v === '1')!.why).toMatch(/pooled/)
  })
  it('a time alone on a dose axis is allowed only with the dose picked (one position)', () => {
    expect(m.timeChips.every((h) => !h.why)).toBe(true)
    const none = curveModel({ ...fresh(), bDose: [] }, sampleRows(own, active), active)
    expect(none.timeChips.every((h) => h.why)).toBe(true)
    expect(none.picked).toBe(false)
  })
})

describe('filter and context', () => {
  it('a filtered cell is pinned alike on both sides; a dropped compound only on the curves', () => {
    const { m, preview, slices } = run(own, { ...fresh(), filter: { cell: ['W'] }, drop: { cmpd: ['B'] } })
    expect(m.num.cell).toEqual(['M'])
    expect(m.den.cell).toEqual(['M'])
    expect(m.num.cmpd).toEqual(['A'])
    expect(m.den.cmpd).toBeUndefined()
    expect(preview.warnings).toEqual([])
    expect(new Set(slices.map((s) => valuesOf(s.grp, 'cmpd').join()))).toEqual(new Set(['A']))
  })
})

describe('time as context on a dose axis', () => {
  it('lists time in context; leaving a time out drops its curves (matched or pinned baseline)', () => {
    const matched = run(own, { ...fresh(), drop: { time: ['24'] } })
    expect(matched.m.ctxConds).toContain('time')
    expect(matched.m.num.time).toEqual(['0', '8'])
    expect(new Set(matched.slices.map((sl) => valuesOf(sl.grp, 'time').join()))).toEqual(new Set(['0', '8']))
    const pinned = run(own, { ...fresh(), bTime: ['0'], drop: { time: ['24'] } })
    expect(pinned.m.num.time).toEqual(['0', '8'])
    expect(pinned.m.den.time).toEqual(['0'])
    expect(new Set(pinned.slices.map((sl) => valuesOf(sl.grp, 'time').join()))).toEqual(new Set(['0', '8']))
  })
})

describe('saved configs read back', () => {
  it('a legacy DMSO config (den on the control compound) reads as the dose-0 column and runs the same', () => {
    const legacy: { num: CondSelector; den: CondSelector } = { num: { cmpd: ['A', 'B'], dose: ['1', '3', '10', '30', '100'] }, den: { cmpd: ['DMSO'] } }
    const s = readCurveState({ ...legacy, curveAxis: 'dose' }, sampleRows(shared, active), active, { axis: 'dose', detection: '4pl' })
    expect(s.bDose).toEqual(['0'])
    expect(s.bTime).toEqual([])
    // DMSO, never dosed, isn't read as a compound left out
    expect(s.drop).toEqual({})
    const then = compareSlices({ rows: shared, activeConditions: active, ...legacy, match: ['cell', 'time', 'cmpd'], curveAxis: 'dose' }).slices
    expect(pairs(run(shared, s).slices)).toEqual(pairs(then))
  })

  it('a config this window wrote reads back to the same state', () => {
    const s0 = { ...fresh(), bTime: ['0'], filter: { cell: ['W'] } }
    const { m } = run(own, s0)
    const s1 = readCurveState({ num: m.num, den: m.den, curveAxis: 'dose' }, sampleRows(own, active), active, { axis: 'dose', detection: '4pl' })
    expect(s1.bDose).toEqual(['0'])
    expect(s1.bTime).toEqual(['0'])
    expect(s1.filter).toEqual({ cell: ['W'] })
  })
})

describe('the baseline in words (plots: "baseline (…)")', () => {
  it('names what the baseline holds that the curve does not share', async () => {
    const { baselineText } = await import('../engine')
    const at = (rows: StandardRow[], f: Partial<StandardRow>): StandardRow[] =>
      rows.filter((r) => Object.entries(f).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v))
    // DMSO design, dose curve at 8 h against dose 0 at 8 h (matched time): "DMSO · dose 0"
    expect(baselineText(at(shared, { cmpd: 'DMSO', time: 8, cell: 'M' }), at(shared, { cmpd: 'A', time: 8, cell: 'M' }))).toBe('DMSO · dose 0')
    // own dose 0, one position at time 0, for the 24 h curve: "dose 0 · time 0"
    expect(baselineText(at(own, { cmpd: 'A', dose: 0, time: 0, cell: 'M' }), at(own, { cmpd: 'A', time: 24, cell: 'M' }).filter((r) => (r.dose as number) > 0))).toBe('dose 0 · time 0')
    // time curve of dose 10 against itself at time 0: "time 0"
    expect(baselineText(at(own, { cmpd: 'A', dose: 10, time: 0, cell: 'M' }), at(own, { cmpd: 'A', dose: 10, cell: 'M' }).filter((r) => (r.time as number) > 0))).toBe('time 0')
  })
})

describe('an axis filtered down to one value is no axis', () => {
  it('time filtered to one: no time row, no surface, time a context condition', () => {
    const { m, preview } = run(own, { ...fresh('surface'), filter: { time: ['0', '8'] } })
    expect(m.hasTime).toBe(false)
    expect(m.surface).toBe(false)
    expect(m.refAx).toBe('dose')
    expect(m.gy).toEqual([null])
    expect(m.timeChips).toEqual([])
    expect(m.ctxConds).toContain('time')
    expect(m.num.time).toEqual(['24'])
    expect(m.den.time).toEqual(['24'])
    expect(preview.warnings).toEqual([])
  })
  it('time with two values left is still an axis', () => {
    const m = curveModel({ ...fresh(), filter: { time: ['0'] } }, sampleRows(own, active), active)
    expect(m.hasTime).toBe(true)
    expect(m.gy).toEqual(['8', '24'])
  })
})
