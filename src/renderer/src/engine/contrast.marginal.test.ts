/**
 * Parity for the marginal ('independent') contrast branch vs omicViz's actual
 * _add_gaussian_outliers(method='marginal'). Fixture built on synthetic primary
 * data with deliberate per-axis outliers (see scratchpad/gen_contrast_marginal.py),
 * exercising the robust median/MAD + normal-tail + BH + per-axis effect strings.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'

import { runContrast } from './contrast'
import type { CompareResultRow } from './types'

const here = dirname(fileURLToPath(import.meta.url))
const fx = (name: string): string => readFileSync(join(here, '__fixtures__', name), 'utf8')

type Rec = Record<string, string>

function toPrimary(csv: string): CompareResultRow[] {
  const recs = Papa.parse<Rec>(csv, { header: true, skipEmptyLines: true }).data.filter(
    (r) => r.uniqID
  )
  return recs.map((r) => ({
    uniqID: r.uniqID,
    cmpd: r.cmpd,
    dose: null,
    time: null,
    cmp_cond: 'cmpd',
    comparison: r.comparison,
    mean1: null,
    mean2: null,
    sd1: null,
    sd2: null,
    log2FC: Number(r.log2FC),
    pP: Number(r.pP),
    pQ: Number(r.pQ),
    thrsh: '',
    signf: r.signf.toLowerCase() === 'true',
    effect: r.effect as CompareResultRow['effect']
  }))
}

interface ExpectedRow {
  uniqID: string
  FC1: string
  FC2: string
  FCdiff: string
  signf1: string
  signf2: string
  signf: string
  effect: string
}

describe('contrast parity vs omicViz (marginal / independent)', () => {
  const all = toPrimary(fx('contrast_marginal_input.csv'))
  const res = runContrast({
    rows: all,
    condition: 'cmpd',
    pair: ['A', 'B'],
    relationship: 'independent'
  })
  const expected = Papa.parse<ExpectedRow>(fx('expected_contrast_marginal.csv'), {
    header: true,
    skipEmptyLines: true
  }).data.filter((r) => r.uniqID)
  const actual = new Map(res.rows.map((r) => [r.uniqID, r]))

  it('matches FC1/FC2/FCdiff to 1e-6 and the per-axis significance/effect calls', () => {
    expect(res.rows.length).toBe(expected.length)
    for (const e of expected) {
      const a = actual.get(e.uniqID)!
      expect(Math.abs((a.FC1 as number) - Number(e.FC1)), `FC1 @ ${e.uniqID}`).toBeLessThan(1e-6)
      expect(Math.abs((a.FC2 as number) - Number(e.FC2)), `FC2 @ ${e.uniqID}`).toBeLessThan(1e-6)
      expect(
        Math.abs((a.FCdiff as number) - Number(e.FCdiff)),
        `FCdiff @ ${e.uniqID}`
      ).toBeLessThan(1e-6)
      expect(a.signf, `signf @ ${e.uniqID}`).toBe(e.signf.toLowerCase() === 'true')
      expect(a.effect, `effect @ ${e.uniqID}`).toBe(e.effect)
    }
  })
})
