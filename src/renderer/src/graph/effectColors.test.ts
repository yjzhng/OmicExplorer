/**
 * Effect-group colours are the plot's: its own colour for a group, else sampled from its FC
 * palette — its own, else the global one (unset or 'auto' = follow the palette). The Compare names
 * the classes; it doesn't colour them.
 */
import { describe, expect, it } from 'vitest'

import { paletteAt, paletteEffectColors } from '../ui/palettes'
import { resolveGroups } from '../ui/pointStyle'
import { EFFECT_COLOR } from '../ui/theme'
import { plotEffectColors } from './types'

describe('effect colours', () => {
  it('a plot with nothing set takes the default colours', () => {
    expect(plotEffectColors(undefined)).toEqual(EFFECT_COLOR)
  })

  it("samples the palette's colours: down its low end, none its middle, up its high end", () => {
    const rdbu = { id: 'RdBu' as const, reverse: true }
    expect(plotEffectColors(undefined, rdbu)).toEqual(paletteEffectColors(rdbu))
    expect(plotEffectColors(undefined, rdbu).down).toBe(paletteAt(rdbu, 0))
  })

  it("resolves a plot's colours: its own → its palette → the global palette", () => {
    const global = { id: 'coolwarm' as const }
    const own = { id: 'PuOr' as const }
    // the plot's palette outranks the global one…
    expect(plotEffectColors(undefined, global, own)).toEqual(paletteEffectColors(own))
    // …and its own group colour outranks its palette ('auto' follows the palette)
    expect(plotEffectColors({ down: '#00aa00', up: 'auto' }, global, own)).toEqual({
      ...paletteEffectColors(own),
      down: '#00aa00'
    })
    // no palette of its own: the global palette's
    expect(plotEffectColors(undefined, global)).toEqual(paletteEffectColors(global))
  })

  it("a point plot's automatic group colour is the plot's effect colour; its own overrides", () => {
    const colors = plotEffectColors({ up: '#ff8800', none: '#cccccc' })
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
