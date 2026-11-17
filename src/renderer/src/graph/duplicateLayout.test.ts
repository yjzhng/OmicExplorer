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
const { childPanelId } = await import('./groups')
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
