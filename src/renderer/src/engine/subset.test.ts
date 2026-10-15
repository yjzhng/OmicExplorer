/** The Subset tile: keep the samples whose conditions take the chosen values. */
import { describe, expect, it } from 'vitest'

import { ALL_OPS, NODE_SPECS, canConnect, maxInputsFor } from '../graph/registry'
import { deriveGroups } from '../graph/groups'
import type { GraphNode, NodeKind } from '../graph/types'
import { conditionLevels, keptBy, subsetStandardize } from './subset'
import type { SampleConds, StandardizeResult, StandardRow } from './types'

const sample = (
  name: string,
  cmpd: string,
  dose: number | null,
  extra?: Record<string, string>
): SampleConds => ({ sample: name, cell: '', cmpd, dose, time: null, rep: 1, extra })

const SAMPLES = [
  sample('s1', 'DMSO', 0, { geno: 'wt' }),
  sample('s2', 'A', 1, { geno: 'wt' }),
  sample('s3', 'A', 10, { geno: 'ko' }),
  sample('s4', 'B10', 10, { geno: 'ko' }),
  sample('s5', 'B2', 1, { geno: '' })
]

const std = (): StandardizeResult => {
  const rows: StandardRow[] = []
  for (const g of ['P1', 'P2'])
    for (const s of SAMPLES)
      rows.push({
        uniqID: g,
        cell: s.cell,
        cmpd: s.cmpd,
        dose: s.dose,
        time: null,
        rep: 1,
        extra: s.extra,
        value: 1
      })
  return {
    rows,
    samples: SAMPLES,
    displayMap: { P1: 'g1', P2: 'g2' },
    annotationMap: {},
    keggCategories: {},
    activeConditions: ['cmpd', 'dose', '@geno'],
    compounds: ['DMSO', 'A', 'B10', 'B2'],
    cleanup: { droppedGenes: 0, sampleCount: 5, minSamplePct: 0 },
    scale: 'log10',
    inputScale: 'linear'
  }
}

describe('subsetStandardize', () => {
  it('passes the dataset through untouched when nothing is filtered', () => {
    const d = std()
    expect(subsetStandardize(d, {})).toBe(d)
    expect(subsetStandardize(d, { cmpd: [] })).toBe(d)
  })

  it('keeps rows and samples matching every filtered condition', () => {
    const out = subsetStandardize(std(), { cmpd: ['A', 'DMSO'], dose: ['10'] })
    expect(out.samples!.map((s) => s.sample)).toEqual(['s3'])
    expect(out.rows).toHaveLength(2)
    expect(out.compounds).toEqual(['A'])
  })

  it('matches numeric values as strings and custom conditions by value', () => {
    expect(subsetStandardize(std(), { dose: ['1'] }).samples!.map((s) => s.sample)).toEqual([
      's2',
      's5'
    ])
    expect(subsetStandardize(std(), { '@geno': ['ko'] }).samples!.map((s) => s.sample)).toEqual([
      's3',
      's4'
    ])
  })

  it('can keep the samples a condition does not apply to', () => {
    expect(subsetStandardize(std(), { '@geno': [''] }).samples!.map((s) => s.sample)).toEqual([
      's5'
    ])
  })

  it('drops a condition no kept sample carries, and presents on the run scale', () => {
    const out = subsetStandardize(std(), { '@geno': [''] })
    expect(out.activeConditions).toEqual(['cmpd', 'dose'])
    expect(out.inputScale).toBeUndefined()
    expect(out.scale).toBe('log10')
  })

  it('keptBy agrees with the subset', () => {
    const pass = keptBy({ cmpd: ['B2'] })
    expect(SAMPLES.filter(pass).map((s) => s.sample)).toEqual(['s5'])
  })
})

describe('conditionLevels', () => {
  it('lists each active condition’s values: numbers ascending, names naturally, none last', () => {
    const lv = conditionLevels(std())
    expect(lv.dose).toEqual(['0', '1', '10'])
    expect(lv.cmpd).toEqual(['A', 'B2', 'B10', 'DMSO'])
    expect(lv['@geno']).toEqual(['ko', 'wt', ''])
    expect(lv.cell).toBeUndefined()
  })
})

describe('subset wiring', () => {
  const node = (id: string, kind: NodeKind): GraphNode =>
    ({
      id,
      type: 'step',
      position: { x: 0, y: 0 },
      data: { kind, category: 'processing', status: 'idle', config: {} }
    }) as unknown as GraphNode

  it('goes wherever Clean data goes, and takes Clean data or a Merge in', () => {
    for (const k of ALL_OPS) expect(canConnect('subset', k)).toBe(canConnect('standardize', k))
    expect(canConnect('standardize', 'subset')).toBe(true)
    expect(canConnect('merge', 'subset')).toBe(true)
    expect(canConnect('subset', 'subset')).toBe(true)
    expect(canConnect('compare', 'subset')).toBe(false)
    expect(maxInputsFor('subset')).toBe(1)
    expect(NODE_SPECS.subset.category).toBe('processing')
  })

  it('roots its own group, so its plots are not shown as the full dataset’s', () => {
    const nodes = [node('s', 'standardize'), node('x', 'subset'), node('p', 'pca')]
    const edges = [
      { id: 'e1', source: 's', target: 'x' },
      { id: 'e2', source: 'x', target: 'p' }
    ]
    const groups = deriveGroups(nodes, edges as never)
    expect(groups.find((g) => g.rootId === 'x')?.memberIds).toEqual(['x', 'p'])
    expect(groups.find((g) => g.rootId === 's')?.memberIds).toEqual(['s'])
  })
})
