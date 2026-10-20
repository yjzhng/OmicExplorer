/** A two-way result keeps its model (terms, per-gene fits) through the worker's wire encoding and
 *  a project's packing — every number back, a NaN as null (as JSON carries it). */
import { describe, expect, it } from 'vitest'
import { numericConds } from '../engine'

import { runFactorAnova } from '../engine/twoWay'
import { decodeValue, encodeValue } from '../engine/wire'
import type { StandardRow } from '../engine/types'
import { buildVolcano, isTermRow } from '../engine'
import { toContrastSide } from './contrastPair'
import { packResults, unpackResults } from './resultPack'
import type { NodeResult } from './types'

/** dose and time numeric, no custom condition declared (the schema of these tests' data) */
const numeric = numericConds()

const rows: StandardRow[] = []
for (let g = 0; g < 40; g++)
  for (const cell of ['M', 'W'])
    for (const cmpd of ['A', 'B', 'DMSO'])
      for (let rep = 0; rep < 3; rep++)
        rows.push({
          uniqID: `g${g}`,
          cell,
          cmpd,
          dose: null,
          time: null,
          rep,
          value: 2 ** (8 + ((g * 13 + rep * 7 + cell.length + cmpd.length) % 11) / 10)
        })
const res = runFactorAnova({
  rows,
  factors: [
    {
      condition: 'cmpd',
      pairs: [
        ['A', 'DMSO'],
        ['B', 'DMSO']
      ]
    },
    { condition: 'cell', pairs: [['M', 'W']] }
  ],
  activeConditions: ['cmpd', 'cell']
})
// JSON's view: NaN → null
const asJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v))

describe('a two-way result’s model', () => {
  it('has every gene’s fit', () => {
    expect(res.anova!.slices[0].genes).toHaveLength(40)
    expect(res.anova!.factors.map((f) => f.levels)).toEqual([
      ['A', 'B', 'DMSO'],
      ['M', 'W']
    ])
  })
  it('crosses the worker intact', () => {
    const back = decodeValue(encodeValue(res, [])) as typeof res
    expect(back.anova).toEqual(res.anova)
  })
  it('round-trips through a project file', () => {
    const results: Record<string, NodeResult> = {
      n1: { kind: 'compare', cmp: res, displayMap: {}, annotationMap: {} } as unknown as NodeResult
    }
    const stored = JSON.parse(JSON.stringify(packResults(results)))
    const back = unpackResults(stored).n1 as unknown as { cmp: typeof res }
    expect(back.cmp.anova).toEqual(asJson(res.anova))
  })
})

describe('a two-way result’s term rows', () => {
  const node = {
    kind: 'compare',
    cmp: res,
    displayMap: {},
    annotationMap: {}
  } as unknown as NodeResult
  it('reach the volcano one-sided: an unsigned effect size from 0', () => {
    const cmpdRows = res.rows.filter((r) => r.comparison === 'cmpd')
    expect(cmpdRows.length).toBe(40)
    const v = buildVolcano(cmpdRows, { statType: 'pQ', fcLow: -1, fcHigh: 1, statMin: 1.3 })
    expect(v.unsigned).toBe(true)
    expect(v.points.every((p) => p.x >= 0)).toBe(true)
    expect(v.measure).toBe('effect size (log₂)')
    // a 2×2's rows stay two-sided
    const ia = buildVolcano(
      res.rows.filter((r) => r.comparison === 'A|DMSO × M|W'),
      { statType: 'pQ', fcLow: -1, fcHigh: 1, statMin: 1.3 }
    )
    expect(ia.unsigned).toBeUndefined()
  })
  it('never reach a Contrast side (they’d average into its fold changes)', () => {
    const side = toContrastSide(node)
    expect(side.length).toBe(res.rows.filter((r) => !isTermRow(r)).length)
  })
})

describe('the show pick (overall / factors)', () => {
  it('comes first in the group’s picks, and narrows the comparisons to that kind', async () => {
    const { facetDims, rowsOfKind } = await import('../engine')
    const { resolveFacets } = await import('../dashboard/facet')
    const dims = facetDims(res.rows)
    expect(dims[0]).toBe('show')
    const cmp = (sel: Record<string, string>): string[] =>
      resolveFacets(res.rows, dims, sel, numeric)
        .bars.find((b) => b.dim === 'comparison')!
        .options.map((o) => String(o.value))
    expect(cmp({})).toEqual(['A|DMSO × M|W', 'B|DMSO × M|W'])
    // the model's order: the main effects in factor order, the interaction last
    expect(cmp({ show: 'factors' })).toEqual(['cmpd', 'cell', 'cmpd × cell'])
    // overall first (the default), whatever the alphabet says
    expect(resolveFacets(res.rows, dims, {}, numeric).bars[0].options.map((o) => o.value)).toEqual([
      'overall',
      'factors'
    ])
    // the table / heatmap follow the same pick
    expect(rowsOfKind(res.rows, 'factors').every(isTermRow)).toBe(true)
    expect(rowsOfKind(res.rows, undefined).some(isTermRow)).toBe(false)
  })
})

describe('the plots an ANOVA offers', () => {
  it('greys MA and intensity scatter (no two-group means); the factors plots need its model', async () => {
    const { unmetRequirement } = await import('./requirements')
    const facts = {
      kind: 'compare' as const,
      result: { kind: 'compare', cmp: res } as unknown as NodeResult,
      axes: []
    }
    expect(unmetRequirement('ma', {}, facts)).toMatch(/no two-group means/)
    expect(unmetRequirement('scatter', {}, facts)).toMatch(/no two-group means/)
    expect(unmetRequirement('variance', {}, facts)).toBeNull()
    expect(unmetRequirement('interaction', {}, facts)).toBeNull()
    const tTest = {
      ...facts,
      result: {
        kind: 'compare',
        cmp: { ...res, rows: [], anova: undefined }
      } as unknown as NodeResult
    }
    expect(unmetRequirement('variance', {}, tTest)).toMatch(/Needs an ANOVA/)
    expect(unmetRequirement('ma', {}, tTest)).toBeNull()
  })
})

describe('the plot list before the Compare has run (by its analysis)', () => {
  it('an ANOVA: no MA or intensity scatter; the factors plots offered', async () => {
    const { unmetRequirement } = await import('./requirements')
    const u = { kind: 'compare' as const, axes: [] }
    const twoWay = { ...u, analysis: 'anova' as const }
    expect(unmetRequirement('ma', {}, twoWay)).toMatch(/no two-group means/)
    expect(unmetRequirement('scatter', {}, twoWay)).toMatch(/no two-group means/)
    expect(unmetRequirement('variance', {}, twoWay)).toBeNull()
    expect(unmetRequirement('interaction', {}, twoWay)).toBeNull()
    // a t-test: the other way round
    const tTest = { ...u, analysis: 'compare' as const }
    expect(unmetRequirement('ma', {}, tTest)).toBeNull()
    expect(unmetRequirement('variance', {}, tTest)).toMatch(/Needs an ANOVA/)
    // switched to a 2-way ANOVA, its old t-test result not yet re-run
    const stale = {
      ...twoWay,
      result: {
        kind: 'compare',
        cmp: { ...res, rows: [], anova: undefined }
      } as unknown as NodeResult
    }
    expect(unmetRequirement('variance', {}, stale)).toMatch(/Re-run the Compare/)
  })
})
