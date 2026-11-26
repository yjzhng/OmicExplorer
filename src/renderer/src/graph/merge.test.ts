/** The Merge tile's wiring contract. Merge emits a Clean-data result, so the interesting property
 *  is substitutability: anywhere a Standardize can go, a Merge can go — without every tile's
 *  `acceptsFrom` having to name it. */
import { describe, expect, it } from 'vitest'

import type { Edge } from '@xyflow/react'

import { combineStandardize, customCond, presentScaleOf, withLogTransform } from '../engine'
import type { StandardizeResult, StandardRow } from '../engine'
import {
  ALL_OPS,
  acceptsFromOf,
  axisAvailFor,
  canConnect,
  maxInputsFor,
  outputKindOf,
  type AxisGraph
} from './registry'
import { deriveGroups } from './groups'
import { restampScales } from './resultScales'
import type { GraphNode, NodeKind, NodeResult } from './types'

const node = (id: string, kind: NodeKind): GraphNode =>
  ({
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    data: { kind, category: 'processing', status: 'idle', config: {} }
  }) as unknown as GraphNode

describe('merge wiring', () => {
  it('a Merge is accepted wherever Clean data is', () => {
    const takesStd = ALL_OPS.filter((k) => acceptsFromOf(k).includes('standardize'))
    expect(takesStd.length).toBeGreaterThan(5)
    for (const k of takesStd) expect(canConnect('merge', k)).toBe(true)
  })

  it('and is rejected wherever Clean data is', () => {
    for (const k of ALL_OPS)
      if (!acceptsFromOf(k).includes('standardize'))
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
    expect(outputKindOf('subset')).toBe('standardize')
    for (const k of ALL_OPS) if (k !== 'merge' && k !== 'subset') expect(outputKindOf(k)).toBe(k)
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
    expect(axisAvailFor(g, 'm')).toEqual(['dose', 'time'])
    // Edge order must not matter either.
    expect(axisAvailFor({ ...g, edges: [...g.edges].reverse() }, 'm')).toEqual(['dose', 'time'])
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

  it("numbers a later input's replicates past an earlier one's, so no two are one sample", () => {
    const r = (uniqID: string, cmpd: string, rep: number | null): StandardRow =>
      ({ uniqID, cmpd, rep, value: 1 }) as unknown as StandardRow
    const s = (cmpd: string, rep: number | null) => ({ sample: `${cmpd}${rep}`, cmpd, rep })
    const a = std([r('P1', 'x', 1), r('P1', 'x', 2), r('P1', 'y', 1)], {
      samples: [s('x', 1), s('x', 2), s('y', 1)] as StandardizeResult['samples']
    })
    // x clashes (r1, r2 taken) → r3, r4 in order; z is new → as it was
    const b = std([r('P1', 'x', 2), r('P1', 'x', 1), r('P2', 'x', 1), r('P1', 'z', 1)], {
      samples: [s('x', 2), s('x', 1), s('z', 1)] as StandardizeResult['samples']
    })
    const m = combineStandardize([a, b])
    expect(m.rows.map((x) => `${x.cmpd}${x.rep}`)).toEqual([
      'x1',
      'x2',
      'y1',
      'x4',
      'x3',
      'x3',
      'z1'
    ])
    expect(m.samples!.map((x) => `${x.cmpd}${x.rep}`)).toEqual(['x1', 'x2', 'y1', 'x4', 'x3', 'z1'])
    // the first input's rows, and a row left as it was, are the same objects
    expect(m.rows[0]).toBe(a.rows[0])
    expect(m.rows[6]).toBe(b.rows[3])
    // a third input moves past both
    expect(combineStandardize([a, b, std([r('P1', 'x', 1)])]).rows.at(-1)!.rep).toBe(5)
    // no replicate in either: the second becomes r2 (a missing one counting as 1)
    const n = combineStandardize([std([r('P1', 'w', null)]), std([r('P1', 'w', null)])])
    expect(n.rows.map((x) => x.rep)).toEqual([null, 2])
  })

  it('leaves inputs whose samples are already distinct untouched', () => {
    const a = std([row('P1', 'A1', 1)], { activeConditions: ['cmpd'], compounds: ['x'] })
    const b = std([{ ...row('P1', 'B1', 2), rep: 2 } as StandardRow])
    const m = combineStandardize([{ ...a, rows: [{ ...a.rows[0], rep: 1 }] }, b])
    expect(m.rows[1]).toBe(b.rows[0])
  })

  it("carries the scale its first input is presented on — re-stamped when that's flipped", () => {
    // run with no transform (scale linear), then switched to log₁₀ — the result isn't re-run, only
    // re-stamped; the Merge below re-runs on it
    const a = std([row('P1', 'A1', 1)], { scale: 'linear', inputScale: 'linear' })
    const b = std([row('P1', 'B1', 2)], { scale: 'linear', inputScale: 'linear' })
    expect(presentScaleOf(combineStandardize([a, b]))).toBe('linear')
    const flipped = withLogTransform(a, 'log10')
    expect(flipped.rows).toBe(a.rows)
    expect(presentScaleOf(combineStandardize([flipped, b]))).toBe('log10')
    expect(withLogTransform(flipped, 'log10')).toBe(flipped)
  })
})

describe("a Merge's scale, on a workflow opened from before results carried it", () => {
  const edge = (source: string, target: string): Edge => ({
    id: `${source}-${target}`,
    source,
    target
  })
  const stdNode = (id: string, logTransform?: 'none' | 'log2' | 'log10'): GraphNode =>
    ({
      ...node(id, 'standardize'),
      data: { ...node(id, 'standardize').data, config: { logTransform } }
    }) as GraphNode
  const clean = (scale: 'linear' | 'log10'): NodeResult => ({
    kind: 'standardize',
    std: { rows: [], scale, inputScale: 'linear' } as unknown as StandardizeResult
  })
  // std1 ran unlogged and was switched to log₁₀ after; the Merge and Subset hold its run's scale
  const nodes = [
    stdNode('std1', 'log10'),
    stdNode('std2'),
    node('merge', 'merge'),
    node('sub', 'subset')
  ]
  const edges = [edge('std1', 'merge'), edge('std2', 'merge'), edge('merge', 'sub')]

  it("re-stamps each from what the graph says: Clean data's choice, a Merge's first input", () => {
    const results = {
      sub: clean('linear'),
      merge: clean('linear'),
      std1: clean('linear'),
      std2: clean('linear')
    }
    const out = restampScales(nodes, edges, results)
    const scale = (k: string): unknown => (out[k] as { std: StandardizeResult }).std.scale
    expect(['std1', 'std2', 'merge', 'sub'].map(scale)).toEqual([
      'log10',
      'linear',
      'log10',
      'log10'
    ])
    // the one already right is the same object
    expect(out.std2).toBe(results.std2)
  })

  it('leaves results already in line as they were', () => {
    const results = { std1: clean('log10'), std2: clean('linear'), merge: clean('log10') }
    expect(restampScales(nodes, edges, results)).toBe(results)
  })

  it("carries Clean data's display choice down a Merge and a Subset too", () => {
    const shown = nodes.map((n) =>
      n.id === 'std1'
        ? ({
            ...n,
            data: { ...n.data, config: { logTransform: 'log10', logDisplay: 'plain' } }
          } as GraphNode)
        : n
    )
    const results = {
      sub: clean('log10'),
      merge: clean('log10'),
      std1: clean('log10'),
      std2: clean('linear')
    }
    const out = restampScales(shown, edges, results)
    const display = (k: string): unknown => (out[k] as { std: StandardizeResult }).std.logDisplay
    expect(['std1', 'merge', 'sub'].map(display)).toEqual(['plain', 'plain', 'plain'])
    expect(display('std2')).toBeUndefined()
  })
})
