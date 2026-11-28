import { describe, expect, it } from 'vitest'

import {
  cutoffLabel,
  cutoffsFromLabel,
  runContrastPair,
  statTails,
  valueCutoffs,
  type ContrastResultRow,
  type ContrastSideRow,
  type ContrastStat,
  type ValueCutoffs
} from './contrast'

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
    expect(statTails({ bandConfidence: 0.95 })).toEqual({ confUp: 0.95, confDown: 0.95 })
    // asymmetric: the band's down tail on its own
    expect(statTails({ bandConfidence: 0.95, asymmetric: true, bandConfidenceDown: 0.8 })).toEqual({
      confUp: 0.95,
      confDown: 0.8
    })
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

describe('linear cutoff: a value per axis tail', () => {
  // Both sides centred at 0; g5 is low on B only, g6 low on A only, g7 high on both.
  const base = Array.from({ length: 40 }, (_, i) => ((i % 7) - 3) / 20)
  const a = [...base]
  const b = [...base]
  b[5] = -0.6
  a[6] = -0.6
  a[7] = 0.9
  b[7] = 0.9
  const run = (stat: ContrastStat, defaults?: Partial<ValueCutoffs>) =>
    runContrastPair({
      sideA: side(a),
      sideB: side(b),
      match: [],
      relationship: 'independent',
      stat,
      cutoffDefaults: defaults
    })
  const call = (rows: ContrastResultRow[], id: string): string =>
    rows.find((r) => r.uniqID === id)!.effect
  it("starts at the inputs' cutoffs, a gene past one called that way on that axis", () => {
    const { rows } = run({}, { aUp: 0.5, aDown: -0.5, bUp: 0.5, bDown: -0.5 })
    expect(call(rows, 'g5')).toBe('—, down')
    expect(call(rows, 'g6')).toBe('down, —')
    expect(call(rows, 'g7')).toBe('up, up')
    expect(call(rows, 'g0')).toBe('none')
    expect(rows[0].thrsh).toBe('cutoff A ≥ 0.5, ≤ -0.5 · B ≥ 0.5, ≤ -0.5')
  })
  it('a tail set here wins; one set to none calls nothing', () => {
    const { rows } = run(
      { values: { value: { bDown: null, aDown: -0.7 } } },
      { aUp: 0.5, aDown: -0.5, bUp: 0.5, bDown: -0.5 }
    )
    expect(call(rows, 'g5')).toBe('none') // B down: no cutoff
    expect(call(rows, 'g6')).toBe('none') // A down: −0.6 is inside −0.7
    expect(rows[0].thrsh).toBe('cutoff A ≥ 0.5, ≤ -0.7 · B ≥ 0.5')
  })
  it('no cutoffs anywhere calls nothing', () => {
    const { rows } = run({})
    expect(rows.every((r) => r.effect === 'none')).toBe(true)
    expect(rows[0].thrsh).toBe('cutoff A none · B none')
  })
})

describe('valueCutoffs', () => {
  it('significance is cut above only, at its cutoff', () => {
    expect(
      valueCutoffs({ values: { p: { aDown: 1 } } }, 'p', { aUp: 1.3, bUp: 2, bDown: 0 })
    ).toEqual({ aUp: 1.3, aDown: null, bUp: 2, bDown: null })
  })
  it('reads back off the label', () => {
    const c = { aUp: 1.30103, aDown: null, bUp: 0.5, bDown: -1e-7 }
    expect(cutoffsFromLabel(cutoffLabel(c))).toEqual(c)
    expect(cutoffsFromLabel('ols prediction, 99%')).toBeNull()
  })
})
