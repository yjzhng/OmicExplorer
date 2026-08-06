import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import { resolveChildFocus, resolveFocus } from './focus'
import type { FocusConfig, NodeConfig, NodeKind, PlotChild, StepNode } from './types'

function step(id: string, kind: NodeKind, config: NodeConfig): StepNode {
  return { id, type: 'step', position: { x: 0, y: 0 }, data: { kind, config, status: 'idle' } }
}
function edge(source: string, target: string): Edge {
  return { id: `e-${source}-${target}`, source, target }
}
const focus = (
  mode: FocusConfig['mode'],
  goi: string[] = [],
  panel: string[] = []
): FocusConfig => ({
  mode,
  goi,
  panel
})

// standardize (master goi=[g1], panel=[g2]) → compare-6 → group tile with subcards
const NODES = [
  step('standardize-2', 'standardize', {
    activeConditions: null,
    goi: ['g1'],
    panel: ['g2']
  } as NodeConfig),
  step('compare-6', 'compare', {} as NodeConfig),
  step('plotGroup-9', 'plotGroup', { children: [] } as NodeConfig)
]
const EDGES = [edge('standardize-2', 'compare-6'), edge('compare-6', 'plotGroup-9')]

const child = (f: FocusConfig): PlotChild => ({
  id: 'sub-1',
  kind: 'volcano',
  config: { focus: f }
})

describe('resolveChildFocus', () => {
  it('inherits the Standardize ancestor via the GROUP edge (child has no edge)', () => {
    expect(resolveChildFocus(child(focus('inherit')), 'plotGroup-9', NODES, EDGES)).toEqual({
      goi: ['g1'],
      panel: ['g2']
    })
  })

  it('custom uses the subcard’s own sets, ignoring the ancestor', () => {
    expect(
      resolveChildFocus(child(focus('custom', ['x'], ['y'])), 'plotGroup-9', NODES, EDGES)
    ).toEqual({ goi: ['x'], panel: ['y'] })
  })

  it('none resolves to empty', () => {
    expect(resolveChildFocus(child(focus('none')), 'plotGroup-9', NODES, EDGES)).toEqual({
      goi: [],
      panel: []
    })
  })

  it('matches what a standalone plot on the same upstream would inherit', () => {
    // A volcano wired directly off compare-6 with inherit resolves to the same sets.
    const volcano = step('volcano-x', 'volcano', { focus: focus('inherit') } as NodeConfig)
    const nodes = [...NODES, volcano]
    const edges = [...EDGES, edge('compare-6', 'volcano-x')]
    expect(resolveFocus('volcano-x', nodes, edges)).toEqual(
      resolveChildFocus(child(focus('inherit')), 'plotGroup-9', NODES, EDGES)
    )
  })
})
