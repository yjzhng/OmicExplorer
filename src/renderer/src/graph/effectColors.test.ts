/**
 * Effect-group colours: a Compare sets up / down, and every plot it feeds follows them unless the
 * plot sets its own (unset or 'auto' = follow).
 */
import { describe, expect, it } from 'vitest'

import { resolveGroups } from '../ui/pointStyle'
import { EFFECT_COLOR } from '../ui/theme'
import { effectColorsOf, plotEffectColors } from './types'

describe('effect colours', () => {
  const compare = { effectColors: { up: '#ff8800', none: '#cccccc' } }

  it("fills a Compare's unset colours with the defaults", () => {
    expect(effectColorsOf(compare)).toEqual({
      up: '#ff8800',
      down: EFFECT_COLOR.down,
      none: '#cccccc'
    })
    expect(effectColorsOf(undefined)).toEqual(EFFECT_COLOR)
  })

  it('a plot follows the Compare unless it sets its own', () => {
    expect(plotEffectColors(undefined, compare).up).toBe('#ff8800')
    expect(plotEffectColors({ up: 'auto' }, compare).up).toBe('#ff8800')
    expect(plotEffectColors({ down: '#00aa00' }, compare)).toEqual({
      up: '#ff8800',
      down: '#00aa00',
      none: '#cccccc'
    })
  })

  it("a point plot's automatic group colour is the Compare's; its own overrides", () => {
    const colors = effectColorsOf(compare)
    expect(resolveGroups(undefined, 'volcano', undefined, colors).get('up')!.color).toBe('#ff8800')
    const auto = { groups: { up: { color: 'auto', size: 9 } } }
    expect(resolveGroups(auto, 'volcano', undefined, colors).get('up')!.color).toBe('#ff8800')
    const own = { groups: { up: { color: '#123456' } } }
    expect(resolveGroups(own, 'volcano', undefined, colors).get('up')!.color).toBe('#123456')
    expect(resolveGroups(undefined, 'volcano', undefined, colors).get('none')!.color).toBe(
      '#cccccc'
    )
    const names = { up: 'gain', down: 'loss', none: 'unchanged' }
    expect(resolveGroups(undefined, 'volcano', names, colors).get('none')!.name).toBe('unchanged')
  })
})
