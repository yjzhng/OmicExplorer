import { describe, expect, it } from 'vitest'

import { applyThreshold, DEFAULT_THRESHOLD, thresholdLabel, type ThresholdConfig } from './stats'

const sam: ThresholdConfig = {
  ...DEFAULT_THRESHOLD,
  type: 'non-linear',
  statMin: 1,
  b: 1,
  s0: -0.5
}

describe('asymmetric hyperbolic threshold', () => {
  it('mirrors s0 on the down side when s0Down is absent', () => {
    // Same |FC| and stat on both sides → same call.
    const up = applyThreshold(1.5, 2.5, sam)
    const down = applyThreshold(-1.5, 2.5, sam)
    expect(up.signf).toBe(down.signf)
    expect(up.effect).toBe('up')
    expect(down.effect).toBe('down')
  })

  it('uses s0Down for negative fold changes only', () => {
    // Down asymptote pushed out to FC_lim = 2: a −1.5 gene is now inside the wall (never called),
    // while the +1.5 gene still clears the up-side curve.
    const asym: ThresholdConfig = { ...sam, asymmetric: true, s0Down: -2 }
    expect(applyThreshold(1.5, 2.5, asym).signf).toBe(true)
    expect(applyThreshold(-1.5, 2.5, asym).signf).toBe(false)
    expect(applyThreshold(-2.5, 5, asym).signf).toBe(true)
  })

  it('keeps the legacy label when the down asymptote matches, and spells it out when not', () => {
    expect(thresholdLabel(sam)).not.toContain('FC_lim_down')
    expect(thresholdLabel({ ...sam, s0Down: -0.5 })).not.toContain('FC_lim_down')
    expect(thresholdLabel({ ...sam, asymmetric: true, s0Down: -2 })).toContain('FC_lim_down=2')
  })
})
