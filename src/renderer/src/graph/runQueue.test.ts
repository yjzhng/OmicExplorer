/** A tile run while its input is still running joins the queue: it waits (shown running), then
 *  goes ahead once the input settles — rather than failing at once. */
import { afterEach, describe, expect, it, vi } from 'vitest'

const noop = (): void => {}
vi.stubGlobal('window', {
  api: new Proxy({}, { get: () => () => noop }),
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop })
})
vi.stubGlobal('localStorage', { getItem: () => null, setItem: noop, removeItem: noop })

const { useGraph } = await import('./store')
import type { GraphNode, StepStatus } from './types'

const step = (id: string, kind: 'compare' | 'volcano', status: StepStatus): GraphNode => ({
  id,
  type: 'step',
  position: { x: 0, y: 0 },
  data: { kind, config: {} as never, status }
})
const node = (id: string): GraphNode['data'] & { status?: StepStatus; note?: string } =>
  useGraph.getState().nodes.find((n) => n.id === id)!.data as never
const setStatus = (id: string, status: StepStatus): void =>
  useGraph.setState((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, status } } : n)) as never
  }))

function wire(): void {
  useGraph.setState({
    nodes: [step('cmp', 'compare', 'running'), step('vol', 'volcano', 'idle')],
    edges: [{ id: 'e', source: 'cmp', target: 'vol' }],
    results: {}
  })
}

afterEach(() => vi.useRealTimers())

describe('running a tile whose input is still running', () => {
  it('waits for the input, then goes ahead', async () => {
    vi.useFakeTimers()
    wire()
    const run = useGraph.getState().runNode('vol')
    await vi.advanceTimersByTimeAsync(1000)
    expect(node('vol').status).toBe('running')
    expect(node('vol').note).toBeUndefined()
    // the input settles (here: fails, so it has no result) — the plot then runs and reports that
    setStatus('cmp', 'error')
    await vi.advanceTimersByTimeAsync(400)
    await run
    expect(node('vol').status).toBe('error')
    expect(node('vol').note).toBeUndefined()
  })
  it('stopping it while it waits stands it down and leaves the input running', async () => {
    vi.useFakeTimers()
    wire()
    const run = useGraph.getState().runNode('vol')
    await vi.advanceTimersByTimeAsync(400)
    useGraph.getState().cancelNode('vol')
    await vi.advanceTimersByTimeAsync(400)
    await run
    expect(node('vol').status).toBe('idle')
    expect(node('cmp').status).toBe('running')
  })
})
