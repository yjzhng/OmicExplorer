/**
 * Numerical parity: `runDirect` must reproduce omicViz's committed `direct`
 * output for the gui_test fixture — a symmetric cmpd comparison E28 vs E08-Cym.
 *
 * Fixture: omicViz/gui_test/data/Original-uM/direct/cmpd_E28_E08-Cym.csv,
 * produced by the config `- type: direct / cmpd: [[E28, E08-Cym]]` with
 * stats.method=ttest, threshold.stat_type=pP.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'

import { runDirect } from './direct'
import { standardize } from './ingest'
import { DEFAULT_THRESHOLD } from './stats'
import type { CompareResultRow } from './types'

const here = dirname(fileURLToPath(import.meta.url))
const fx = (name: string): string => readFileSync(join(here, '__fixtures__', name), 'utf8')

interface ExpectedRow {
  uniqID: string
  dose: string
  time: string
  mean1: string
  mean2: string
  sd1: string
  sd2: string
  log2FC: string
  pP: string
  pQ: string
  signf: string
}

describe('direct parity vs omicViz (cmpd E28 | E08-Cym)', () => {
  const std = standardize({
    dataText: fx('data_long.csv'),
    dataFilename: 'data_long.csv',
    samplesheetText: fx('samplesheet.csv'),
    dbText: fx('83332_Mtb_DB.csv'),
    activeConditions: ['cmpd', 'dose', 'time']
  })

  const res = runDirect({
    rows: std.rows,
    condition: 'cmpd',
    pairs: [['E28', 'E08-Cym']],
    activeConditions: std.activeConditions,
    method: 'ttest',
    transform: true,
    threshold: { ...DEFAULT_THRESHOLD, statType: 'pP' }
  })

  const expected = Papa.parse<ExpectedRow>(fx('expected_direct_cmpd_E28_E08-Cym.csv'), {
    header: true,
    skipEmptyLines: true
  }).data.filter((r) => r.uniqID)

  const key = (uniqID: string, dose: unknown, time: unknown): string =>
    `${uniqID}|${Number(dose)}|${Number(time)}`
  const actual = new Map<string, CompareResultRow>(
    res.rows.map((r) => [key(r.uniqID, r.dose, r.time), r])
  )

  it('covers every expected row by (uniqID, dose, time)', () => {
    const missing = expected.filter((e) => !actual.has(key(e.uniqID, e.dose, e.time)))
    expect(missing.map((m) => key(m.uniqID, m.dose, m.time))).toEqual([])
  })

  it('matches mean1/mean2/sd1/sd2/log2FC/pP/pQ to 1e-6', () => {
    for (const e of expected) {
      const a = actual.get(key(e.uniqID, e.dose, e.time))
      expect(a, `row ${key(e.uniqID, e.dose, e.time)}`).toBeDefined()
      const near = (got: number | null, want: string, field: string): void => {
        if (want.trim() === '') return
        const w = Number(want)
        if (!Number.isFinite(w)) return
        expect(got, `${field} @ ${e.uniqID} d${e.dose} t${e.time}`).not.toBeNull()
        expect(Math.abs((got as number) - w), `${field} @ ${e.uniqID} d${e.dose} t${e.time}`).toBeLessThan(1e-6)
      }
      near(a!.mean1, e.mean1, 'mean1')
      near(a!.mean2, e.mean2, 'mean2')
      near(a!.sd1, e.sd1, 'sd1')
      near(a!.sd2, e.sd2, 'sd2')
      near(a!.log2FC, e.log2FC, 'log2FC')
      near(a!.pP, e.pP, 'pP')
      near(a!.pQ, e.pQ, 'pQ')
    }
  })

  it('matches the significance call (signf)', () => {
    for (const e of expected) {
      const a = actual.get(key(e.uniqID, e.dose, e.time))!
      expect(a.signf, `${e.uniqID} d${e.dose} t${e.time}`).toBe(e.signf.toLowerCase() === 'true')
    }
  })
})
