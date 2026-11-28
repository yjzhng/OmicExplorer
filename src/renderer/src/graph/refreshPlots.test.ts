/** Re-running a processing step re-runs every plot tile below it — a plot that fails (an
 *  enrichment with no annotations) doesn't leave the plot tiles after it unrun: nothing reads from
 *  a plot, so its failure skips nothing. */
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
const { isQueuedRun } = await import('./state/run')
import type { GraphNode, PlotGroupConfig } from './types'

const group = (id: string, kinds: string[]): GraphNode =>
  ({
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    data: {
      kind: 'plotGroup',
      status: 'idle',
      config: {
        children: kinds.map((kind, i) => ({ id: `${id}-${i}`, kind, config: {}, status: 'idle' }))
      }
    }
  }) as never

function wire(groups: GraphNode[]): void {
  useGraph.setState({
    nodes: [
      {
        id: 'cmp',
        type: 'step',
        position: { x: 0, y: 0 },
        data: { kind: 'compare', status: 'done', config: {} as never }
      },
      ...groups
    ] as never,
    edges: groups.map((g) => ({ id: `e-${g.id}`, source: 'cmp', target: g.id })),
    results: {
      cmp: { kind: 'compare', cmp: { rows: [], comparisons: [] }, displayMap: {} }
    } as never
  })
}
const plotStatuses = (id: string): (string | undefined)[] => {
  const n = useGraph.getState().nodes.find((x) => x.id === id)!
  return (n.data.config as PlotGroupConfig).children.map((c) => c.status)
}

describe('refreshing the plots below a step', () => {
  it('runs every plot tile, and every plot in a tile', async () => {
    wire([group('a', ['volcano', 'heatmap']), group('b', ['volcano'])])
    await useGraph.getState().refreshDownstream('cmp')
    expect(plotStatuses('a')).toEqual(['done', 'done'])
    expect(plotStatuses('b')).toEqual(['done'])
  })

  it('a failing plot tile on top leaves the ones below it running', async () => {
    wire([group('a', ['enrich']), group('b', ['volcano'])])
    await useGraph.getState().refreshDownstream('cmp')
    expect(plotStatuses('a')).toEqual(['error'])
    expect(plotStatuses('b')).toEqual(['done'])
  })
})

describe('plots waiting their turn', () => {
  it('show as queued — not "not run yet" — until their turn, then run', async () => {
    wire([group('a', ['volcano', 'heatmap']), group('b', ['volcano'])])
    const run = useGraph.getState().refreshDownstream('cmp')
    // the first plot under way; the rest waiting their turn
    expect(plotStatuses('a')).toEqual(['running', 'running'])
    expect(plotStatuses('b')).toEqual(['running'])
    expect(isQueuedRun('a/a-0')).toBe(false)
    expect(isQueuedRun('a/a-1')).toBe(true)
    expect(isQueuedRun('b/b-0')).toBe(true)
    await run
    expect(plotStatuses('a')).toEqual(['done', 'done'])
    expect(plotStatuses('b')).toEqual(['done'])
    expect(['a/a-0', 'a/a-1', 'b/b-0'].some(isQueuedRun)).toBe(false)
  })

  it("a queued plot's Stop takes it out of the run", async () => {
    wire([group('a', ['volcano']), group('b', ['volcano'])])
    const run = useGraph.getState().refreshDownstream('cmp')
    useGraph.getState().cancelNode('b')
    expect(plotStatuses('b')).toEqual(['idle'])
    await run
    expect(plotStatuses('a')).toEqual(['done'])
    expect(plotStatuses('b')).toEqual(['idle'])
    expect(isQueuedRun('b/b-0')).toBe(false)
  })

  it('a done plot keeps its chart (not queued) until its turn re-runs it', async () => {
    wire([group('a', ['volcano'])])
    await useGraph.getState().refreshDownstream('cmp')
    const run = useGraph.getState().refreshDownstream('cmp')
    expect(isQueuedRun('a/a-0')).toBe(false)
    await run
    expect(plotStatuses('a')).toEqual(['done'])
  })
})
