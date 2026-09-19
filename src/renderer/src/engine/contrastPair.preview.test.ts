import { describe, expect, it } from 'vitest'

import { previewContrastPair, type ContrastSideRow } from './contrast'

const row = (uniqID: string, cell: string, dose: number | null, value = 1): ContrastSideRow => ({
  uniqID,
  cell,
  cmpd: 'X',
  dose,
  time: null,
  value
})

// A: cells K1,K2 at doses 1,5; B: cells K1,K3 at doses 1,5,10. Genes g1,g2 on A; g2,g3 on B.
const A: ContrastSideRow[] = []
const B: ContrastSideRow[] = []
for (const g of ['g1', 'g2'])
  for (const cell of ['K1', 'K2']) for (const d of [1, 5]) A.push(row(g, cell, d))
for (const g of ['g2', 'g3'])
  for (const cell of ['K1', 'K3']) for (const d of [1, 5, 10]) B.push(row(g, cell, d))

describe('previewContrastPair', () => {
  it('reports how each shared condition’s values align across the two datasets', () => {
    const p = previewContrastPair(A, B, [])
    expect(p.candidates).toEqual(['cell', 'cmpd', 'dose'])
    expect(p.values.cell).toEqual({
      both: ['K1'],
      onlyA: ['K2'],
      onlyB: ['K3'],
      a: ['K1', 'K2'],
      b: ['K1', 'K3']
    })
    expect(p.values.dose).toMatchObject({ both: ['1', '5'], onlyA: [], onlyB: ['10'] })
  })

  it('unmatched conditions with several values must be fixed — never pooled', () => {
    const p = previewContrastPair(A, B, [], { a: 'first', b: 'second' })
    expect(p.matched).toEqual([])
    // cell and dose vary on both sides; cmpd has one value (X) so it needs no pin
    expect(p.unpinned).toEqual([
      { cond: 'cell', side: 'a' },
      { cond: 'cell', side: 'b' },
      { cond: 'dose', side: 'a' },
      { cond: 'dose', side: 'b' }
    ])
    expect(p.warnings[0]).toMatch(/Pick one cell on first/)
  })

  it('fixing one slice per side resolves it: one group, paired genes counted', () => {
    const fix = { a: { cell: 'K2', dose: '5' }, b: { cell: 'K3', dose: '10' } }
    const p = previewContrastPair(A, B, [], { a: 'first', b: 'second' }, fix)
    expect(p.unpinned).toEqual([])
    expect(p.groups).toBe(1)
    // fixed slices become part of each dataset's name; cmpd is single-valued (X) on both
    expect(p.columns).toEqual(['dataset A', '', 'dataset B', 'paired genes'])
    expect(p.rows).toEqual([
      [
        'first (cell K2 · cmpd X · dose 5)',
        'vs',
        'second (cell K3 · cmpd X · dose 10)',
        '1 (2 vs 2)'
      ]
    ])
    expect(p.warnings).toEqual([])
  })

  it('matched ⇒ one group per shared combination, one-sided combos dropped', () => {
    const p = previewContrastPair(A, B, ['cell', 'dose'])
    expect(p.matched).toEqual(['cell', 'dose'])
    expect(p.unpinned).toEqual([]) // cmpd is single-valued on both
    // shared: K1×1, K1×5 (K2 only on A; K3 and dose 10 only on B)
    expect(p.groups).toBe(2)
    expect(p.columns).toEqual(['dataset A', '', 'dataset B', 'cell', 'dose', 'paired genes'])
    expect(p.rows.map((r) => r.slice(3, 5))).toEqual([
      ['K1', '1'],
      ['K1', '5']
    ])
    expect(p.rows[0][0]).toBe('A (cmpd X)') // the single-valued cmpd rides along in the name
  })

  it('warns when nothing can pair', () => {
    const onlyK2 = A.filter((r) => r.cell === 'K2')
    const onlyK3 = B.filter((r) => r.cell === 'K3')
    // dose still varies on both sides — fix it so the only remaining issue is the cell mismatch
    const fix = { a: { dose: '5' }, b: { dose: '5' } }
    const p = previewContrastPair(onlyK2, onlyK3, ['cell'], { a: 'A', b: 'B' }, fix)
    expect(p.unpinned).toEqual([])
    expect(p.warnings[0]).toMatch(/share no combination/)
  })

  it('a stale pin on a condition that is matched again is ignored', () => {
    // dose was fixed to different slices, then switched back to matched: the pins must not
    // filter the sides apart.
    const fix = { a: { dose: '5' }, b: { dose: '10' } }
    const p = previewContrastPair(A, B, ['cell', 'dose'], { a: 'A', b: 'B' }, fix)
    expect(p.groups).toBe(2) // K1×1, K1×5 as with no pins at all
    expect(p.warnings).toEqual([])
  })
})
