/** End to end through the store: results replaced several undo steps back are spilled to the park
 *  "disk" and come back from it when undo reaches them. */
import { describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()
const noop = (): void => {}
const api: Record<string, unknown> = {
  parkWrite: async (key: string, pieces: string[]) => void files.set(key, pieces.join('')),
  parkRead: async (key: string) => {
    const t = files.get(key)
    if (t == null) throw new Error('missing')
    return t
  },
  parkDrop: async (key: string) => void files.delete(key)
}
vi.stubGlobal('window', {
  api: new Proxy(api, { get: (t, k: string) => t[k] ?? (() => noop) }),
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop })
})
vi.stubGlobal('localStorage', { getItem: () => null, setItem: noop, removeItem: noop })

const { useGraph } = await import('./store')
import type { GraphNode, NodeResult } from './types'

const step = (id: string, kind: string, config: Record<string, unknown> = {}): GraphNode =>
  ({ id, type: 'step', position: { x: 0, y: 0 }, data: { kind, config, status: 'done' } }) as never

const g = () => useGraph.getState()
const settle = () => new Promise((r) => setTimeout(r, 20))
const pcaResult = (tag: string) => ({ kind: 'pca', tag }) as unknown as NodeResult

describe('undo history on disk', () => {
  it('spills old results and reads them back on undo', async () => {
    useGraph.setState({
      nodes: [step('std', 'standardize', { minSamplePct: 0 })],
      edges: [],
      results: { std: pcaResult('v0') },
      past: [],
      future: []
    })
    // Four edit + run rounds: each edit is an undo step, each run a new version of the result.
    for (let i = 1; i <= 4; i++) {
      g().updateConfig('std', { minSamplePct: i })
      useGraph.setState((s) => ({
        results: { ...s.results, std: pcaResult(`v${i}`) },
        nodes: s.nodes.map((n) => ({ ...n, data: { ...n.data, status: 'done' } }) as GraphNode)
      }))
      await settle()
    }
    // v4 is current, v3 and v2 are kept in memory; v0 and v1 went to disk.
    expect(files.size).toBe(2)

    for (let i = 0; i < 4; i++) g().undo()
    // Straight after the undo the tile waits on the read…
    expect(g().nodes[0].data.status).toBe('idle')
    await settle()
    // …then has its first result back, without a re-run.
    expect((g().results.std as unknown as { tag: string }).tag).toBe('v0')
    expect(g().nodes[0].data.status).toBe('done')
  })

  it('forgets the files once the history no longer refers to them', async () => {
    useGraph.setState({ past: [], future: [] })
    await settle()
    expect(files.size).toBe(0)
  })
})
