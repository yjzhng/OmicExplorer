import { readFileSync } from 'node:fs'
import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import { deserializeWorkflow, serializeWorkflow } from './workflowDoc'
import type { GraphNode, NodeKind, PanelLayoutItem } from './types'

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
const EDGES = [edge('standardize-1', 'heatmap-2')]
const LAYOUT: Record<string, PanelLayoutItem[]> = {
  'standardize-1': [
    { i: 'standardize-1', x: 0, y: 0, w: 6, h: 8 },
    { i: 'heatmap-2', x: 6, y: 0, w: 6, h: 8 }
  ]
}

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
    expect(doc.version).toBe(3)
    const back = deserializeWorkflow(json)
    expect(back.groupLayouts).toEqual(LAYOUT)
    expect(back.groupMeta).toEqual(meta)
    expect(back.nodes.map((n) => n.id)).toEqual(['standardize-1', 'heatmap-2'])
  })

  it('scales a pre-v3 layout ×2 onto the doubled grid', () => {
    const v2 = JSON.stringify({
      version: 2,
      nextId: 3,
      nodes: NODES.map((n) => ({ id: n.id, position: n.position, data: n.data })),
      edges: EDGES,
      groupLayouts: LAYOUT
    })
    const back = deserializeWorkflow(v2)
    expect(back.groupLayouts['standardize-1']).toEqual([
      { i: 'standardize-1', x: 0, y: 0, w: 12, h: 16 },
      { i: 'heatmap-2', x: 12, y: 0, w: 12, h: 16 }
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
    const proj = JSON.parse(readFileSync('example_project/example.omicexplorer', 'utf8'))
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
