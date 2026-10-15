/** A Compare on dose (each dose against 0) labels every dose its own comparison ("5 | 0",
 *  "10 | 0"). Faceting a dose-response / bubble plot on those labels left one dose per tab, so the
 *  curves (which need two) drew nothing. Labels that are only the plot's own axis aren't a facet. */
import { describe, expect, it } from 'vitest'

import { runCompare } from './direct'
import { buildDR, facetCompareRows, facetDims } from './plotData'
import type { StandardRow } from './types'

const rows: StandardRow[] = []
for (const g of ['g1', 'g2'])
  for (const dose of [0, 5, 10])
    for (const rep of [1, 2, 3])
      rows.push({
        uniqID: g,
        cell: '',
        cmpd: 'X',
        dose,
        time: null,
        rep,
        value: 10 + dose * (g === 'g1' ? 0.3 : -0.2) + rep * 0.05
      })

const onDose = runCompare({
  rows,
  num: { dose: ['5', '10'] },
  den: { dose: ['0'] },
  match: ['cmpd'],
  activeConditions: ['cmpd', 'dose']
}).rows

describe('comparison labels that are the plot axis', () => {
  it('a Compare on dose labels each dose', () => {
    expect(new Set(onDose.map((r) => r.comparison))).toEqual(new Set(['5 | 0', '10 | 0']))
  })

  it('are not a facet of a plot drawn along dose: one tab holds every dose', () => {
    const dims = facetDims(onDose, ['dose'])
    expect(dims).not.toContain('comparison')
    const [first] = facetCompareRows(onDose, dims)
    expect(new Set(first.rows.map((r) => r.dose))).toEqual(new Set([5, 10]))
    expect(buildDR(first.rows, { axis: 'dose', topGenes: 0 }).series).toHaveLength(2)
  })

  it('still split a plot that shows one comparison at a time (the volcano: no axis excluded)', () => {
    expect(facetDims(onDose)).toContain('comparison')
  })

  it('still split comparisons against different denominators', () => {
    const twoDens = onDose.map((r, i) => ({
      ...r,
      comparison: i % 2 ? `${r.dose} | 0` : `${r.dose} | 1`
    }))
    expect(facetDims(twoDens, ['dose'])).toContain('comparison')
  })
})
