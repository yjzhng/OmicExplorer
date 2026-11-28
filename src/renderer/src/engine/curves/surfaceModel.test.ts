/** One reading of a surface for every view (surfaceModel.ts) — checked across what a Curve fit can
 *  be: the joint surface or curves along dose at each time (test changes), against dose 0 at every
 *  time or one position, under either model view. Whatever the mode, a control reads 0, the lines
 *  and the surface agree, and the descriptor's fold change is the drawn model's. */
import { describe, expect, it } from 'vitest'

import { RESPONSE_THRESHOLD, runResponseSurface } from './responseSurface'
import { fittedSurfaceModel, placed, type SurfaceModel } from './surfaceModel'
import { rng } from '../compare/sam'
import type { CompareResultRow, StandardRow } from '../types'

const TIMES = [30, 60, 120, 240, 480]
const DOSES = [0, 1, 3, 10, 30, 100, 300, 1000]
const r = rng(11)
const normal = (): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
// 0–29 respond, more with time (a curve that changes across time); the rest don't. Every gene's
// times are separate plexes: a step per time shared by its vehicle and treated samples.
const responds = (g: number): boolean => g < 30
const effect = (g: number, d: number, t: number): number =>
  responds(g) && d > 0 ? (-2.5 * Math.sqrt(t / 480)) / (1 + 30 / d) : 0
const rows: StandardRow[] = []
for (let g = 0; g < 150; g++) {
  const plex = TIMES.map(() => 0.8 * normal())
  for (const [k, t] of TIMES.entries())
    for (const d of DOSES)
      for (let rep = 1; rep <= 2; rep++)
        rows.push({
          uniqID: `g${g}`,
          cell: '',
          cmpd: 'X',
          dose: d,
          time: t,
          rep,
          value: 2 ** (20 + plex[k] + effect(g, d, t) + 0.1 * normal())
        } as StandardRow)
}

type Pick = 'perTime' | 'position' | 'dose100' | 'time240'
type Mode = { intent: 'shape' | 'changes'; position: boolean; pick?: Pick }
const DEN: Record<Pick, Record<string, string[]>> = {
  perTime: { dose: ['0'] },
  position: { dose: ['0'], time: ['30'] },
  dose100: { dose: ['100'] },
  time240: { time: ['240'] }
}
const pickOf = (m: Mode): Pick => m.pick ?? (m.position ? 'position' : 'perTime')
const run = (mode: Mode) =>
  runResponseSurface({
    rows,
    num: { cmpd: ['X'] },
    den: DEN[pickOf(mode)],
    intent: mode.intent,
    match: [],
    activeConditions: ['cmpd', 'dose', 'time'],
    numericConditions: [],
    curveAxis: 'surface',
    ...(mode.intent === 'changes' ? { responseAxis: 'dose' as const } : null),
    describeAll: true,
    threshold: RESPONSE_THRESHOLD
  }).rows

const MODES: Mode[] = [
  { intent: 'shape', position: false },
  { intent: 'shape', position: true },
  { intent: 'changes', position: false },
  { intent: 'changes', position: true },
  { intent: 'shape', position: false, pick: 'dose100' },
  { intent: 'shape', position: false, pick: 'time240' },
  { intent: 'changes', position: false, pick: 'dose100' },
  { intent: 'changes', position: false, pick: 'time240' }
]
const results = new Map(MODES.map((m) => [JSON.stringify(m), run(m)]))
const of = (m: Mode): CompareResultRow[] => results.get(JSON.stringify(m))!

/** The model's value at every cell and control, by the lines along each axis and by the grid. */
function readings(m: SurfaceModel) {
  const { tx, uOf } = m.axes
  const g = m.grid(m.gridDoses, m.gridTimes)
  return m.gridTimes.flatMap((t, i) =>
    m.gridDoses.map((d, j) => ({
      d,
      t,
      at: m.at(d, t),
      dose: m.doseCurve(t, [tx(d)])[0],
      time: m.timeCurve(d, [uOf(t)])[0],
      grid: g[i][j]
    }))
  )
}

