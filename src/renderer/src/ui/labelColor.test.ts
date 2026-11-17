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
