import { describe, expect, it } from 'vitest'

import { runContrastPair, statTails, type ContrastSideRow } from './contrast'

const side = (vals: number[], sig = true): ContrastSideRow[] =>
  vals.map((value, i) => ({
    uniqID: `g${i}`,
    cell: '',
    cmpd: 'X',
    dose: null,
    time: null,
    value,
    signf: sig,
    effect: value >= 0 ? 'up' : 'down',
    pP: 3,
    pQ: 3
  }))

describe('asymmetric contrast statistic', () => {
  it('statTails mirrors the down tail unless asymmetric', () => {
    expect(statTails({ bandConfidence: 0.95, cutoffQ: 0.05 })).toEqual({
      confUp: 0.95,
      confDown: 0.95,
      q: { aUp: 0.05, aDown: 0.05, bUp: 0.05, bDown: 0.05 }
    })
    // asymmetric: the band's down tail, and each axis tail of the linear cutoff, on its own —
    // unset tails fall back to the primary q
    expect(
      statTails({
        bandConfidence: 0.95,
        cutoffQ: 0.05,
        asymmetric: true,
        bandConfidenceDown: 0.8,
        cutoffQTails: { bDown: 0.2 }
      })
    ).toMatchObject({ confDown: 0.8, q: { aUp: 0.05, aDown: 0.05, bUp: 0.05, bDown: 0.2 } })
  })

  it('a looser down tail calls a below-line outlier the strict symmetric setting misses', () => {
    // A ≈ B for most genes; one gene sits moderately BELOW the line (A < B).
    const b = Array.from({ length: 40 }, (_, i) => (i - 20) / 10)
    const a = b.map((v, i) => v + (i % 2 ? 0.05 : -0.05))
    a[7] = b[7] - 0.2
    const strict = runContrastPair({
      sideA: side(a),
      sideB: side(b),
      match: [],
      stat: { bandConfidence: 0.999 }
    })
    const loose = runContrastPair({
      sideA: side(a),
      sideB: side(b),
      match: [],
      stat: { bandConfidence: 0.999, asymmetric: true, bandConfidenceDown: 0.9 }
    })
    const g7 = (r: typeof strict) => r.rows.find((x) => x.uniqID === 'g7')!
    expect(g7(strict).signf).toBe(false)
    expect(g7(loose).signf).toBe(true)
    expect(g7(loose).effect).toBe('down')
    expect(loose.rows[0].thrsh).toBe('ols prediction, 99.9%/90%')
  })
})

describe('linear cutoff with per-axis tails', () => {
  it('a looser B-down tail calls a low-B outlier that A-tails leave alone', () => {
    // Both sides centred at 0; g5 is low on B only, g6 low on A only.
    const base = Array.from({ length: 40 }, (_, i) => ((i % 7) - 3) / 20)
    const a = [...base]
    const b = [...base]
    b[5] = -0.6
    a[6] = -0.6
    const run = (tails?: Record<string, number>) =>
      runContrastPair({
        sideA: side(a),
        sideB: side(b),
        match: [],
        relationship: 'independent',
        stat: { cutoffQ: 0.0001, asymmetric: !!tails, cutoffQTails: tails }
      }).rows
    const strict = run()
    expect(strict.find((r) => r.uniqID === 'g5')!.signf).toBe(false)
    expect(strict.find((r) => r.uniqID === 'g6')!.signf).toBe(false)
    const loose = run({ bDown: 0.5 })
    expect(loose.find((r) => r.uniqID === 'g5')!.signf).toBe(true) // B down: loosened
    expect(loose.find((r) => r.uniqID === 'g6')!.signf).toBe(false) // A down: still strict
    expect(loose[0].thrsh).toBe(
      'marginal gaussian (robust), per-axis q < A 0.0001/0.0001, B 0.0001/0.5'
    )
  })
})
