import { describe, expect, it } from 'vitest'

import { axisAvailFor, type AxisGraph } from './registry'
import type { GraphNode, NodeResult } from './types'

const step = (id: string, kind: string, config: Record<string, unknown> = {}): GraphNode =>
  ({
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    data: { kind, config, status: 'idle' }
  }) as GraphNode

const stdResult = (conds: string[]): NodeResult =>
  ({
    kind: 'standardize',
    std: { rows: [], displayMap: {}, activeConditions: conds }
  }) as NodeResult

describe('axisAvailFor (response-axis gating through stale upstreams)', () => {
  const chain: AxisGraph['edges'] = [
    { source: 'std-1', target: 'cmp-1' },
    { source: 'cmp-1', target: 'grp-1' }
  ]

  it('unwired ⇒ both axes (nothing to rule out)', () => {
    expect(axisAvailFor({ nodes: [], edges: [], results: {} }, undefined)).toEqual({
      dose: true,
      time: true
    })
  })

  it('uses the direct upstream result when it exists', () => {
    const g: AxisGraph = {
      nodes: [step('std-1', 'standardize'), step('cmp-1', 'compare')],
      edges: chain,
      results: { 'std-1': stdResult(['cmpd', 'dose']) }
    }
    // cmp-1 has no result (stale) → falls back to std-1's result
    expect(axisAvailFor(g, 'cmp-1')).toEqual({ dose: true, time: false })
  })

  it('falls back to the Clean data tile’s declared conditions when nothing has run', () => {
    const g: AxisGraph = {
      nodes: [
        step('std-1', 'standardize', { activeConditions: ['cmpd', 'time'] }),
        step('cmp-1', 'compare')
      ],
      edges: chain,
      results: {}
    }
    expect(axisAvailFor(g, 'cmp-1')).toEqual({ dose: false, time: true })
  })

  it('offers neither axis when the upstream is stale and conditions are auto-detect', () => {
    const g: AxisGraph = {
      nodes: [step('std-1', 'standardize', { activeConditions: null }), step('cmp-1', 'compare')],
      edges: chain,
      results: {}
    }
    expect(axisAvailFor(g, 'cmp-1')).toEqual({ dose: false, time: false })
  })
})
