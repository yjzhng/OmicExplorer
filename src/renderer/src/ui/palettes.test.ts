/**
 * The colour palettes: values from their reference sources (d3-scale-chromatic; matplotlib's
 * coolwarm), reversal, the samples a fold change's encodings take, and earlier versions' names.
 */
import { describe, expect, it } from 'vitest'

import {
  categoricalIds,
  customSpectrumAt,
  isPaletteId,
  PALETTE_IDS,
  setCustomCategorical,
  setCustomSpectrum,
  paletteAt,
  paletteEffectColors,
  effectHalves,
  paletteHalves,
  paletteScale,
  paletteSeries,
  toPaletteRef
} from './palettes'

describe('palettes', () => {
  it("coolwarm is matplotlib's: blue → grey → red", () => {
    const cw = { id: 'coolwarm' as const }
    expect(paletteAt(cw, 0)).toBe('#3b4cc0')
    expect(paletteAt(cw, 0.5)).toBe('#dddddd')
    expect(paletteAt(cw, 1)).toBe('#b40426')
  })

  it("classic is the app's earlier effect colours: its samples are exactly them", () => {
    expect(paletteEffectColors({ id: 'classic' })).toEqual({
      down: '#4e79a7',
      none: '#8a8f98',
      up: '#e15759'
    })
  })

  it('reads ColorBrewer and the uniform maps from d3-scale-chromatic', () => {
    expect(paletteAt({ id: 'RdBu' }, 0)).toBe('#67001f')
    expect(paletteAt({ id: 'RdBu' }, 1)).toBe('#053061')
    expect(paletteAt({ id: 'viridis' }, 0)).toBe('#440154')
    expect(paletteAt({ id: 'viridis' }, 1)).toBe('#fde725')
    // every listed palette answers a hex colour
    for (const id of PALETTE_IDS) expect(paletteAt({ id }, 0.3)).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('reversed runs the same colours the other way', () => {
    for (const t of [0, 0.2, 0.5, 1])
      expect(paletteAt({ id: 'PiYG', reverse: true }, t)).toBe(paletteAt({ id: 'PiYG' }, 1 - t))
    const scale = paletteScale({ id: 'Blues', reverse: true }, 3)
    expect(scale.map(([t]) => t)).toEqual([0, 0.5, 1])
    expect(scale[0][1]).toBe(paletteAt({ id: 'Blues' }, 1))
  })

  it("samples a fold change's encodings from one palette", () => {
    const cw = { id: 'coolwarm' as const }
    expect(paletteEffectColors(cw)).toEqual({ down: '#3b4cc0', none: '#dddddd', up: '#b40426' })
    // enrichment: each half from the centre out
    const h = paletteHalves(cw)
    expect(h.down[0][1]).toBe('#dddddd')
    expect(h.down[h.down.length - 1][1]).toBe('#3b4cc0')
    expect(h.up[h.up.length - 1][1]).toBe('#b40426')
  })

  it("draws a series from a sequential palette's visible part", () => {
    // Blues' low end is near-white: a series starts part-way in
    expect(paletteSeries({ id: 'Blues' }, 0, 5)).toBe(paletteAt({ id: 'Blues' }, 0.3))
    expect(paletteSeries({ id: 'Blues' }, 4, 5)).toBe(paletteAt({ id: 'Blues' }, 1))
  })

  it('reads values stored by earlier versions', () => {
    expect(toPaletteRef('Viridis')).toEqual({ id: 'viridis', reverse: undefined })
    expect(toPaletteRef('Cividis', true)).toEqual({ id: 'cividis', reverse: true })
    expect(toPaletteRef({ id: 'PuOr', reverse: true })).toEqual({ id: 'PuOr', reverse: true })
    // 'effect' (the old app scale) and Plotly names with no counterpart fall back to automatic
    expect(toPaletteRef('effect')).toBeUndefined()
    expect(toPaletteRef('Portland')).toBeUndefined()
    expect(toPaletteRef({ id: 'nope' })).toBeUndefined()
  })

  it('a custom spectrum blends each pair half-way at its midpoint', () => {
    const def = { colors: ['#000000', '#ffffff', '#ff0000'], mids: [0.5, 0.25] }
    expect(customSpectrumAt(def, 0)).toBe('#000000')
    expect(customSpectrumAt(def, 0.5)).toBe('#ffffff')
    expect(customSpectrumAt(def, 1)).toBe('#ff0000')
    // first pair: a plain blend — half-way at its middle (t = 0.25)
    expect(customSpectrumAt(def, 0.25)).toBe('#808080')
    // second pair: half-way already a quarter of the way along it (t = 0.5 + 0.25 · 0.5)
    expect(customSpectrumAt(def, 0.625)).toBe('#ff8080')
  })

  it('offers the custom palettes only once defined', () => {
    setCustomSpectrum(undefined)
    setCustomCategorical(undefined)
    expect(isPaletteId('custom')).toBe(false)
    expect(toPaletteRef({ id: 'custom' })).toBeUndefined()
    expect(categoricalIds()).toEqual(['tab10', 'Set2'])
    setCustomSpectrum({ colors: ['#000000', '#ffffff'], mids: [0.5] })
    setCustomCategorical(['#111111', '#222222'])
    expect(isPaletteId('custom')).toBe(true)
    expect(paletteAt({ id: 'custom' }, 1)).toBe('#ffffff')
    expect(categoricalIds()).toEqual(['tab10', 'Set2', 'custom'])
    setCustomSpectrum(undefined)
    setCustomCategorical(undefined)
  })
})

describe('effectHalves', () => {
  it('fades each side from a pale tint to its own colour', () => {
    const h = effectHalves({ up: '#00aa00', down: '#aa00aa' })
    expect(h.up[h.up.length - 1]).toEqual([1, '#00aa00'])
    expect(h.down[h.down.length - 1]).toEqual([1, '#aa00aa'])
    // the palest end is still its side's hue, not a shared neutral
    expect(h.up[0][1]).not.toBe(h.down[0][1])
  })
  it('keeps a non-hex colour throughout', () => {
    expect(effectHalves({ up: 'red', down: 'blue' }).up).toEqual([
      [0, 'red'],
      [1, 'red']
    ])
  })
})
