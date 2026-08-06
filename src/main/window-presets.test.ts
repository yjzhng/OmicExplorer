import { describe, it, expect } from 'vitest'
import { WINDOW_PRESETS, assertPreset } from './window-presets'

describe('window presets — derived from package.json', () => {
  it('derives aspect ratio, min size, and lock from { label, width, height }', () => {
    const p = WINDOW_PRESETS['landscape-16-9']
    expect(p).toBeDefined()
    expect(p.aspectRatio).toBeCloseTo(16 / 9)
    expect(p.minWidth).toBe(Math.round(p.width / 2))
    expect(p.minHeight).toBe(Math.round(p.height / 2))
    // Free resizing by default: aspect ratio is not locked unless a preset opts in.
    expect(p.lock).toBe(false)
  })

  it('exposes at least one preset', () => {
    expect(Object.keys(WINDOW_PRESETS).length).toBeGreaterThan(0)
  })

  it('assertPreset accepts a known name and throws on an unknown one', () => {
    const known = Object.keys(WINDOW_PRESETS)[0]
    expect(assertPreset(known)).toBe(known)
    expect(() => assertPreset('definitely-not-a-preset')).toThrow(/Unknown window preset/)
  })
})
