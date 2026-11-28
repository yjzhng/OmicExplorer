/** A duplicated plot's results tab keeps the original's tile layout. */
import { describe, expect, it, vi } from 'vitest'

const noop = (): void => {}
vi.stubGlobal('window', {
  api: new Proxy({}, { get: () => () => noop }),
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop })
})
vi.stubGlobal('localStorage', { getItem: () => null, setItem: noop, removeItem: noop })

const { useGraph } = await import('./store')
const { childPanelId } = await import('./results/groups')
import type { GraphNode, PlotGroupConfig } from './types'

describe('duplicating a plot group', () => {
  it('copies its results layout onto the copy and its subcards', () => {
    const group: GraphNode = {
      id: 'plotGroup-1',
      type: 'step',
      position: { x: 0, y: 0 },
      data: {
        kind: 'plotGroup',
        status: 'idle',
        config: {
          children: [
            { id: 'volcano-2', kind: 'volcano', config: {} },
            { id: 'ma-3', kind: 'ma', config: {} }
          ]
        } as unknown as PlotGroupConfig
      }
    } as GraphNode
    const layout = [
      { i: childPanelId('plotGroup-1', 'volcano-2'), x: 0, y: 0, w: 6, h: 9 },
      { i: childPanelId('plotGroup-1', 'ma-3'), x: 6, y: 3, w: 4, h: 5 }
    ]
    useGraph.setState({
      nodes: [group],
      edges: [],
      results: {},
      nextId: 10,
      groupLayouts: { 'plotGroup-1': layout }
    })
    useGraph.getState().duplicateNodes(['plotGroup-1'])
    const copy = useGraph.getState().nodes.find((n) => n.id !== 'plotGroup-1')!
    const kids = (copy.data as { config: PlotGroupConfig }).config.children
    expect(useGraph.getState().groupLayouts[copy.id]).toEqual([
      { ...layout[0], i: childPanelId(copy.id, kids[0].id) },
      { ...layout[1], i: childPanelId(copy.id, kids[1].id) }
    ])
    // the original's is untouched
    expect(useGraph.getState().groupLayouts['plotGroup-1']).toEqual(layout)
  })
})

describe('duplicating a group', () => {
  const tile = (id: string, kind: string, x: number): GraphNode =>
    ({
      id,
      type: 'step',
      position: { x, y: 0 },
      data: { kind, status: 'done', config: {} }
    }) as unknown as GraphNode
  const setup = (): void =>
    useGraph.setState({
      nodes: [tile('compare-1', 'compare', 0), tile('volcano-2', 'volcano', 300)],
      edges: [{ id: 'e-compare-1-volcano-2', source: 'compare-1', target: 'volcano-2' }],
      frames: [{ id: 'frame-3', label: 'QC', members: ['compare-1', 'volcano-2'] }],
      results: {},
      nextId: 10,
      groupLayouts: {}
    })

  it('copies the group, its tiles and the links between them', () => {
    setup()
    useGraph.getState().duplicateNodes(['compare-1', 'volcano-2'])
    const g = useGraph.getState()
    const copies = g.nodes.filter((n) => !['compare-1', 'volcano-2'].includes(n.id))
    expect(copies).toHaveLength(2)
    const ids = new Set(copies.map((n) => n.id))
    // the link, between the copies
    expect(g.edges.filter((e) => ids.has(e.source) && ids.has(e.target))).toHaveLength(1)
    // a new group around them, named _copy
    const frame = g.frames.find((f) => f.id !== 'frame-3')!
    expect(frame.label).toBe('QC_copy')
    expect(new Set(frame.members)).toEqual(ids)
    // copies don't run until asked
    expect(copies.every((n) => (n.data as { status: string }).status === 'idle')).toBe(true)
  })

  it('names further copies _copy2, _copy3 — a copy of a copy too', () => {
    setup()
    const dup = (): void => {
      const f = useGraph.getState().frames.find((x) => x.label === 'QC')!
      useGraph.getState().duplicateNodes(f.members)
    }
    dup()
    dup()
    const copy = useGraph.getState().frames.find((x) => x.label === 'QC_copy')!
    useGraph.getState().duplicateNodes(copy.members)
    expect(useGraph.getState().frames.map((f) => f.label)).toEqual([
      'QC',
      'QC_copy',
      'QC_copy2',
      'QC_copy3'
    ])
  })
})
