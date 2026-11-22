/** A Contrast preview's side over a Compare: its compared condition reads as the comparison
 *  ("A · X | Y"), not the test value alone its rows carry. */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { CompareResultRow, StandardRow } from '../engine'
import { SideCell } from './condRows'
import { comparedLabelsOf } from './contrastPair'
import type { NodeResult } from './types'

const row = (cell: string, cmpd: string, comparison: string): CompareResultRow =>
  ({
    uniqID: 'G1',
    cell,
    cmpd,
    dose: null,
    time: null,
    cmp_cond: 'cmpd',
    comparison,
    log2FC: 1,
    pP: 0.01,
    pQ: 0.02,
    signf: true,
    effect: 'up'
  }) as unknown as CompareResultRow

const compareOf = (rows: CompareResultRow[]): NodeResult =>
  ({
    kind: 'compare',
    cmp: { rows, comparisons: [...new Set(rows.map((r) => r.comparison))] }
  }) as unknown as NodeResult

// a side row as the Contrast dialog reads it: the conditions only (cell blank as '' or null)
const side = (cell: string | null, cmpd: string): StandardRow =>
  ({ uniqID: 'G1', cell, cmpd, dose: null, time: null }) as unknown as StandardRow

const text = (rows: StandardRow[], cmp: ReturnType<typeof comparedLabelsOf>): string =>
  renderToStaticMarkup(
    createElement(SideCell, {
      rows,
      conds: ['cell', 'cmpd'],
      numeric: new Set(),
      compared: cmp
    })
  ).replace(/<[^>]+>/g, '|')

describe('comparedLabelsOf', () => {
  const res = compareOf([row('A', 'X', 'X | Y'), row('A', 'Z', 'Z | Y'), row('B', 'X', 'X | Y')])

  it('labels a side row by the comparison it stands for', () => {
    const c = comparedLabelsOf(res)!
    expect([...c.conds]).toEqual(['cmpd'])
    expect(c.of(side('A', 'X'))).toBe('X | Y')
    expect(c.of(side('A', 'Z'))).toBe('Z | Y')
    expect(c.of(side('C', 'X'))).toBeUndefined()
  })

  it('is null for anything but a Compare', () => {
    expect(comparedLabelsOf(undefined)).toBeNull()
    expect(comparedLabelsOf({ kind: 'standardize' } as unknown as NodeResult)).toBeNull()
  })

  it('shows the comparison in the preview cell: "A · X | Y"', () => {
    const c = comparedLabelsOf(res)
    expect(text([side('A', 'X')], c)).toContain('A · X | Y')
    // without it, the test value alone (a Clean data side)
    expect(text([side('A', 'X')], null)).toContain('A · X')
    expect(text([side('A', 'X')], null)).not.toContain('X | Y')
    // a side pooling two comparisons says how many
    expect(text([side('A', 'X'), side('A', 'Z')], c)).toContain('2 comparisons')
  })
})
