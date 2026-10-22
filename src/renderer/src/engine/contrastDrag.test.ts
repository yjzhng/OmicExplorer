/**
 * Dragging a contrast scatter's guide: the calls are redone from the stored rows (no re-run) and
 * must equal a fresh run at the new cutoff; a dragged edge / line maps back to the cutoff that
 * draws it there; the patch is written the way the Statistic panel writes it.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'

import { contrastStatDrag, reclassifyContrast, runContrast, type ContrastStat } from './contrast'
import { bandConfAt, bandEdgePath, buildScatter, marginalQAt } from './plotData'
import { studentTppf } from './stats'
import type { CompareResultRow } from './types'

const here = dirname(fileURLToPath(import.meta.url))
const fx = (name: string): string => readFileSync(join(here, '__fixtures__', name), 'utf8')

const rows: CompareResultRow[] = Papa.parse<Record<string, string>>(
  fx('contrast_marginal_input.csv'),
  { header: true, skipEmptyLines: true }
)
  .data.filter((r) => r.uniqID)
  .map((r) => ({
    uniqID: r.uniqID,
    cmpd: r.cmpd,
    dose: null,
    time: null,
    cmp_cond: 'cmpd',
    comparison: r.comparison,
    mean1: null,
    mean2: null,
    sd1: null,
    sd2: null,
    log2FC: Number(r.log2FC),
    pP: Number(r.pP),
    pQ: Number(r.pQ),
    thrsh: '',
    signf: r.signf.toLowerCase() === 'true',
    effect: r.effect as CompareResultRow['effect']
  }))

const run = (relationship: 'correlated' | 'independent', stat: ContrastStat) =>
  runContrast({ rows, condition: 'cmpd', pair: ['A', 'B'], relationship, stat })
const calls = (r: { rows: Array<{ uniqID: string; signf: boolean; effect: string }> }) =>
  r.rows.map((x) => `${x.uniqID}:${x.signf}:${x.effect}`)

describe('re-calling a contrast in place', () => {
  for (const relationship of ['correlated', 'independent'] as const)
    it(`${relationship}: equals a fresh run at the new cutoff`, () => {
      const before = run(relationship, { bandConfidence: 0.99, cutoffQ: 0.01 })
      const stat = { bandConfidence: 0.9, cutoffQ: 0.1 }
      const redone = reclassifyContrast(before, relationship, stat)!
      expect(calls(redone)).toEqual(calls(run(relationship, stat)))
      expect(redone.rows[0].thrsh).toBe(run(relationship, stat).rows[0].thrsh)
    })
  it('needs a re-run for a result that kept no classify', () => {
    const { classify: _drop, ...old } = run('correlated', {})
    void _drop
    expect(reclassifyContrast(old, 'correlated', {})).toBeNull()
  })
})

describe('a dragged guide maps back to its cutoff', () => {
  it('band edge: the confidence it is drawn at', () => {
    const g = buildScatter(run('correlated', { bandConfidence: 0.95 }).rows).guide!
    const path = bandEdgePath(g.band!, 0.95, 1)
    const [, x, y] = /L([-\d.e]+),([-\d.e]+)/.exec(path.split('L')[30].replace(/^/, 'L'))!
    expect(bandConfAt(g.band!, Number(x), Number(y))).toBeCloseTo(0.95, 6)
  })
  it('axis line: a q that keeps the same genes beyond it', () => {
    const ctr = run('independent', { cutoffQ: 0.05 })
    const g = buildScatter(ctr.rows).guide!
    const q = marginalQAt(g, 'y', g.yHi!)
    // dropped back at its own position, the up line of A re-calls nothing differently
    const redone = reclassifyContrast(ctr, 'independent', {
      cutoffQ: 0.05,
      asymmetric: true,
      cutoffQTails: { aUp: contrastStatDrag({ asymmetric: true }, 'aUp', q).cutoffQ }
    })!
    expect(calls(redone)).toEqual(calls(ctr))
  })
})

describe('the drag patch', () => {
  it('symmetric: any edge sets the primary level, both models', () => {
    expect(contrastStatDrag({}, 'bandDown', 0.954)).toEqual({
      bandConfidence: 0.954,
      cutoffQ: 0.046
    })
    // a q rounds UP, to 0.001% (the finest tail)
    expect(contrastStatDrag({}, 'bDown', 0.012341)).toEqual({
      cutoffQ: 0.01235,
      bandConfidence: 0.98765
    })
  })
  it('asymmetric: a secondary edge sets its own tail', () => {
    expect(contrastStatDrag({ asymmetric: true }, 'bandDown', 0.9)).toEqual({
      bandConfidenceDown: 0.9
    })
    expect(
      contrastStatDrag({ asymmetric: true, cutoffQTails: { bUp: 0.02 } }, 'aDown', 0.03)
    ).toEqual({ cutoffQTails: { bUp: 0.02, aDown: 0.03 } })
  })
})

describe('the drawn boundary agrees with the calls', () => {
  // a contrast's calls, judged against the boundary the scatter draws for them
  const mismatches = (ctr: ReturnType<typeof runContrast>): number => {
    const sc = buildScatter(ctr.rows)
    const g = sc.guide!
    let bad = 0
    for (const p of sc.points) {
      let outside: boolean
      if (g.kind === 'ols') {
        const b = g.band!
        const r = p.y - (b.beta0 + b.beta1 * p.x)
        const lever = b.fixed
          ? b.sErr
          : b.sErr * Math.sqrt(1 + 1 / b.n + (p.x - b.xMean) ** 2 / b.Sxx)
        const c = r > 0 ? g.cutoffs!.confUp : g.cutoffs!.confDown
        outside = Math.abs(r) > studentTppf(1 - c, b.df) * lever
      } else outside = p.y > g.yHi! || p.y < g.yLo! || p.x > g.xHi! || p.x < g.xLo!
      if (outside !== (p.effect !== 'none')) bad++
      // a called gene's colour is the side of the fit it broke out on
      if (g.kind === 'ols' && p.effect !== 'none') {
        const b = g.band!
        if ((p.effect === 'up') !== p.y > b.beta0 + b.beta1 * p.x) bad++
      }
    }
    return bad
  }
  // y = 0.6·x + noise: a fit well off the y = x diagonal
  let seed = 7
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
  const gauss = (): number => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd())
  const syn: CompareResultRow[] = []
  for (let i = 0; i < 400; i++) {
    const x = gauss() * 2
    const y = 0.6 * x + gauss() * 0.3
    for (const [cmpd, v] of [
      ['A', y],
      ['B', x]
    ] as const)
      syn.push({ ...rows[0], uniqID: `g${i}`, cmpd, comparison: `${cmpd} | V`, log2FC: v })
  }
  const synRun = (model: 'linear' | 'identity') =>
    runContrast({
      rows: syn,
      condition: 'cmpd',
      pair: ['A', 'B'],
      relationship: 'correlated',
      stat: { model },
      driverMask: false
    })
  for (const model of ['linear', 'identity'] as const)
    it(`correlated (${model}), fit well off y = x: band and colours follow the model's line`, () => {
      const ctr = synRun(model)
      expect(ctr.rows.some((r) => r.signf)).toBe(true)
      expect(mismatches(ctr)).toBe(0)
    })
  it('the identity model calls differently from the fit, and re-calls in place', () => {
    const linear = synRun('linear')
    const identity = synRun('identity')
    expect(calls(identity)).not.toEqual(calls(linear))
    expect(identity.rows[0].thrsh).toMatch(/^identity prediction/)
    expect(linear.rows[0].thrsh).toMatch(/^ols prediction/) // omicViz's label, kept
    expect(calls(reclassifyContrast(linear, 'correlated', { model: 'identity' })!)).toEqual(
      calls(identity)
    )
  })
  for (const stat of [{}, { asymmetric: true, cutoffQTails: { aDown: 0.2, bUp: 0.001 } }])
    it(`independent ${JSON.stringify(stat)}: no called gene on or inside a line`, () => {
      const ctr = runContrast({
        rows,
        condition: 'cmpd',
        pair: ['A', 'B'],
        relationship: 'independent',
        stat,
        driverMask: false
      })
      expect(mismatches(ctr)).toBe(0)
    })
})
