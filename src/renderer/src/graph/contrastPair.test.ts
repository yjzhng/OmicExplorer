import { describe, expect, it } from 'vitest'

import { pairSides, selectSource, usedInputs } from './contrastPair'
import type { ContrastConfig } from './types'

const cfg = (over: Partial<ContrastConfig> = {}): ContrastConfig => ({
  relationship: 'correlated',
  ...over
})

describe('contrast input picks', () => {
  it('pairSides honours configured ids while wired, else the first two edges', () => {
    expect(pairSides(cfg(), ['u1', 'u2', 'u3'])).toEqual(['u1', 'u2'])
    expect(pairSides(cfg({ pairA: 'u3', pairB: 'u1' }), ['u1', 'u2', 'u3'])).toEqual(['u3', 'u1'])
    // stale B → next free edge; A kept
    expect(pairSides(cfg({ pairA: 'u2', pairB: 'gone' }), ['u1', 'u2', 'u3'])).toEqual(['u2', 'u1'])
    expect(pairSides(cfg(), ['u1'])).toBeNull()
  })

  it('selectSource honours the configured input while wired, else the first', () => {
    expect(selectSource(cfg(), ['u1', 'u2'])).toBe('u1')
    expect(selectSource(cfg({ selectFrom: 'u2' }), ['u1', 'u2'])).toBe('u2')
    expect(selectSource(cfg({ selectFrom: 'gone' }), ['u1', 'u2'])).toBe('u1')
  })

  it('usedInputs follows the mode: one input for intra, two for inter, rest idle', () => {
    const ups = ['u1', 'u2', 'u3']
    expect([...usedInputs(cfg({ source: 'select', selectFrom: 'u2' }), ups)]).toEqual(['u2'])
    expect([...usedInputs(cfg({ pairA: 'u1', pairB: 'u3' }), ups)].sort()).toEqual(['u1', 'u3'])
    // a single input is always intra and always used
    expect([...usedInputs(cfg({ source: 'pair' }), ['u1'])]).toEqual(['u1'])
  })
})
