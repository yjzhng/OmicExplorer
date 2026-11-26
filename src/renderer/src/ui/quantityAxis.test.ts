/** Logged abundance shown plain (quantityAxis): ticks, values and hovers. */
import { describe, expect, it } from 'vitest'

import { fmtPlain, fmtQuantity, plainOf, plainRows, plainTicks } from './quantityAxis'

describe('plain values on a log axis', () => {
  it('ticks a decade each, at the logged positions, labelled as values', () => {
    const t = plainTicks('log10') as { tickvals: number[]; ticktext: string[] }
    const at = (v: number): string => t.ticktext[t.tickvals.indexOf(v)]
    expect([at(-2), at(-1), at(0), at(1), at(3)]).toEqual(['0.01', '0.1', '1', '10', '1000'])
    expect(at(6)).toBe('10⁶')
    expect(at(-6)).toBe('10⁻⁶')
    // log₂ positions: the same decades, where they fall on log₂
    const t2 = plainTicks('log2') as { tickvals: number[]; ticktext: string[] }
    const i = t2.ticktext.indexOf('0.1')
    expect(2 ** t2.tickvals[i]).toBeCloseTo(0.1, 9)
    // linear: its positions are its values — nothing to relabel
    expect(plainTicks('linear')).toEqual({})
  })

  it('fits the ticks to a narrow range: 1, 2, 5 per decade, then 1 – 9', () => {
    const lab = (r: [number, number]): string[] =>
      (plainTicks('log10', r) as { ticktext: string[] }).ticktext
    // three decades: one tick each
    expect(lab([-3, 0])).toEqual(['0.001', '0.01', '0.1', '1'])
    // about one decade: 1, 2, 5
    expect(lab([-2, -1])).toEqual(['0.01', '0.02', '0.05', '0.1'])
    // a few-fold (0.02 – 0.05): 1 – 9 within it
    expect(lab([Math.log10(0.02), Math.log10(0.05)])).toEqual(['0.02', '0.03', '0.04', '0.05'])
    // log₂ positions, the same values
    const l2 = plainTicks('log2', [Math.log2(0.02), Math.log2(0.05)]) as { ticktext: string[] }
    expect(l2.ticktext).toEqual(['0.02', '0.03', '0.04', '0.05'])
  })

  it('reads a position back as its value', () => {
    expect(plainOf(-2, 'log10')).toBeCloseTo(0.01, 12)
    expect(plainOf(-1, 'log2')).toBe(0.5)
    expect(plainOf(3, 'linear')).toBe(3)
  })

  it('formats a value to three significant figures, powers of ten past the decimals', () => {
    expect(fmtPlain(0.052345)).toBe('0.0523')
    expect(fmtPlain(1.2345)).toBe('1.23')
    expect(fmtPlain(523.4)).toBe('523')
    expect(fmtPlain(52345)).toBe('52345')
    expect(fmtPlain(2.345e6)).toBe('2.35×10⁶')
    expect(fmtPlain(1e6)).toBe('10⁶')
    expect(fmtPlain(0.00012)).toBe('0.00012')
    expect(fmtPlain(0.000012)).toBe('1.2×10⁻⁵')
    expect(fmtPlain(0)).toBe('0')
    expect(fmtPlain(NaN)).toBe('—')
  })

  it('a hover reads the value when shown plain, the log otherwise', () => {
    expect(fmtQuantity(-1.3, 'log10', true)).toBe('0.0501')
    expect(fmtQuantity(-1.3, 'log10', false)).toBe('-1.300')
    // linear stays as it is either way
    expect(fmtQuantity(0.25, 'linear', true)).toBe('0.250')
    expect(plainRows([['fraction · A', -1]], 'log10')).toBe('fraction · A 0.1')
  })
})
