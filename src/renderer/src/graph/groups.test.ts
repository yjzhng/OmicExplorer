import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import { childPanelId, deriveGroups, expandMembers, parsePanelId } from './groups'
import type { GraphNode, NodeKind, PlotChild } from './types'

/** Minimal step node — deriveGroups only reads id + data.kind. */
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

describe('deriveGroups', () => {
  it('roots a group at each compare/contrast/standardize and stops at the next root', () => {
    // Mirrors workflow/test.json's shape.
    const nodes = [
      step('load-1', 'load'),
      step('standardize-2', 'standardize'),
      step('heatmap-4', 'heatmap'),
      step('compare-6', 'compare'),
      step('volcano-11', 'volcano'),
      step('dr-17', 'dr'),
      step('bubble-20', 'bubble'),
      step('step-7', 'compare'),
      step('contrast-15', 'contrast'),
      step('scatter-16', 'scatter')
    ]
    const edges = [
      edge('load-1', 'standardize-2'),
      edge('standardize-2', 'heatmap-4'),
      edge('standardize-2', 'compare-6'),
      edge('standardize-2', 'step-7'),
      edge('compare-6', 'volcano-11'),
      edge('compare-6', 'dr-17'),
      edge('compare-6', 'bubble-20'),
      edge('compare-6', 'contrast-15'),
      edge('step-7', 'contrast-15'),
      edge('contrast-15', 'scatter-16')
    ]

    const groups = deriveGroups(nodes, edges)

    // One group per root, in node order; load is not a root.
    expect(groups.map((g) => g.rootId)).toEqual([
      'standardize-2',
      'compare-6',
      'step-7',
      'contrast-15'
    ])
    expect(groups.map((g) => g.kind)).toEqual(['standardize', 'compare', 'compare', 'contrast'])

    const members = Object.fromEntries(groups.map((g) => [g.rootId, g.memberIds]))
    // standardize keeps its heatmap but stops at the compare roots below it.
    expect(members['standardize-2']).toEqual(['standardize-2', 'heatmap-4'])
    // compare-6 owns its plots but not the downstream contrast.
    expect(members['compare-6']).toEqual(['compare-6', 'volcano-11', 'dr-17', 'bubble-20'])
    expect(members['step-7']).toEqual(['step-7'])
    expect(members['contrast-15']).toEqual(['contrast-15', 'scatter-16'])
  })

  it('puts the root tile first so its table leads the group', () => {
    const nodes = [step('compare-1', 'compare'), step('volcano-2', 'volcano')]
    const groups = deriveGroups(nodes, [edge('compare-1', 'volcano-2')])
    expect(groups[0].memberIds[0]).toBe('compare-1')
  })

  it('ignores placeholder nodes and dangling edges', () => {
    const nodes: GraphNode[] = [
      step('standardize-1', 'standardize'),
      { id: 'ph-1', type: 'placeholder', position: { x: 0, y: 0 }, data: { ops: [] } }
    ]
    const edges = [edge('standardize-1', 'ph-1'), edge('standardize-1', 'ghost-9')]
    const groups = deriveGroups(nodes, edges)
    expect(groups).toHaveLength(1)
    expect(groups[0].memberIds).toEqual(['standardize-1'])
  })

  it('returns no groups for a graph with only a load tile', () => {
    expect(deriveGroups([step('load-1', 'load')], [])).toEqual([])
  })
})

describe('expandMembers (group tiles → dashboard panels)', () => {
  it('expands a plot group into one panel per subcard, drops the processing root, maps others to themselves', () => {
    const nodes = [
      step('compare-6', 'compare'),
      groupNode('plotGroup-9', [
        { id: 'sub-3', kind: 'volcano', config: {} as never },
        { id: 'sub-4', kind: 'ma', config: {} as never }
      ]),
      step('heatmap-4', 'heatmap')
    ]
    // compare-6 (a processing step) produces NO tile — its table lives in a separate Data table node.
    expect(expandMembers(['compare-6', 'plotGroup-9', 'heatmap-4'], nodes)).toEqual([
      'plotGroup-9::sub-3',
      'plotGroup-9::sub-4',
      'heatmap-4'
    ])
  })

  it('drops members whose node is gone (and the processing root)', () => {
    const nodes = [step('compare-6', 'compare'), step('table-2', 'table')]
    expect(expandMembers(['compare-6', 'table-2', 'ghost-1'], nodes)).toEqual(['table-2'])
  })

  it('round-trips panel ids through childPanelId/parsePanelId', () => {
    expect(parsePanelId('heatmap-4')).toEqual({ nodeId: 'heatmap-4' })
    expect(parsePanelId(childPanelId('plotGroup-9', 'sub-3'))).toEqual({
      nodeId: 'plotGroup-9',
      childId: 'sub-3'
    })
  })
})
