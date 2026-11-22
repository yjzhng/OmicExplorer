import { describe, expect, it } from 'vitest'

import { AUTO, CLEAR } from './ColorPicker'
import {
  DEFAULT_HIGHLIGHT,
  defaultGroups,
  labelColorOf,
  resolveGroup,
  resolveHighlight
} from './pointStyle'

describe('label colour', () => {
  const [, down] = defaultGroups('volcano')

  it('follows the group’s colour by default (automatic)', () => {
    expect(labelColorOf(resolveGroup(undefined, down), '#000')).toBe(down.color)
    expect(
      labelColorOf(resolveGroup({ groups: { down: { labelColor: AUTO } } }, down), '#000')
    ).toBe(down.color)
    // a recoloured group's labels come along
    expect(
      labelColorOf(resolveGroup({ groups: { down: { color: '#123456' } } }, down), '#000')
    ).toBe('#123456')
  })

  it('takes a colour of its own, and the text colour for a hollow marker', () => {
    expect(
      labelColorOf(resolveGroup({ groups: { down: { labelColor: '#00ff00' } } }, down), '#000')
    ).toBe('#00ff00')
    expect(labelColorOf(resolveGroup({ groups: { down: { color: CLEAR } } }, down), '#111')).toBe(
      '#111'
    )
  })
})

describe('selected label colour', () => {
  it('is the point’s own colour on a point plot, unless one is set', () => {
    expect(resolveHighlight(undefined).labelColor).toBe(AUTO)
    expect(resolveHighlight(undefined, { labelColor: '#abcdef' }).labelColor).toBe('#abcdef')
    expect(resolveHighlight({ highlight: { labelColor: '#111111' } }).labelColor).toBe('#111111')
    // any other chart's overlay keeps the theme text (no colour in its look)
    expect(DEFAULT_HIGHLIGHT.labelColor).toBeUndefined()
  })
})

describe('label size', () => {
  const [, down] = defaultGroups('volcano')
  it('is the plots’ label size unless the group sets its own', () => {
    // unset: the chart's default (PLOT_TEXT.label)
    expect(resolveGroup(undefined, down).labelSize).toBeUndefined()
    expect(resolveGroup({ groups: { down: { labelSize: 13 } } }, down).labelSize).toBe(13)
  })
})

describe('point plot defaults', () => {
  const [none, down] = defaultGroups('volcano')
  it('dots 7 / 8, outline 0 / 0.5, opacity 50% / 80%', () => {
    expect([none.size, none.outline, none.opacity]).toEqual([7, 0, 0.5])
    expect([down.size, down.outline, down.opacity]).toEqual([8, 0.5, 0.8])
  })
  it('selected: 9 px (1 px over a larger dot), outline 0.5; the rest at 20%', () => {
    const g = resolveGroup(undefined, down)
    expect([g.highlight.size, g.highlight.ring, g.highlight.dim]).toEqual([9, 0.5, 0.2])
    expect(resolveGroup({ groups: { down: { size: 12 } } }, down).highlight.size).toBe(13)
    expect(
      resolveGroup({ groups: { down: { highlight: { size: 6 } } } }, down).highlight.size
    ).toBe(6)
  })
})
