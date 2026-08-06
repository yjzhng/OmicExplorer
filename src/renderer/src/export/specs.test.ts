import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import { collectSpecs, type ExportSpec } from './specs'
import type { GraphNode, NodeKind, NodeResult, PlotChild } from '../graph/types'

function step(id: string, kind: NodeKind): GraphNode {
  return {
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    data: { kind, config: {} as never, status: 'idle' }
  }
}
function groupNode(id: string, children: PlotChild[]): GraphNode {
  return {
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    data: { kind: 'plotGroup', config: { children }, status: 'idle' }
  }
}
function edge(source: string, target: string): Edge {
  return { id: `e-${source}-${target}`, source, target }
}
const child = (id: string, kind: NodeKind): PlotChild => ({ id, kind, config: {} as never })

describe('collectSpecs', () => {
  // load → standardize → { volcano node, group[heatmap, geneBar] } ; compare not present.
  const nodes = [
    step('load-1', 'load'),
    step('std-2', 'standardize'),
    step('volcano-3', 'volcano'),
    groupNode('grp-4', [child('c1', 'heatmap'), child('c2', 'geneBar')])
  ]
  const edges = [edge('load-1', 'std-2'), edge('std-2', 'volcano-3'), edge('std-2', 'grp-4')]

  it('enumerates standalone plots and expands group subcards; skips tables/load', () => {
    const specs = collectSpecs(nodes, edges, {})
    const keys = specs.map((s) => s.key).sort()
    // volcano node + two group children; the load and standardize (tables) are excluded.
    expect(keys).toEqual(['grp-4_c1', 'grp-4_c2', 'volcano-3'])
    // A group child carries the group node (for its shared upstream) plus its own child.
    const heat = specs.find((s) => s.key === 'grp-4_c1') as ExportSpec
    expect(heat.node.id).toBe('grp-4')
    expect(heat.child?.kind).toBe('heatmap')
    expect(heat.plot).toBe('Heatmap') // NODE_SPECS.heatmap.label
  })

  it('labels the analysis from the comparison names when a result is present', () => {
    const results: Record<string, NodeResult> = {
      // standardize result → falls back to the group label; give a compare instead:
    }
    // Rewire volcano under a compare to exercise the comparison-name label.
    const cmpNodes = [
      step('load-1', 'load'),
      step('cmp-9', 'compare'),
      step('volcano-3', 'volcano')
    ]
    const cmpEdges = [edge('load-1', 'cmp-9'), edge('cmp-9', 'volcano-3')]
    const cmpResults: Record<string, NodeResult> = {
      'cmp-9': {
        kind: 'compare',
        displayMap: {},
        cmp: { rows: [], comparisons: ['DrugA_vs_Veh'] }
      } as unknown as NodeResult
    }
    void results
    const specs = collectSpecs(cmpNodes, cmpEdges, cmpResults)
    expect(specs[0].analysis).toBe('DrugA_vs_Veh')
  })

  it('honours the selection filter (a selected group contributes all its children)', () => {
    const specs = collectSpecs(nodes, edges, {}, new Set(['grp-4']))
    expect(specs.map((s) => s.key).sort()).toEqual(['grp-4_c1', 'grp-4_c2'])
  })

  it('tags each spec with its analysis root and no GOI when there are no focus genes', () => {
    const specs = collectSpecs(nodes, edges, {})
    expect(specs.every((s) => s.rootId === 'std-2')).toBe(true)
    expect(specs.every((s) => s.hasGoi === false)).toBe(true)
  })
})
