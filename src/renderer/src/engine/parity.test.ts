/**
 * Numerical parity: the pure-TS engine must reproduce omicViz's committed
 * veh_norm output for the shared gui_test fixture. This is the acceptance bar
 * for the reimplemented ingest + stats (see [[omicexplorer-architecture]]).
 *
 * Fixtures in __fixtures__/ are copied verbatim from
 *   omicViz/gui_test/input/{data_long.csv, samplesheet.csv}
 *   omicViz/resources/83332_Mtb_DB.csv
 *   omicViz/gui_test/data/Original-uM/veh_norm/cmpd_E28_DMSO.csv (expected)
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'

import { runVehNorm } from './compare'
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
  log2FC: string
  pP: string
  pQ: string
  signf: string
}

describe('veh_norm parity vs omicViz (E28 | DMSO)', () => {
  const std = standardize({
    dataText: fx('data_long.csv'),
    dataFilename: 'data_long.csv',
    samplesheetText: fx('samplesheet.csv'),
    dbText: fx('83332_Mtb_DB.csv'),
    activeConditions: ['cmpd', 'dose', 'time']
  })

  const res = runVehNorm({
    rows: std.rows,
    pairs: [['E28', 'DMSO']],
    activeConditions: std.activeConditions,
    method: 'ttest',
    transform: true,
    // omicViz gui_test config uses stat_type: pP for significance calls
    threshold: { ...DEFAULT_THRESHOLD, statType: 'pP' }
  })

  const expected = (
    Papa.parse<ExpectedRow>(fx('expected_veh_norm_E28_DMSO.csv'), {
      header: true,
      skipEmptyLines: true
    }).data
  ).filter((r) => r.uniqID)

  const key = (uniqID: string, dose: unknown, time: unknown): string =>
    `${uniqID}|${Number(dose)}|${Number(time)}`
  const actual = new Map<string, CompareResultRow>(
    res.rows.map((r) => [key(r.uniqID, r.dose, r.time), r])
  )

  it('produces the standardized table with mapped uniqIDs', () => {
    expect(std.rows.length).toBeGreaterThan(0)
    expect(std.rows.every((r) => /^g\d+$/.test(r.uniqID))).toBe(true)
    expect(std.activeConditions).toEqual(['cmpd', 'dose', 'time'])
  })

  it('covers every expected row by (uniqID, dose, time)', () => {
    const missing = expected.filter((e) => !actual.has(key(e.uniqID, e.dose, e.time)))
    expect(missing).toHaveLength(0)
  })

  it('matches log2FC, mean1, mean2, pP, and pQ to 1e-6', () => {
    for (const e of expected) {
      const a = actual.get(key(e.uniqID, e.dose, e.time))
      expect(a, `row ${key(e.uniqID, e.dose, e.time)}`).toBeDefined()
      const near = (got: number | null, want: string): void => {
        // Note: Number('') === 0 in JS, so guard on the raw string being blank.
        if (want.trim() === '') return // omicViz left this field blank (n<1 side)
        const w = Number(want)
        if (!Number.isFinite(w)) return
        expect(got, `${e.uniqID} d${e.dose} t${e.time}`).not.toBeNull()
        expect(Math.abs((got as number) - w)).toBeLessThan(1e-6)
      }
      near(a!.log2FC, e.log2FC)
      near(a!.mean1, e.mean1)
      near(a!.mean2, e.mean2)
      near(a!.pP, e.pP)
      near(a!.pQ, e.pQ)
    }
  })

  it('matches the significance call (signf)', () => {
    for (const e of expected) {
      const a = actual.get(key(e.uniqID, e.dose, e.time))!
      expect(a.signf, `${e.uniqID} d${e.dose} t${e.time}`).toBe(e.signf.toLowerCase() === 'true')
    }
  })
})
