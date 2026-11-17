import { describe, expect, it } from 'vitest'

import {
  comparisonText,
  conditionText,
  contextText,
  fileTitle,
  namePart,
  uniqueNames
} from './fileNames'

describe('file names', () => {
  it('reads as the results page does: tab, plot, comparison, the view with units', () => {
    const units = { dose: 'µM', time: 'h' }
    expect(
      fileTitle([
        'AU28 r3',
        'Volcano',
        comparisonText('AU-28 | DMSO'),
        contextText(
          [
            { dim: 'dose', value: 0.16 },
            { dim: 'time', value: 72 }
          ],
          units
        )
      ])
    ).toBe('AU28 r3 - Volcano - AU-28 vs DMSO - 0.16 µM, 72 h')
    // no view, no comparison: just the tab and the table
    expect(fileTitle(['AU28 r3', 'Clean data matrix', null, ''])).toBe(
      'AU28 r3 - Clean data matrix'
    )
  })

  it('names a bare number by its condition, and keeps a category as it is', () => {
    expect(conditionText('dose', 2.5, {})).toBe('dose 2.5')
    expect(conditionText('dose', 2.5, { dose: 'a.u.' })).toBe('dose 2.5')
    expect(conditionText('cell', 'WT', {})).toBe('WT')
  })

  it('replaces only what a file system refuses', () => {
    expect(namePart('Drug A / Veh: 2.5 µM?')).toBe('Drug A - Veh- 2.5 µM')
    expect(namePart('  .hidden  ')).toBe('hidden')
  })

  it('numbers repeats, ignoring case, before the extension', () => {
    expect(uniqueNames(['a/Volcano.png', 'a/volcano.png', 'a/Volcano.png', 'b/MA.png'])).toEqual([
      'a/Volcano.png',
      'a/volcano (2).png',
      'a/Volcano (3).png',
      'b/MA.png'
    ])
  })
})
