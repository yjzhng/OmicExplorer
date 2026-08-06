/**
 * Numerical parity: `runContrast` must reproduce omicViz's committed `contrast`
 * output for the gui_test fixture — a correlated (OLS) contrast of the E28 and
 * E08-Cym vehicle-normalisations. The two primary tables are produced by
 * `runVehNorm` (already parity-verified), concatenated, then contrasted.
 *
 * Fixture: omicViz/gui_test/data/Original-uM/contrast/cmpd_E28_E08-Cym.csv
 * (config: `- type: contrast / cmpd: [[E28, E08-Cym]] / relationship: correlated`).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'

import { runContrast } from './contrast'
import { runVehNorm } from './compare'
import { standardize } from './ingest'
import { DEFAULT_THRESHOLD } from './stats'

const here = dirname(fileURLToPath(import.meta.url))
const fx = (name: string): string => readFileSync(join(here, '__fixtures__', name), 'utf8')

interface ExpectedRow {
  uniqID: string
  dose: string
  time: string
  FC1: string
  FC2: string
  FCdiff: string
  P1: string
  P2: string
  Q1: string
  Q2: string
  signf: string
  effect: string
}

describe('contrast parity vs omicViz (E28 vs E08-Cym, correlated/OLS)', () => {
  const std = standardize({
    dataText: fx('data_long.csv'),
    dataFilename: 'data_long.csv',
    samplesheetText: fx('samplesheet.csv'),
    dbText: fx('83332_Mtb_DB.csv'),
    activeConditions: ['cmpd', 'dose', 'time']
  })
  const thr = { ...DEFAULT_THRESHOLD, statType: 'pP' as const }
  const veh = (num: string): ReturnType<typeof runVehNorm> =>
    runVehNorm({
      rows: std.rows,
      pairs: [[num, 'DMSO']],
      activeConditions: std.activeConditions,
      method: 'ttest',
      transform: true,
      threshold: thr
    })

  // omicViz pools the primary tables, then contrasts two levels of one condition —
  // here `cmpd: [[E28, E08-Cym]]`, exactly the config that produced the fixture.
  const res = runContrast({
    rows: [...veh('E28').rows, ...veh('E08-Cym').rows],
    condition: 'cmpd',
    pair: ['E28', 'E08-Cym'],
    relationship: 'correlated'
  })

  const expected = Papa.parse<ExpectedRow>(fx('expected_contrast_E28_E08-Cym.csv'), {
    header: true,
    skipEmptyLines: true
  }).data.filter((r) => r.uniqID)

  const key = (u: string, d: unknown, t: unknown): string => `${u}|${Number(d)}|${Number(t)}`
  const actual = new Map(res.rows.map((r) => [key(r.uniqID, r.dose, r.time), r]))

  it('joins every expected (uniqID, dose, time) row', () => {
    const missing = expected.filter((e) => !actual.has(key(e.uniqID, e.dose, e.time)))
    expect(missing.map((m) => key(m.uniqID, m.dose, m.time))).toEqual([])
    expect(res.comparisons).toEqual(['E28 | E08-Cym'])
  })

  it('matches FC1/FC2/FCdiff/P1/P2/Q1/Q2 to 1e-6', () => {
    for (const e of expected) {
      const a = actual.get(key(e.uniqID, e.dose, e.time))!
      const near = (got: number | null, want: string, f: string): void => {
        if (want.trim() === '') return
        const w = Number(want)
        if (!Number.isFinite(w)) return
        expect(Math.abs((got as number) - w), `${f} @ ${e.uniqID} d${e.dose}`).toBeLessThan(1e-6)
      }
      near(a.FC1, e.FC1, 'FC1')
      near(a.FC2, e.FC2, 'FC2')
      near(a.FCdiff, e.FCdiff, 'FCdiff')
      near(a.P1, e.P1, 'P1')
      near(a.P2, e.P2, 'P2')
      near(a.Q1, e.Q1, 'Q1')
      near(a.Q2, e.Q2, 'Q2')
    }
  })

  it('matches the OLS-outlier signf and effect calls', () => {
    for (const e of expected) {
      const a = actual.get(key(e.uniqID, e.dose, e.time))!
      expect(a.signf, `signf @ ${e.uniqID} d${e.dose}`).toBe(e.signf.toLowerCase() === 'true')
      expect(a.effect, `effect @ ${e.uniqID} d${e.dose}`).toBe(e.effect)
    }
  })
})