describe('a surface read the same way in every mode', () => {
  for (const mode of MODES)
    for (const view of ['descriptor', 'detector'] as const)
      it(`${mode.intent}, ${pickOf(mode)}, ${view}: controls 0, lines and surface agree`, () => {
        const sample = of(mode)
          .filter((x) => responds(Number(x.uniqID.slice(1))))
          .slice(0, 8)
        expect(sample.length).toBeGreaterThan(0)
        for (const row of sample) {
          const rs = row.rs!
          const m = fittedSurfaceModel(rs, view)!
          if (m.kind === 'none') continue
          const ctl = placed(rs.controls ?? [], m.axes)
          expect(ctl.length).toBeGreaterThan(0)
          for (const c of ctl) expect(m.at(c.dose, c.time)).toBe(0)
          for (const p of readings(m)) {
            if (p.at == null) continue
            expect(p.dose).toBeCloseTo(p.at, 6)
            expect(p.grid).toBeCloseTo(p.at, 6)
            expect(p.time).toBeCloseTo(p.at, 6)
          }
          if (view === 'descriptor' && rs.descPeak != null) {
            const peak = placed(rs.cells!, m.axes)
              .map((c) => m.at(c.dose, c.time) ?? 0)
              .reduce((a, v) => (Math.abs(v) > Math.abs(a) ? v : a), 0)
            expect(rs.descPeak).toBeCloseTo(peak, 9)
          }
        }
      })

  for (const intent of ['shape', 'changes'] as const)
    it(`${intent}, dose 0 at every time: each time against its own control — dose 0 reads 0 at every time, the plexes cancel`, () => {
      for (const row of of({ intent, position: false }).slice(0, 40)) {
        const rs = row.rs!
        const vehicle = (rs.controls ?? []).filter((c) => c.vehicle)
        expect(vehicle.map((c) => c.time).sort((a, b) => a - b)).toEqual(TIMES)
        for (const c of vehicle) expect(c.y).toBeCloseTo(0, 9)
        // no dose-0 cell: dose 0 is the control at each time, not a response
        expect(rs.cells!.some((c) => c.dose === 0)).toBe(false)
        const g = Number(row.uniqID.slice(1))
        for (const c of rs.cells!)
          expect(Math.abs(c.y - effect(g, c.dose, c.time))).toBeLessThan(0.5)
      }
    })

  it('one position: every cell against dose 0 at 30 min — the other times’ plexes stay in', () => {
    const rs = of({ intent: 'changes', position: true })[40].rs!
    expect(rs.cells!.some((c) => c.dose === 0 && c.time > 30)).toBe(true)
    expect((rs.controls ?? []).filter((c) => c.vehicle).map((c) => c.time)).toEqual([30])
  })

  it('a baseline anywhere: every cell against the control at its own levels with the pinned ones set to the pick', () => {
    for (const intent of ['shape', 'changes'] as const) {
      // dose 100: each time's dose 100 — dose 0 a cell (against it), dose 100 the control
      for (const row of of({ intent, position: false, pick: 'dose100' }).slice(0, 20)) {
        const rs = row.rs!
        const g = Number(row.uniqID.slice(1))
        expect(rs.cells!.some((c) => c.dose === 100)).toBe(false)
        expect(rs.cells!.some((c) => c.dose === 0)).toBe(true)
        expect(
          (rs.controls ?? [])
            .filter((c) => c.vehicle)
            .map((c) => [c.dose, c.time])
            .sort((a, b) => a[1] - b[1])
        ).toEqual(TIMES.map((t) => [100, t]))
        for (const c of rs.cells!)
          expect(Math.abs(c.y - (effect(g, c.dose, c.time) - effect(g, 100, c.time)))).toBeLessThan(
            0.5
          )
      }
      // time 240: each dose's value at 240 — every other time a cell, 240 the control
      for (const row of of({ intent, position: false, pick: 'time240' }).slice(0, 20)) {
        const rs = row.rs!
        expect(rs.cells!.some((c) => c.time === 240)).toBe(false)
        expect(new Set((rs.controls ?? []).filter((c) => c.vehicle).map((c) => c.time))).toEqual(
          new Set([240])
        )
        expect(new Set((rs.controls ?? []).filter((c) => c.vehicle).map((c) => c.dose))).toEqual(
          new Set(DOSES)
        )
      }
    }
  })

  it('testing changes against dose 0 at every time: a plex step is no change; against one position it is', () => {
    const called = (rs: CompareResultRow[]) =>
      rs.filter((x) => x.signf && !responds(Number(x.uniqID.slice(1)))).length
    // 120 genes with no response, each time its own plex (steps of ~0.8 log₂)
    expect(called(of({ intent: 'changes', position: false }))).toBeLessThanOrEqual(8)
    expect(called(of({ intent: 'changes', position: true }))).toBeGreaterThan(60)
    // the responders' curves do change across time
    const hits = of({ intent: 'changes', position: false }).filter(
      (x) => x.signf && responds(Number(x.uniqID.slice(1)))
    )
    expect(hits.length).toBeGreaterThanOrEqual(20)
  })
})
