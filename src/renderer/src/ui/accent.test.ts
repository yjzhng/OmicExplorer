import { describe, expect, it } from 'vitest'

import { accentColors, PALETTES, textOn } from './theme'

describe('textOn', () => {
  it('puts dark text on light colours and white on dark ones', () => {
    expect(textOn('#eab400')).toBe('#1a1a1a') // the logo's orange
    expect(textOn('#ffffff')).toBe('#1a1a1a')
    expect(textOn('#1a1a1a')).toBe('#ffffff')
    expect(textOn('#2563eb')).toBe('#ffffff')
  })
  it('falls back to white for a malformed colour', () => {
    expect(textOn('auto')).toBe('#ffffff')
  })
})

describe('accentColors', () => {
  it('uses the palette accent for graphite and the logo colours for blue / orange', () => {
    expect(accentColors('graphite', 'light', '#000000')).toEqual([
      PALETTES.light.accent,
      PALETTES.light.accentText
    ])
    expect(accentColors('blue', 'dark', '#000000')).toEqual(['#99a0fd', '#1a1a1a'])
    expect(accentColors('orange', 'light', '#000000')[0]).toBe('#eab400')
  })
  it('uses the picked colour for custom', () => {
    expect(accentColors('custom', 'dark', '#123456')).toEqual(['#123456', '#ffffff'])
  })
})
