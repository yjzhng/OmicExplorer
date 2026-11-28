import { describe, expect, it } from 'vitest'

import { iwanthueColors, tab10Band } from './iwanthue'
import { CATEGORICAL_SCHEMES, categoricalIds } from './palettes'

describe('iWantHue categorical palette', () => {
  it('gives as many distinct colours as asked, deterministically', () => {
    const a = iwanthueColors(60)
    expect(a).toHaveLength(60)
    expect(new Set(a).size).toBe(60)
    expect(iwanthueColors(60)).toEqual(a)
  })

  it('keeps colour k whatever the total (a prefix of the longer list)', () => {
    const long = iwanthueColors(80)
    expect(iwanthueColors(12)).toEqual(long.slice(0, 12))
  })

  it('opens like tab10 (blue, orange, …) and never takes its grey', () => {
    const c = iwanthueColors(40)
    expect(c.slice(0, 2)).toEqual(['#1f77b4', '#ff7f0e'])
    expect(c).not.toContain('#7f7f7f')
  })

  it("stays in tab10's band of lightness and chroma", () => {
    const band = tab10Band()
    expect(band.l[0]).toBeLessThan(band.l[1])
    expect(band.c[0]).toBeLessThan(band.c[1])
    for (const h of iwanthueColors(40)) expect(h).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('is offered as a categorical scheme, one stable list', () => {
    expect(categoricalIds()).toContain('iWantHue')
    expect(CATEGORICAL_SCHEMES.iWantHue.length).toBeGreaterThan(100)
    expect(CATEGORICAL_SCHEMES.iWantHue).toBe(CATEGORICAL_SCHEMES.iWantHue)
  })
})
