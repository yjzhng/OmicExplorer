import { describe, expect, it } from 'vitest'

import { RESPONSE_THRESHOLD, responseMetrics, runResponseSurface } from './responseSurface'
import { rng } from './sam'
import type { StandardRow } from './types'

function normal(r: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
}

// A TPP-like design in the dose × time slots: the time slot holds the temperature (matched: each
// curve from its own first point), dose the treatment (against the vehicle).
const DOSES = [0.5, 2, 10, 50]
const TEMPS = [37, 41, 44, 47, 50, 53, 56, 59, 63, 67]
// 0–29: the melt shifts with dose (stabilised); 30–59: a consistent drop with dose (abundance);
// the rest: the melt every dose shares, no drug effect
const kind = (g: number): 'shift' | 'drift' | 'none' =>
  g < 30 ? 'shift' : g < 60 ? 'drift' : 'none'
const sat = (d: number): number => d / (d + 2)
const melt = (t: number, tm: number): number => Math.log2(0.05 + 1 / (1 + Math.exp((t - tm) / 2)))

function build(): StandardRow[] {
  const r = rng(3)
  const rows: StandardRow[] = []
  for (let g = 0; g < 300; g++) {
    const a = 18 + 3 * r()
    const tm = 47 + 6 * r()
    // a step per temperature every dose shares (a TMT plex's): cancels in the test
    const step = TEMPS.map(() => 0.3 * normal(r))
    const k = kind(g)
    for (let rep = 1; rep <= 2; rep++)
      for (const [i, t] of TEMPS.entries())
        for (const d of [0, ...DOSES]) {
          const shift = k === 'shift' ? 5 * sat(d) : 0
          const drift = k === 'drift' ? -1.2 * sat(d) : 0
          const log2 = a + step[i] + melt(t, tm + shift) + drift + 0.12 * normal(r)
          rows.push({
            uniqID: `g${g}`,
            cell: '',
            cmpd: d === 0 ? 'DMSO' : 'A',
            dose: d,
            time: t,
            rep,
            value: 2 ** log2
          } as StandardRow)
        }
  }
  return rows
}

describe('test response changes: curves along one axis compared across the other', () => {
  const rows = build()
  // against one position (the vehicle at 37°, as the TPP project): the melt is response to a
  // surface tested for any response
  const run = (intent?: 'shape' | 'changes') =>
    runResponseSurface({
      rows,
      num: { cmpd: ['A'] },
      den: { cmpd: ['DMSO'], dose: ['0'], time: ['37'] },
      match: [],
      activeConditions: ['cmpd', 'dose', 'time'],
      numericConditions: [],
      curveAxis: 'surface',
      threshold: RESPONSE_THRESHOLD,
      ...(intent ? { intent } : null),
      // the curves run along the temperature (the time slot), compared across dose
      ...(intent === 'changes' ? { responseAxis: 'time' as const } : null)
    })

  it('calls the changed curves, not the melt every dose shares', () => {
    const res = run('changes')
    const called = res.rows.filter((r) => r.signf)
    const byKind = (k: string) => called.filter((r) => kind(Number(r.uniqID.slice(1))) === k)
    expect(byKind('shift').length).toBeGreaterThanOrEqual(27)
    expect(byKind('drift').length).toBeGreaterThanOrEqual(27)
    // 240 genes melt with no drug effect: few called
    expect(byKind('none').length).toBeLessThanOrEqual(12)
    // …where testing for any response calls nearly every melting gene
    const shape = run('shape').rows.filter((r) => r.signf)
    expect(shape.filter((r) => kind(Number(r.uniqID.slice(1))) === 'none').length).toBeGreaterThan(
      200
    )
  })

  it('says what the change is: a shift of shape or a consistent drift', () => {
    const res = run('changes')
    const of = (k: string) =>
      res.rows.filter((r) => r.signf && kind(Number(r.uniqID.slice(1))) === k)
    const share = (rs: typeof res.rows, ks: string[]) =>
      rs.filter((r) => ks.includes(r.rs!.shift!.kind)).length / rs.length
    expect(share(of('shift'), ['shape', 'both'])).toBeGreaterThan(0.9)
    expect(share(of('drift'), ['drift'])).toBeGreaterThan(0.9)
    // a stabilised melt's midpoint moves up with dose (ΔTm > 0), read off the slices' 4PLs
    const dm = of('shift')
      .map((r) => responseMetrics(r).mid_shift)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    expect(dm.length).toBeGreaterThan(20)
    expect(dm.filter((v) => v > 1).length / dm.length).toBeGreaterThan(0.8)
  })

  it('runs only along an axis picked', () => {
    expect(() =>
      runResponseSurface({
        rows,
        num: { cmpd: ['A'] },
        den: { cmpd: ['DMSO'] },
        match: [],
        activeConditions: ['cmpd', 'dose', 'time'],
        numericConditions: [],
        curveAxis: 'surface',
        intent: 'changes'
      })
    ).toThrow(/axis/)
  })

  // a 4PL along the temperature: its F's null estimated (NPARC) or simulated (adjusted F)
  for (const stat of ['nparc', 'adjusted'] as const)
    it(`with 4PL curves (${stat}): calls the changed ones, holds the rest near nominal`, () => {
      const res = runResponseSurface({
        rows,
        num: { cmpd: ['A'] },
        den: { cmpd: ['DMSO'] },
        match: [],
        activeConditions: ['cmpd', 'dose', 'time'],
        numericConditions: [],
        curveAxis: 'surface',
        threshold: RESPONSE_THRESHOLD,
        intent: 'changes',
        responseAxis: 'time',
        axisFits: { time: { detect: '4pl' } },
        changesStat: stat
      })
      // the 4PL test ran: 5 slices → d1 = 4 × 4 (adjusted keeps it; NPARC estimates its own)
      const d1 = res.rows[0].rs!.df1
      if (stat === 'adjusted') expect(d1).toBe(16)
      else expect(Number.isInteger(d1)).toBe(false)
      const of = (k: string) => res.rows.filter((r) => kind(Number(r.uniqID.slice(1))) === k)
      const sig = (rs: typeof res.rows) => rs.filter((r) => (r.pQ ?? 0) >= -Math.log10(0.05)).length
      // (the adjusted F's null is per stratum, so less power on these 300 genes than NPARC's)
      expect(sig(of('shift'))).toBeGreaterThanOrEqual(stat === 'nparc' ? 25 : 12)
      expect(sig(of('drift'))).toBeGreaterThanOrEqual(25)
      // the no-effect genes: their p's near uniform (the share below 5% near 5%)
      const none = of('none')
      const low = none.filter((r) => (r.pP ?? 0) >= -Math.log10(0.05)).length / none.length
      expect(low).toBeLessThan(0.12)
    })

  it('draws the curves themselves: every dose a slice, against one position', () => {
    const r = run('changes').rows.find(
      (x) => x.signf && kind(Number(x.uniqID.slice(1))) === 'shift'
    )!
    expect(r.rs?.shift?.response).toBe('time')
    expect(r.rs?.shift?.across).toBe('dose')
    // only the curves along the response axis are described: a time curve at each dose, no dose
    // curves at each time
    expect(r.rs?.surface?.byDose.length).toBeGreaterThan(0)
    expect(r.rs?.surface?.byTime).toHaveLength(0)
    // the vehicle's own curve (dose 0) is among the cells, not only its first point
    expect(r.rs?.cells?.some((c) => c.dose === 0 && c.time > 37)).toBe(true)
  })
})
