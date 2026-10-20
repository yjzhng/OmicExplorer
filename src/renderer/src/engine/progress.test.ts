import { describe, expect, it } from 'vitest'

import { runCurveFit } from './direct'
import { progressTracker, type Progress } from './progress'
import { RESPONSE_THRESHOLD, runResponseSurface } from './responseSurface'
import { rng } from './sam'
import type { StandardRow } from './types'

describe('progress', () => {
  it('reports each stage at once, and within one no more often than asked', () => {
    let t = 0
    const seen: Progress[] = []
    const p = progressTracker(
      (x) => seen.push(x),
      100,
      () => t
    )
    p.stage('Fitting')
    p.plan(10)
    for (let i = 0; i < 10; i++) {
      t += 30
      p.add(1)
    }
    expect(seen[0]).toEqual({ stage: 'Fitting', done: 0, total: 0 })
    // every ~100 ms of 300: a few reports, not ten
    expect(seen.length).toBeLessThan(6)
    p.remaining(5)
    t += 200
    p.add(10)
    expect(seen[seen.length - 1]).toEqual({ stage: 'Fitting', done: 15, total: 15 })
  })

  // 30 genes, DMSO and A at five doses (and four times, for a surface)
  const r = rng(2)
  const rows: StandardRow[] = []
  for (let g = 0; g < 30; g++)
    for (let rep = 1; rep <= 3; rep++)
      for (const t of [0, 30, 120, 480, 1440]) {
        rows.push({
          uniqID: `g${g}`,
          cell: '',
          cmpd: 'DMSO',
          dose: 0,
          time: t,
          rep,
          value: 2 ** (20 + 0.2 * r())
        })
        if (t > 0)
          for (const d of [1, 10, 100, 1000, 3000])
            rows.push({
              uniqID: `g${g}`,
              cell: '',
              cmpd: 'A',
              dose: d,
              time: t,
              rep,
              value: 2 ** (20 + 0.2 * r())
            })
      }
  const last = (run: (p: ReturnType<typeof progressTracker>) => unknown): Progress[] => {
    const seen: Progress[] = []
    run(progressTracker((x) => seen.push(x), 0))
    return seen
  }
  it('a curve fit counts its curves and decoys up to its total', () => {
    const seen = last((p) =>
      runCurveFit(
        {
          rows,
          num: { cmpd: ['A'] },
          den: { cmpd: ['DMSO'] },
          match: [],
          activeConditions: ['cmpd', 'dose', 'time'],
          numericConditions: [],
          curveAxis: 'dose'
        },
        p
      )
    )
    const end = seen[seen.length - 1]
    expect(end.stage).toMatch(/curves/)
    expect(end.total).toBeGreaterThan(0)
    expect(end.done / end.total).toBeGreaterThan(0.9)
  })
  it('a 4PL surface run goes through its stages, its total re-set to what it fits', () => {
    const seen = last((p) =>
      runResponseSurface(
        {
          rows,
          num: { cmpd: ['A'], dose: ['1', '10', '100', '1000', '3000'] },
          den: { cmpd: ['DMSO'] },
          match: [],
          activeConditions: ['cmpd', 'dose', 'time'],
          numericConditions: [],
          curveAxis: 'surface',
          detector: '4pl',
          threshold: RESPONSE_THRESHOLD
        },
        p
      )
    )
    const stages = [...new Set(seen.map((x) => x.stage))]
    expect(stages).toEqual([
      'Fitting spline surfaces',
      'Fitting 4PL surfaces',
      'Simulating the null',
      'Fitting decoy surfaces'
    ])
    const end = seen[seen.length - 1]
    expect(end.done).toBe(end.total)
  }, 120000)
})
