import { describe, expect, it } from 'vitest'

import { inPlotOrder, orderedKeys } from './plotOrder'
import { entryKey, plotEntriesFor } from './registry'

describe('plot order', () => {
  it('lists every plot, the stored ones first in their order', () => {
    expect(orderedKeys(['a', 'b', 'c', 'd'], undefined)).toEqual(['a', 'b', 'c', 'd'])
    // a stored key the step no longer offers is dropped; one added since goes last
    expect(orderedKeys(['a', 'b', 'c', 'd'], ['c', 'gone', 'a', 'b'])).toEqual(['c', 'a', 'b', 'd'])
  })

  it('adds the picked plots in that order', () => {
    const entries = [
      ...plotEntriesFor('volcano'),
      ...plotEntriesFor('heatmap'),
      ...plotEntriesFor('dr', ['dose', 'time', '@temp'])
    ]
    const stored = ['dr:axis=time', 'heatmap', 'dr:axis=dose', 'volcano']
    // a Response plot over a condition of your own sits beside its kind's first, Time response
    expect(inPlotOrder(entries, stored).map(entryKey)).toEqual([
      'dr:axis=time',
      'dr:axis=@temp',
      'heatmap',
      'dr:axis=dose',
      'volcano'
    ])
    expect(inPlotOrder(entries, undefined)).toBe(entries)
  })
})
