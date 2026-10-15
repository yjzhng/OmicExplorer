/** Two-dataset contrast picks as lists: a matched condition can be narrowed to the values it pairs
 *  on, an unmatched one must still come to one slice per dataset (never pooled), and a saved
 *  single-value pin keeps its old meaning. */
import { describe, expect, it } from 'vitest'

import { applyFix, previewContrastPair, type ContrastSideRow } from './contrast'

const rows = (doses: number[]): ContrastSideRow[] =>
  doses.flatMap((dose) =>
    ['g1', 'g2'].map((uniqID) => ({ uniqID, cmpd: 'A', dose, value: 1 }) as ContrastSideRow)
  )

describe('pair picks', () => {
  it('a list narrows a matched condition to the values it pairs on', () => {
    const p = previewContrastPair(rows([1, 10, 100]), rows([1, 10, 100]), ['dose'], undefined, {
      a: { dose: ['1', '10'] },
      b: { dose: ['1', '10'] }
    })
    expect(p.groups).toBe(2)
    expect(p.warnings).toEqual([])
  })

  it('an unmatched condition with two picked values is still refused (not pooled)', () => {
    const p = previewContrastPair(rows([1, 10]), rows([1, 10]), [], undefined, {
      a: { dose: ['1', '10'] },
      b: { dose: ['1'] }
    })
    expect(p.unpinned).toEqual([{ cond: 'dose', side: 'a' }])
  })

  it('a one-value list fixes an unmatched condition', () => {
    const p = previewContrastPair(rows([1, 10]), rows([1, 10]), [], undefined, {
      a: { dose: ['10'] },
      b: { dose: ['1'] }
    })
    expect(p.unpinned).toEqual([])
    expect(p.groups).toBe(1)
  })

  it('a saved single-value pin on a matched condition is ignored, as before', () => {
    expect(applyFix(rows([1, 10]), { dose: '1' }, ['dose'])).toHaveLength(4)
    expect(applyFix(rows([1, 10]), { dose: '1' }, [])).toHaveLength(2)
  })
})
