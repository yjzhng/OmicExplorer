/** A plot group's fold (its `collapsed` config) is saved with the workflow — so editing the group's
 *  subcards (add, remove, reorder, a setting, "apply to all") must keep it, not rebuild the config
 *  from the children alone. */
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
import type { GraphNode, PlotGroupConfig } from './types'

const cfg = (): PlotGroupConfig =>
  (useGraph.getState().nodes.find((n) => n.id === 'grp')!.data as { config: PlotGroupConfig })
    .config

describe('plot group fold', () => {
  it('survives adding, reordering and removing its plots', () => {
    const group: GraphNode = {
      id: 'grp',
      type: 'step',
      position: { x: 0, y: 0 },
      data: {
        kind: 'plotGroup',
        config: {
          children: [
            { id: 'a', kind: 'volcano', config: {} as never },
            { id: 'b', kind: 'ma', config: {} as never }
          ]
        },
        status: 'idle'
      }
    }
    useGraph.setState({ nodes: [...useGraph.getState().nodes, group] })
    useGraph.getState().setGroupsCollapsed(['grp'], true)
    expect(cfg().collapsed).toBe(true)

    useGraph.getState().addGroupChild('grp', 'dr')
    expect(cfg().collapsed).toBe(true)
    expect(cfg().children).toHaveLength(3)

    useGraph.getState().moveGroupChild('grp', 'b', 'a', 'before')
    expect(cfg().collapsed).toBe(true)

    useGraph.getState().removeGroupChild('grp', 'a')
    expect(cfg().collapsed).toBe(true)
    expect(cfg().children.map((c) => c.id)).not.toContain('a')
  })
  it('survives a subcard setting and "apply to all"', () => {
    useGraph.getState().updateChildConfig('grp', 'b', { pointSize: 4 })
    expect(cfg().collapsed).toBe(true)
    expect(
      (cfg().children.find((c) => c.id === 'b')!.config as { pointSize?: number }).pointSize
    ).toBe(4)

    useGraph.getState().applyConfigToKind('ma', { pointSize: 5 })
    expect(cfg().collapsed).toBe(true)
    expect(
      (cfg().children.find((c) => c.id === 'b')!.config as { pointSize?: number }).pointSize
    ).toBe(5)
  })
})
