import { describe, expect, it } from 'vitest'

import { plotTableFiles, plotTableTargets, tileKey } from './plotTables'
import type { NodeConfig, NodeKind } from './types'

const node = (id: string, kind: NodeKind, config: NodeConfig, name?: string) => ({
  id,
  type: 'step',
  data: { kind, config, ...(name ? { name } : {}) }
})
const group = (id: string, kids: Array<{ id: string; kind: NodeKind }>, name?: string) =>
  node(id, 'plotGroup', { children: kids.map((k) => ({ ...k, config: {} })) } as NodeConfig, name)

describe('plotTableTargets', () => {
  it('names each plot after its group tile and plot type', () => {
    const t = plotTableTargets(
      [
        group('g1', [{ id: 's1', kind: 'enrich' }]),
        group('g2', [{ id: 's2', kind: 'string' }], 'Hubs'),
        group('g3', [{ id: 's3', kind: 'volcano' }]) // no table
      ],
      [
        { source: 'cmp', target: 'g1' },
        { source: 'cmp', target: 'g2' },
        { source: 'cmp', target: 'g3' }
      ]
    )
    expect(t.map((x) => [x.key, x.upstreamId, x.stem])).toEqual([
      [tileKey('g1', 's1'), 'cmp', 'Plot_Enrichment'],
      [tileKey('g2', 's2'), 'cmp', 'Hubs_STRING network']
    ])
  })
  it('skips unwired plots and non-step nodes', () => {
    const t = plotTableTargets(
      [group('g1', [{ id: 's1', kind: 'enrich' }]), { ...group('f', []), type: 'frame' }],
      []
    )
    expect(t).toEqual([])
  })
})

describe('plotTableFiles', () => {
  it('gives one file for enrichment, nodes + edges for STRING', () => {
    expect(plotTableFiles('enrich', 'Plot_Enrichment')).toEqual(['Plot_Enrichment.csv'])
    expect(plotTableFiles('string', 'Hubs_STRING network')).toEqual([
      'Hubs_STRING network_nodes.csv',
      'Hubs_STRING network_edges.csv'
    ])
  })
})
