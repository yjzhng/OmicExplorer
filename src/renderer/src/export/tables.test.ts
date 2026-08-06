import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import { collectTableExports } from './tables'
import type { GraphNode, NodeKind, NodeResult } from '../graph/types'

function step(id: string, kind: NodeKind, config: object = {}): GraphNode {
  return {
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    data: { kind, config: config as never, status: 'idle' }
  }
}
const edge = (source: string, target: string): Edge => ({
  id: `e-${source}-${target}`,
  source,
  target
})

const nodes = [
  step('load-1', 'load'),
  step('std-2', 'standardize'),
  step('cmp-3', 'compare', { analysis: 'ttest' })
]
const edges = [edge('load-1', 'std-2'), edge('std-2', 'cmp-3')]
const results: Record<string, NodeResult> = {
  'std-2': {
    kind: 'standardize',
    std: {
      rows: [
        { uniqID: 'g1', strain: 'WT', cmpd: 'A', dose: 5, time: null, rep: 1, value: 3.14 },
        { uniqID: 'g2', strain: 'WT', cmpd: 'A', dose: 5, time: null, rep: 2, value: 2.71 }
      ],
      displayMap: { g1: 'argF', g2: 'arcA' },
      activeConditions: [],
      compounds: ['A']
    }
  } as unknown as NodeResult,
  'cmp-3': {
    kind: 'compare',
    displayMap: { g1: 'argF' },
    cmp: {
      rows: [
        {
          uniqID: 'g1',
          cmpd: 'A',
          dose: 5,
          time: null,
          comparison: 'A | Veh',
          log2FC: -0.5,
          pP: 0.02,
          pQ: 0.1,
          signf: true,
          effect: 'down'
        }
      ],
      comparisons: ['A | Veh']
    }
  } as unknown as NodeResult
}

describe('collectTableExports', () => {
  it('builds one table per analysis root that has run, with shown columns', () => {
    const tables = collectTableExports(nodes, edges, results)
    expect(tables.map((t) => t.key)).toEqual(['std-2', 'cmp-3'])

    const std = tables[0]
    expect(std.label).toBe('Standardized')
    // strain present → kept; standardized columns are fixed (time stays even when blank).
    expect(std.columns).toEqual([
      'uniqID',
      'gene',
      'strain',
      'cmpd',
      'dose',
      'time',
      'rep',
      'value'
    ])
    expect(std.rows[0]).toEqual(['g1', 'argF', 'WT', 'A', 5, null, 1, 3.14])

    const cmp = tables[1]
    expect(cmp.analysis).toBe('A | Veh')
    // single comparison → no 'comparison' column; boolean signf → 'true'.
    expect(cmp.columns).toContain('log2FC')
    expect(cmp.columns).not.toContain('comparison')
    const signfIdx = cmp.columns.indexOf('signf')
    expect(cmp.rows[0][signfIdx]).toBe('true')
  })

  it('labels a two-way comparison log2FC column as "interaction"', () => {
    const twoWay = [step('load-1', 'load'), step('cmp-9', 'compare', { analysis: 'two_way_anova' })]
    const twoEdges = [edge('load-1', 'cmp-9')]
    const twoResults: Record<string, NodeResult> = {
      'cmp-9': {
        kind: 'compare',
        displayMap: {},
        cmp: {
          rows: [
            { uniqID: 'g1', comparison: 'X', log2FC: 1, pP: 0, pQ: 0, signf: false, effect: 'up' }
          ],
          comparisons: ['X']
        }
      } as unknown as NodeResult
    }
    const t = collectTableExports(twoWay, twoEdges, twoResults)[0]
    expect(t.columns).toContain('interaction')
    expect(t.columns).not.toContain('log2FC')
  })

  it('honours the selection filter and skips un-run roots', () => {
    expect(
      collectTableExports(nodes, edges, results, new Set(['cmp-3'])).map((t) => t.key)
    ).toEqual(['cmp-3'])
    // std-2 present in the graph but has no result → excluded.
    expect(
      collectTableExports(nodes, edges, { 'cmp-3': results['cmp-3'] }).map((t) => t.key)
    ).toEqual(['cmp-3'])
  })
})
