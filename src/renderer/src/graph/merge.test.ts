/** The Merge tile's wiring contract. Merge emits a Clean-data result, so the interesting property
 *  is substitutability: anywhere a Standardize can go, a Merge can go — without every tile's
 *  `acceptsFrom` having to name it. */
import { describe, expect, it } from 'vitest'

import { combineStandardize, customCond } from '../engine'
import type { StandardizeResult, StandardRow } from '../engine'
import {
  ALL_OPS,
  NODE_SPECS,
  axisAvailFor,
  canConnect,
  maxInputsFor,
  outputKindOf,
  type AxisGraph
} from './registry'
import { deriveGroups } from './groups'
import type { GraphNode, NodeKind } from './types'

const node = (id: string, kind: NodeKind): GraphNode =>
  ({
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    data: { kind, category: 'processing', status: 'idle', config: {} }
  }) as unknown as GraphNode

describe('merge wiring', () => {
  it('a Merge is accepted wherever Clean data is', () => {
    const takesStd = ALL_OPS.filter((k) => NODE_SPECS[k].acceptsFrom.includes('standardize'))
    expect(takesStd.length).toBeGreaterThan(5)
    for (const k of takesStd) expect(canConnect('merge', k)).toBe(true)
  })

  it('and is rejected wherever Clean data is', () => {
    for (const k of ALL_OPS)
      if (!NODE_SPECS[k].acceptsFrom.includes('standardize'))
        expect(canConnect('merge', k)).toBe(canConnect('standardize', k))
  })

  it('takes Clean data in, and chains off another Merge', () => {
    expect(canConnect('standardize', 'merge')).toBe(true)
    expect(canConnect('merge', 'merge')).toBe(true)
    expect(canConnect('load', 'merge')).toBe(false)
    expect(canConnect('compare', 'merge')).toBe(false)
  })

  it('accepts any number of inputs', () => {
    expect(maxInputsFor('merge')).toBe(Infinity)
    expect(maxInputsFor('compare')).toBe(2)
    expect(maxInputsFor('pca')).toBe(1)
  })

  it('reports Clean data as its output kind; other ops are their own', () => {
    expect(outputKindOf('merge')).toBe('standardize')
    for (const k of ALL_OPS) if (k !== 'merge') expect(outputKindOf(k)).toBe(k)
  })

  it('roots its own analysis group, so its plots are not absorbed upstream', () => {
    const nodes = [
      node('s1', 'standardize'),
      node('s2', 'standardize'),
      node('m', 'merge'),
      node('p', 'pca')
    ]
    const edges = [
      { id: 'e1', source: 's1', target: 'm' },
      { id: 'e2', source: 's2', target: 'm' },
      { id: 'e3', source: 'm', target: 'p' }
    ]
    const groups = deriveGroups(nodes, edges as never)
    const merged = groups.find((g) => g.rootId === 'm')
    expect(merged?.memberIds).toEqual(['m', 'p'])
    // …and the PCA belongs to the merge, not to either input dataset.
    for (const g of groups.filter((x) => x.rootId !== 'm')) expect(g.memberIds).not.toContain('p')
    // A merge group behaves as Clean data downstream.
    expect(merged?.kind).toBe('standardize')
  })

  it('unions response axes across its inputs when it has not run yet', () => {
    const withConds = (id: string, conds: string[]): GraphNode => {
      const n = node(id, 'standardize')
      return { ...n, data: { ...n.data, config: { activeConditions: conds } } } as GraphNode
    }
    // Each input declares a DIFFERENT axis, so only a walk that branches can report both — any
    // single-edge walk returns one axis, whichever edge it happens to follow.
    const g: AxisGraph = {
      nodes: [withConds('s1', ['dose']), withConds('s2', ['time']), node('m', 'merge')],
      edges: [
        { source: 's1', target: 'm' },
        { source: 's2', target: 'm' }
      ],
      results: {}
    }
    expect(axisAvailFor(g, 'm')).toEqual({ dose: true, time: true })
    // Edge order must not matter either.
    expect(axisAvailFor({ ...g, edges: [...g.edges].reverse() }, 'm')).toEqual({
      dose: true,
      time: true
    })
  })
})

describe('merge semantics', () => {
  const row = (uniqID: string, sample: string, value: number): StandardRow =>
    ({ uniqID, sample, value, cmpd: 'x' }) as unknown as StandardRow
  const std = (rows: StandardRow[], over: Partial<StandardizeResult> = {}): StandardizeResult =>
    ({
      rows,
      displayMap: {},
      annotationMap: {},
      keggCategories: {},
      activeConditions: ['cmpd'],
      compounds: ['x'],
      cleanup: { droppedGenes: 0, sampleCount: rows.length, minSamplePct: 0 },
      ...over
    }) as StandardizeResult

  it('concatenates rows so a gene in either input survives', () => {
    const a = std([row('P1', 'A1', 1), row('P2', 'A1', 2)])
    const b = std([row('P2', 'B1', 3), row('P3', 'B1', 4)])
    const m = combineStandardize([a, b])
    expect(m.rows).toHaveLength(4)
    expect(new Set(m.rows.map((r) => r.uniqID))).toEqual(new Set(['P1', 'P2', 'P3']))
  })

  it('unions conditions and compounds rather than taking the first input', () => {
    const a = std([row('P1', 'A1', 1)], { activeConditions: ['cmpd'], compounds: ['x'] })
    const b = std([row('P1', 'B1', 2)], { activeConditions: ['dose'], compounds: ['y'] })
    const m = combineStandardize([a, b])
    expect(m.activeConditions).toContain('cmpd')
    expect(m.activeConditions).toContain('dose')
    expect(new Set(m.compounds)).toEqual(new Set(['x', 'y']))
  })

  it('keeps CUSTOM conditions in the union, not just the presets', () => {
    // The union was filtered through VALID_CONDITIONS, which lists only cell/cmpd/dose/time — so
    // every `@slug` condition was dropped. runCompare derives its context dims from
    // activeConditions, so the custom axis then disappeared from the merged data's plots and the
    // results switcher.
    const a = std([row('P1', 'A1', 1)], { activeConditions: ['cmpd', customCond('medium')] })
    const b = std([row('P1', 'B1', 2)], { activeConditions: ['dose', customCond('batch')] })
    const m = combineStandardize([a, b])
    expect(m.activeConditions).toContain(customCond('medium'))
    expect(m.activeConditions).toContain(customCond('batch'))
    // Canonical order: presets by hierarchy first, then customs alphabetically.
    expect(m.activeConditions).toEqual(['cmpd', 'dose', customCond('batch'), customCond('medium')])
  })

  it('passes a single input straight through, by reference', () => {
    const a = std([row('P1', 'A1', 1)])
    expect(combineStandardize([a])).toBe(a)
  })
})
