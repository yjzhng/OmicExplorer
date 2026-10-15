import { readFileSync } from 'node:fs'
import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import { childPanelId } from './groups'
import { deserializeWorkflow, serializeWorkflow } from './workflowDoc'
import type { GraphNode, NodeKind, PanelLayoutItem, PlotGroupConfig } from './types'

function step(id: string, kind: NodeKind): GraphNode {
  return {
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    data: { kind, config: {} as never, status: 'idle' }
  }
}
const edge = (source: string, target: string): Edge => ({
  id: `e-${source}-${target}`,
  source,
  target
})

const NODES: GraphNode[] = [step('standardize-1', 'standardize'), step('heatmap-2', 'heatmap')]
// The lone heatmap loads as a plot group of one (every visualisation tile is a group), its subcard
// minted from nextId (3) — so its results tile's panel id moves to the subcard's.
const HEAT_PANEL = childPanelId('heatmap-2', 'sub-3')
const EDGES = [edge('standardize-1', 'heatmap-2')]
const LAYOUT: Record<string, PanelLayoutItem[]> = {
  'standardize-1': [
    { i: 'standardize-1', x: 0, y: 0, w: 6, h: 8 },
    { i: 'heatmap-2', x: 6, y: 0, w: 6, h: 8 }
  ]
}

describe('lone plots load as plot groups', () => {
  it('wraps a lone plot in a group of one, keeping its id, name and settings', () => {
    const heat = step('heatmap-2', 'heatmap')
    if (heat.type === 'step')
      heat.data = { ...heat.data, name: 'my heat', config: { topN: 50 } as never }
    const back = deserializeWorkflow(
      serializeWorkflow({
        nodes: [NODES[0], heat],
        edges: EDGES,
        nextId: 3,
        groupLayouts: {},
        groupMeta: {}
      })
    )
    const g = back.nodes.find((n) => n.id === 'heatmap-2')!
    expect(g.type === 'step' && g.data.kind).toBe('plotGroup')
    expect(g.type === 'step' && g.data.name).toBe('my heat')
    const kids = g.type === 'step' ? (g.data.config as PlotGroupConfig).children : []
    expect(kids).toEqual([{ id: 'sub-3', kind: 'heatmap', config: { topN: 50 } }])
    expect(back.nextId).toBe(4)
    // the wiring is untouched
    expect(back.edges).toEqual(EDGES)
  })
})

