import { describe, expect, it } from 'vitest'

import { withAlpha } from '../ui/theme'
import { drLook, type DRConfig } from './types'

const base: DRConfig = { axis: 'dose', topGenes: 10 }

describe('drLook', () => {
  it('fills every default, keeping colours automatic', () => {
    expect(drLook({ ...base })).toEqual({
      lineWidth: 2,
      lineColor: 'auto',
      lineOpacity: 1,
      points: true,
      pointSize: 7,
      pointColor: 'auto',
      pointOpacity: 0.5,
      errors: true,
      errorStyle: 'band',
      errorColor: 'auto',
      errorOpacity: 0.2,
      ec50Line: false
    })
  })

  it('hides a Curve fit’s error (its confidence band) by default, but keeps one that was set', () => {
    expect(drLook({ ...base }, true).errors).toBe(false)
    expect(drLook({ ...base, errors: true }, true).errors).toBe(true)
    expect(drLook({ ...base, ec50Line: true }, true).ec50Line).toBe(true)
  })

  it('defaults a band to a light fill and whiskers to solid, but keeps an opacity that was set', () => {
    expect(drLook({ ...base, errorStyle: 'band' }).errorOpacity).toBe(0.2)
    expect(drLook({ ...base, errorStyle: 'whisker' }).errorOpacity).toBe(1)
    expect(drLook({ ...base, errorStyle: 'band', errorOpacity: 0.5 }).errorOpacity).toBe(0.5)
  })

  it('resolves once per config object', () => {
    const cfg = { ...base, lineWidth: 3 }
    expect(drLook(cfg)).toBe(drLook(cfg))
    expect(drLook({ ...cfg })).not.toBe(drLook(cfg))
  })
})

describe('withAlpha', () => {
  it('turns hex and rgb() into rgba and passes other colours through', () => {
    expect(withAlpha('#4e79a7', 0.2)).toBe('rgba(78,121,167,0.2)')
    expect(withAlpha('#fff', 1)).toBe('rgba(255,255,255,1)')
    expect(withAlpha('rgb(1, 2, 3)', 0.5)).toBe('rgba(1,2,3,0.5)')
    expect(withAlpha('steelblue', 0.5)).toBe('steelblue')
  })
})
