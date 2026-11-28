/** The interactive import's samplesheet mode: reading a sheet in any layout, mapping its columns,
 *  matching rows by hand, and the conditions that writes. */
import { describe, expect, it } from 'vitest'

import type { InteractiveSampleCond } from '../../engine'
import { applySheet, mapColumn, pinRow, readSheet, setNameColumn, sheetMatches } from './sheetMap'

const SAMPLES = ['run_A1.raw', 'run_A2.raw', 'run_B1.raw']
const blank = (sample: string): InteractiveSampleCond => ({
  sample,
  include: true,
  cell: '',
  cmpd: '',
  dose: '',
  time: '',
  rep: ''
})
const TEXT = 'Well,File,Compound,Conc,medium\nw1,A1,DMSO,0,LB\nw2,A2,drug,10,LB\nw3,Q9,drug,5,M9\n'

describe('reading a samplesheet as written', () => {
  it('finds the sample-name column by its matches, and maps the columns named as conditions', () => {
    const sheet = readSheet('s.csv', TEXT, SAMPLES, [
      'cell',
      'cmpd',
      'dose',
      'time',
      'rep',
      'medium'
    ])
    expect(sheet.nameCol).toBe('File')
    expect(sheet.map).toEqual({ cmpd: 'Compound', dose: 'Conc', medium: 'medium' })
    expect([...sheetMatches(sheet, SAMPLES)]).toEqual([
      ['run_A1.raw', 0],
      ['run_A2.raw', 1]
    ])
  })
})

describe('mapping and matching', () => {
  const sheet = readSheet('s.csv', TEXT, SAMPLES, [])

  it('maps a column to one condition, unmaps it on a second click, never the name column', () => {
    const a = mapColumn(sheet, 'cmpd', 'Compound')
    expect(a.map).toEqual({ cmpd: 'Compound' })
    expect(mapColumn(a, 'cell', 'Compound').map).toEqual({ cell: 'Compound' })
    expect(mapColumn(a, 'cmpd', 'Compound').map).toEqual({})
    expect(mapColumn(a, 'cell', 'File')).toBe(a)
    expect(setNameColumn(a, 'Compound')).toMatchObject({ nameCol: 'Compound', map: {} })
  })

  it('a row dragged onto a sample matches it, taking it from any row it had', () => {
    const p = pinRow(sheet, 'run_B1.raw', 2)
    expect(sheetMatches(p, SAMPLES).get('run_B1.raw')).toBe(2)
    const moved = pinRow(p, 'run_A1.raw', 2)
    expect(moved.pinned).toEqual({ 'run_A1.raw': 2 })
    // A1's own row (0) is now free, but A1 is taken: row 0 has no sample
    expect([...sheetMatches(moved, SAMPLES).values()].sort()).toEqual([1, 2])
    expect(pinRow(moved, 'run_A1.raw', null).pinned).toEqual({})
  })
})

describe('the conditions a sheet writes', () => {
  it('fills mapped conditions from each sample’s row, and leaves out a sample with none', () => {
    const sheet = mapColumn(readSheet('s.csv', TEXT, SAMPLES, ['cmpd']), 'medium', 'medium')
    const spans = {
      'run_A1.raw': { cmpd: [0, 1] as [number, number], cell: [1, 2] as [number, number] }
    }
    const out = applySheet({}, spans, SAMPLES, undefined, sheet, blank)
    expect(out.conditions['run_A2.raw']).toMatchObject({
      cmpd: 'drug',
      include: true,
      extra: { medium: 'LB' }
    })
    expect(out.conditions['run_B1.raw']).toMatchObject({ cmpd: '', include: false })
    // the sheet's condition loses its painted region; another keeps its own
    expect(out.spans['run_A1.raw']).toEqual({ cell: [1, 2] })
  })

  it('clears a condition unmapped, and re-ticks a sample only when its row changes', () => {
    const first = readSheet('s.csv', TEXT, SAMPLES, ['cmpd'])
    const a = applySheet({}, {}, SAMPLES, undefined, first, blank).conditions
    // ticked back in by hand, though the sheet has no row for it
    a['run_B1.raw'] = { ...a['run_B1.raw'], include: true }
    const unmapped = mapColumn(first, 'cmpd', 'Compound')
    const b = applySheet(a, {}, SAMPLES, first, unmapped, blank).conditions
    expect(b['run_A1.raw'].cmpd).toBe('')
    expect(b['run_B1.raw'].include).toBe(true)
    // its row arrives (dragged onto it): ticked in; A2 loses its row (taken): left out
    const c = applySheet(b, {}, SAMPLES, unmapped, pinRow(unmapped, 'run_B1.raw', 1), blank)
    expect(c.conditions['run_B1.raw'].include).toBe(true)
    expect(c.conditions['run_A2.raw'].include).toBe(false)
  })
})
