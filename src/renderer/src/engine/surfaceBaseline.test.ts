/** A dose × time surface's baseline: dose 0 at every time (each time its own plex — a decryptM
 *  design) against one position (dose 0 at one time). */
import { describe, expect, it } from 'vitest'

import { curveModel } from '../graph/curveModel'
import { sampleRows } from '../graph/compareModel'
import { RESPONSE_THRESHOLD, runResponseSurface } from './responseSurface'
import { rng } from './sam'
import { numericConds, type ConditionKey, type StandardRow } from './types'

const TIMES = [60, 120, 240, 480, 960]
const DOSES = [0, 0.1, 1, 10, 100, 1000]
// each time point its own plex: abundances not comparable across times
const PLEX: Record<number, number> = { 60: 0, 120: -5, 240: 0, 480: -5, 960: -3 }
const effect = (d: number): number => (d > 0 ? -1 / (1 + 10 / d) : 0)
const r = rng(3)
const normal = (): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
const rows: StandardRow[] = []
for (let g = 0; g < 8; g++)
  for (const t of TIMES)
    for (const d of DOSES)
      rows.push({
        uniqID: `g${g}`,
        cell: '',
        cmpd: 'Bortezomib',
        dose: d,
        time: t,
        rep: 1,
        value: 2 ** (20 + PLEX[t] + (g === 0 ? effect(d) : 0) + 0.05 * normal())
      } as StandardRow)
const active: ConditionKey[] = ['cmpd', 'dose', 'time']
const m = curveModel(
  {
    detection: 'spline',
    axis: 'surface',
    intent: 'shape',
    filter: {},
    drop: {},
    base: { dose: ['0'] }
  },
  sampleRows(rows, active),
  active,
  numericConds([])
)
const fit = (den: typeof m.den) =>
  runResponseSurface({
    rows,
    num: m.num,
    den,
    match: m.match,
    activeConditions: active,
    numericConditions: [],
    curveAxis: 'surface',
    axisBaselines: m.baselines,
    describeAll: true,
    threshold: RESPONSE_THRESHOLD
  }).rows.find((x) => x.uniqID === 'g0')!.rs!

describe('a surface against dose 0 at every time', () => {
  it('measures each cell against the control at its own time — the plexes cancel', () => {
    expect(m.den).toEqual({ dose: ['0'] })
    const rs = fit(m.den)
    // every time a treated time (60 min too), its control at 0
    expect(new Set(rs.cells!.map((c) => c.time))).toEqual(new Set(TIMES))
    for (const c of rs.cells!) expect(c.y).toBeCloseTo(effect(c.dose), 0)
    expect(
      rs
        .controls!.filter((c) => c.vehicle)
        .map((c) => c.time)
        .sort((a, b) => a - b)
    ).toEqual(TIMES)
  })
  it('reads a config listing every time on the baseline the same way — not one position', () => {
    const rs = fit({ ...m.den, time: TIMES.map(String) })
    for (const c of rs.cells!) expect(c.y).toBeCloseTo(effect(c.dose), 0)
  })
  it('one position (dose 0 at 60 min) measures every cell against that one control', () => {
    const rs = fit({ ...m.den, time: ['60'] })
    // the other plexes' offsets stay in: what one position means
    const at120 = rs.cells!.find((c) => c.time === 120 && c.dose === 0.1)!
    expect(at120.y).toBeCloseTo(PLEX[120], 0)
  })
})
