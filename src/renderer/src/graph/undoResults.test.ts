/** Undo/redo restore the graph and work each tile's result out against the current state: what
 *  still holds stays, a Compare's threshold change is re-called, the rest comes back from the
 *  history cache — or needs a re-run when there was none. */
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
import { DEFAULT_THRESHOLD } from '../engine'
import type { CompareResultRow } from '../engine'
import type { GraphNode, NodeResult } from './types'

const step = (id: string, kind: string, config: Record<string, unknown> = {}): GraphNode =>
  ({ id, type: 'step', position: { x: 0, y: 0 }, data: { kind, config, status: 'done' } }) as never

const row = (uniqID: string, log2FC: number): CompareResultRow =>
  ({
    uniqID,
    cmpd: 'A',
    dose: null,
    time: null,
    cmp_cond: 'cmpd',
    comparison: 'A | V',
    mean1: 1,
    mean2: 1,
    sd1: 0,
    sd2: 0,
    log2FC,
    pP: 0.0001,
    pQ: 0.001,
    thrsh: '',
    signf: true,
    effect: 'up'
  }) as CompareResultRow

const threshold = { ...DEFAULT_THRESHOLD }

function seed(): Record<string, NodeResult> {
  const results = {
    std: { kind: 'standardize', std: { rows: [] } },
    cmp: {
      kind: 'compare',
      cmp: { rows: [row('g1', 1.5), row('g2', 3)], threshold }
    },
    ctr: { kind: 'contrast', ctr: { rows: [] } },
    pca: { kind: 'pca', id: 'old' }
  } as unknown as Record<string, NodeResult>
  useGraph.setState({
    nodes: [
      step('std', 'standardize'),
      step('cmp', 'compare', { threshold }),
      step('ctr', 'contrast'),
      step('pca', 'pca')
    ],
    edges: [
      { id: 'e1', source: 'std', target: 'cmp' },
      { id: 'e2', source: 'cmp', target: 'ctr' },
      { id: 'e3', source: 'std', target: 'pca' }
    ],
    results,
    past: [],
    future: []
  })
  return results
}

const g = () => useGraph.getState()
const status = (id: string) => g().nodes.find((n) => n.id === id)?.data.status
// The threshold the Compare's stored calls were made under.
const calledAt = (): number =>
  (g().results.cmp as { cmp: { threshold: { fcHigh: number } } }).cmp.threshold.fcHigh

describe('undo after a threshold drag', () => {
  it('restores the threshold, re-calls the Compare and brings the stale Contrast back', () => {
    const before = seed()
    g().setCompareThreshold('cmp', { fcHigh: 2 })
    expect(calledAt()).toBe(2)
    expect(g().results.ctr).toBeUndefined() // the Contrast went stale

    g().undo()
    const cfg = g().nodes.find((n) => n.id === 'cmp')!.data.config as {
      threshold: { fcHigh: number }
    }
    expect(cfg.threshold.fcHigh).toBe(1)
    expect(calledAt()).toBe(1)
    expect(status('cmp')).toBe('done')
    expect(g().results.ctr).toBe(before.ctr)
    expect(status('ctr')).toBe('done')
    expect(g().results.std).toBe(before.std)
    expect(g().results.pca).toBe(before.pca)
  })

  it('redo re-calls under the dragged threshold', () => {
    seed()
    g().setCompareThreshold('cmp', { fcHigh: 2 })
    g().undo()
    g().redo()
    expect(calledAt()).toBe(2)
    expect(g().results.ctr).toBeUndefined()
  })

  it('records the drags as one version of the Compare, not one per threshold', () => {
    seed()
    g().setCompareThreshold('cmp', { fcHigh: 2 })
    g().setCompareThreshold('cmp', { fcHigh: 3 })
    const ids = new Set(g().past.map((snap) => snap.versions?.cmp))
    expect(ids.size).toBe(1)
    for (const snap of g().past) expect(snap).not.toHaveProperty('results')
  })

  it('keeps a run made since the snapshot on a tile the undo does not touch', () => {
    seed()
    g().setCompareThreshold('cmp', { fcHigh: 2 })
    const rerun = { kind: 'pca', id: 'new' } as unknown as NodeResult
    useGraph.setState((s) => ({ results: { ...s.results, pca: rerun } }))
    g().undo()
    expect(g().results.pca).toBe(rerun)
  })

  it('a step whose settings change is undone gets its earlier result back from the history', () => {
    seed()
    g().updateConfig('cmp', { method: 'other' })
    expect(g().results.cmp).toBeUndefined()
    g().undo()
    expect(calledAt()).toBe(1)
    expect(status('cmp')).toBe('done')
  })

  it('a step that had no result then needs a re-run', () => {
    seed()
    useGraph.setState((s) => {
      const results = { ...s.results }
      delete results.ctr
      return {
        results,
        nodes: s.nodes.map((n) =>
          n.id === 'ctr' ? ({ ...n, data: { ...n.data, status: 'idle' } } as GraphNode) : n
        )
      }
    })
    g().updateConfig('cmp', { method: 'other' })
    g().undo()
    expect(g().results.ctr).toBeUndefined()
    expect(status('ctr')).toBe('idle')
  })

  it('a plot in a group keeps its result across an undone view-setting change', () => {
    seed()
    const child = { id: 'c1', kind: 'volcano', config: { labelTop: 10 }, status: 'done' }
    const shown = { kind: 'volcano', id: 'shown' } as unknown as NodeResult
    useGraph.setState((s) => ({
      nodes: [...s.nodes, step('grp', 'plotGroup', { children: [child] })],
      edges: [...s.edges, { id: 'e4', source: 'cmp', target: 'grp' }],
      results: { ...s.results, 'grp/c1': shown }
    }))
    g().updateChildConfig('grp', 'c1', { labelTop: 3 })
    g().undo()
    expect(g().results['grp/c1']).toBe(shown)
  })
})

describe('after a threshold drag', () => {
  it('keeps the plots below it (no Run needed) and clears only the steps', () => {
    seed()
    useGraph.setState((s) => ({
      nodes: [...s.nodes, step('vol', 'volcano')],
      edges: [...s.edges, { id: 'e4', source: 'cmp', target: 'vol' }],
      results: { ...s.results, vol: { kind: 'marker' } as unknown as NodeResult }
    }))
    g().setCompareThreshold('cmp', { fcHigh: 2 })
    expect(status('vol')).toBe('done')
    expect(g().results.vol).toBeDefined()
    expect(g().results.ctr).toBeUndefined()
  })
})
