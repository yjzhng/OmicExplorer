import { describe, expect, it } from 'vitest'

// The picker's rule for default plots (TilePicker's `picked`): of the ticked plots, only those the
// upstream offers are added.
import { entryKey, plotEntriesFor } from './registry'
import { gatePlotEntries } from './requirements'

describe('default plots', () => {
  it('drops a ticked default the data can’t support', () => {
    // a Compare over time only: no Dose response is offered, so a default for it isn't added
    const offered = gatePlotEntries(
      [...plotEntriesFor('dr', ['time']), ...plotEntriesFor('volcano')],
      { kind: 'compare', axes: ['time'] }
    )
    const ticked = new Set(['dr:axis=dose', 'dr:axis=time', 'volcano'])
    expect(offered.filter((e) => ticked.has(entryKey(e))).map(entryKey)).toEqual([
      'dr:axis=time',
      'volcano'
    ])
  })
})