describe('workflow v2 serialization', () => {
  it('round-trips group layouts and meta', () => {
    const meta = { 'standardize-1': { label: 'QC', hidden: false } }
    const json = serializeWorkflow({
      nodes: NODES,
      edges: EDGES,
      nextId: 3,
      groupLayouts: LAYOUT,
      groupMeta: meta
    })
    const doc = JSON.parse(json)
    expect(doc.version).toBe(4)
    const back = deserializeWorkflow(json)
    expect(back.groupLayouts).toEqual({
      'standardize-1': [
        LAYOUT['standardize-1'][0],
        { ...LAYOUT['standardize-1'][1], i: HEAT_PANEL }
      ]
    })
    expect(back.groupMeta).toEqual(meta)
    expect(back.nodes.map((n) => n.id)).toEqual(['standardize-1', 'heatmap-2'])
  })

  it('scales a pre-v3 layout onto the current grid (×4 columns, ×2 rows)', () => {
    const v2 = JSON.stringify({
      version: 2,
      nextId: 3,
      nodes: NODES.map((n) => ({ id: n.id, position: n.position, data: n.data })),
      edges: EDGES,
      groupLayouts: LAYOUT
    })
    const back = deserializeWorkflow(v2)
    // v2→v3 doubled both axes, v3→v4 doubled columns again: x,w ×4; y,h ×2.
    expect(back.groupLayouts['standardize-1']).toEqual([
      { i: 'standardize-1', x: 0, y: 0, w: 24, h: 16 },
      { i: HEAT_PANEL, x: 24, y: 0, w: 24, h: 16 }
    ])
  })

  it('scales a v3 layout by ×2 columns only onto the denser v4 grid', () => {
    const v3 = JSON.stringify({
      version: 3,
      nextId: 3,
      nodes: NODES.map((n) => ({ id: n.id, position: n.position, data: n.data })),
      edges: EDGES,
      groupLayouts: {
        'standardize-1': [
          { i: 'standardize-1', x: 0, y: 4, w: 12, h: 8 },
          { i: 'heatmap-2', x: 12, y: 4, w: 12, h: 8 }
        ]
      }
    })
    const back = deserializeWorkflow(v3)
    // Columns ×2 (x, w); rows unchanged (y, h).
    expect(back.groupLayouts['standardize-1']).toEqual([
      { i: 'standardize-1', x: 0, y: 4, w: 24, h: 8 },
      { i: HEAT_PANEL, x: 24, y: 4, w: 24, h: 8 }
    ])
  })

  it('omits empty layout/meta maps so the doc stays v1-clean', () => {
    const json = serializeWorkflow({
      nodes: NODES,
      edges: EDGES,
      nextId: 3,
      groupLayouts: {},
      groupMeta: {}
    })
    const doc = JSON.parse(json)
    expect('groupLayouts' in doc).toBe(false)
    expect('groupMeta' in doc).toBe(false)
  })

  it('prunes layouts/meta whose root node no longer exists', () => {
    const json = serializeWorkflow({
      nodes: NODES,
      edges: EDGES,
      nextId: 3,
      groupLayouts: { ...LAYOUT, 'ghost-9': [{ i: 'ghost-9', x: 0, y: 0, w: 6, h: 8 }] },
      groupMeta: { 'ghost-9': { hidden: true } }
    })
    const doc = JSON.parse(json)
    expect(Object.keys(doc.groupLayouts)).toEqual(['standardize-1'])
    expect('groupMeta' in doc).toBe(false)
  })

  it('reads a v1 doc (no version, no layout) with empty layout maps', () => {
    const v1 = JSON.stringify({
      nextId: 3,
      nodes: [
        {
          id: 'standardize-1',
          type: 'step',
          position: { x: 0, y: 0 },
          data: { kind: 'standardize', config: {} }
        }
      ],
      edges: []
    })
    const back = deserializeWorkflow(v1)
    expect(back.groupLayouts).toEqual({})
    expect(back.groupMeta).toEqual({})
    expect(back.nodes[0].data.kind).toBe('standardize')
  })

  it('still loads the legacy demo.json shape (type:data, data.category)', () => {
    const legacy = JSON.stringify({
      version: 1,
      nextId: 2,
      nodes: [
        {
          id: 'load-1',
          type: 'data',
          position: { x: 0, y: 0 },
          data: { category: 'data', kind: 'load', config: {} }
        }
      ],
      edges: []
    })
    const back = deserializeWorkflow(legacy)
    expect(back.nodes[0].type).toBe('step')
    expect(back.nodes[0].data.kind).toBe('load')
    expect(back.groupLayouts).toEqual({})
  })

  it('parses the workflow docs embedded in the example project', () => {
    // Use the committed synthetic project (real-data projects are gitignored).
    const proj = JSON.parse(readFileSync('test_examples/dummy_data/example.omicexplorer', 'utf8'))
    const docs = proj.folders.flatMap((f: { workflows: { doc: unknown }[] }) =>
      f.workflows.map((w) => w.doc)
    )
    expect(docs.length).toBeGreaterThanOrEqual(1)
    for (const doc of docs) {
      const back = deserializeWorkflow(JSON.stringify(doc))
      expect(back.nodes.length).toBeGreaterThan(0)
      expect(back.nodes.every((n) => n.type === 'step')).toBe(true)
    }
  })
})

describe('Curve fit migration', () => {
  it('opens a Compare saved in curve-fit mode as a Curve fit tile, keeping id, config and wiring', () => {
    const cmp = (id: string, analysis: string): GraphNode => ({
      id,
      type: 'step',
      position: { x: 0, y: 0 },
      data: {
        kind: 'compare',
        config: { analysis, num: { cmpd: ['A'] }, den: { cmpd: ['DMSO'] }, match: [] } as never,
        status: 'idle',
        name: `my ${analysis}`
      }
    })
    const back = deserializeWorkflow(
      serializeWorkflow({
        nodes: [NODES[0], cmp('compare-2', 'curve_fit'), cmp('compare-3', 'compare')],
        edges: [edge('standardize-1', 'compare-2'), edge('standardize-1', 'compare-3')],
        nextId: 4,
        groupLayouts: {},
        groupMeta: {}
      })
    )
    const byId = Object.fromEntries(back.nodes.map((n) => [n.id, n]))
    const curve = byId['compare-2']
    const plain = byId['compare-3']
    if (curve.type !== 'step' || plain.type !== 'step') throw new Error('not steps')
    expect(curve.data.kind).toBe('curveFit')
    expect(curve.data.name).toBe('my curve_fit')
    expect((curve.data.config as { den: unknown }).den).toEqual({ cmpd: ['DMSO'] })
    expect(plain.data.kind).toBe('compare')
    expect(back.edges.map((e) => e.target).sort()).toEqual(['compare-2', 'compare-3'])
  })
})
