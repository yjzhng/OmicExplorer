import { describe, expect, it } from 'vitest'

import { siUnit } from './siUnit'

describe('siUnit', () => {
  it('offers the SI spelling of a hand-typed unit', () => {
    expect(siUnit('uM')).toBe('µM')
    expect(siUnit('μM')).toBe('µM') // the Greek mu → the micro sign
    expect(siUnit('nm')).toBe('nM')
    expect(siUnit('ug/ml')).toBe('µg/mL')
    expect(siUnit('mg/ml')).toBe('mg/mL')
    expect(siUnit('hrs')).toBe('h')
    expect(siUnit('Minutes')).toBe('min')
    expect(siUnit('degC')).toBe('°C')
    expect(siUnit('percent')).toBe('%')
  })
  it('says nothing for a unit already standard, or one it doesn’t know', () => {
    expect(siUnit('µM')).toBeNull()
    expect(siUnit('nM')).toBeNull()
    expect(siUnit('h')).toBeNull()
    expect(siUnit('MIC')).toBeNull()
    expect(siUnit('')).toBeNull()
  })
})
