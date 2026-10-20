import { describe, expect, it } from 'vitest'
import { driftsByDefault } from '../engine'
import { driftFollowsBaselines, fitOf, setFit } from './axisFits'

describe('surface drift follows the baselines, not the axis order', () => {
  it('a reference axis drifts along a matched one; two of a kind both drift', () => {
    expect(driftsByDefault('reference', 'matched')).toBe(true)
    expect(driftsByDefault('matched', 'reference')).toBe(false)
    expect(driftsByDefault('reference', 'reference')).toBe(true)
    expect(driftsByDefault('matched', 'matched')).toBe(true)
  })

  it('dose drifts along time whichever comes first', () => {
    const drift = (axes: ['dose' | 'time', 'dose' | 'time']) =>
      Object.fromEntries(axes.map((a, i) => [a, fitOf(undefined, axes, i, 'spline').coupled]))
    expect(drift(['dose', 'time'])).toEqual({ dose: true, time: false })
    expect(drift(['time', 'dose'])).toEqual({ dose: true, time: false })
  })

  it('follows a baseline set against the preset', () => {
    // time set to a reference too (one control): both drift
    const axes = ['dose', 'time'] as const
    const both = axes.map((_, i) => fitOf(undefined, axes, i, 'spline', { time: 'reference' }))
    expect(both.map((f) => f.coupled)).toEqual([true, true])
    // dose matched, time reference: the roles swap
    const swap = axes.map(
      (_, i) => fitOf(undefined, axes, i, 'spline', { dose: 'matched', time: 'reference' }).coupled
    )
    expect(swap).toEqual([false, true])
  })

  it('a one-axis curve has no drift', () => {
    expect(fitOf(undefined, ['dose'], 0, 'spline').coupled).toBe(false)
  })

  it('stores the drift only once picked, and a baseline change clears it', () => {
    const axes = ['dose', 'time'] as const
    const shaped = setFit(undefined, axes, 0, 'describe', 'linear', 'spline')
    expect(shaped.dose?.coupled).toBeUndefined()
    expect(shaped.time?.coupled).toBeUndefined()
    const picked = setFit(shaped, axes, 1, 'coupled', true, 'spline')
    expect(picked.time?.coupled).toBe(true)
    expect(picked.dose?.coupled).toBeUndefined()
    const cleared = driftFollowsBaselines(picked, axes)
    expect(cleared?.time?.coupled).toBeUndefined()
    expect(cleared?.dose?.describe).toBe('linear')
  })
})
