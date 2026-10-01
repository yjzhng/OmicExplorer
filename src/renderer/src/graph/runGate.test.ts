/** Which upstream steps must run before a step can. */
import { describe, expect, it } from 'vitest'

import { pendingInputs } from './runGate'
import type { GraphNode, NodeKind, StepStatus } from './types'

const n = (id: string, kind: NodeKind, status: StepStatus = 'idle'): GraphNode =>
  ({
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    data: { kind, category: 'processing', status, config: {} }
  }) as unknown as GraphNode
const e = (source: string, target: string) => ({ source, target })
const pending = (id: string, nodes: GraphNode[], edges: ReturnType<typeof e>[]): string[] =>
  pendingInputs(id, nodes, edges).map((s) => s.id)

describe('pendingInputs', () => {
  it('reports an upstream that has not run', () => {
    const nodes = [n('s', 'standardize', 'idle'), n('c', 'compare')]
    expect(pending('c', nodes, [e('s', 'c')])).toEqual(['s'])
  })

  it('is clear once the upstream is done', () => {
    const nodes = [n('s', 'standardize', 'done'), n('c', 'compare')]
    expect(pending('c', nodes, [e('s', 'c')])).toEqual([])
  })

  it('still blocks on an upstream that ran and FAILED, or is mid-run', () => {
    for (const st of ['error', 'running'] as StepStatus[]) {
      const nodes = [n('s', 'standardize', st), n('c', 'compare')]
      expect(pending('c', nodes, [e('s', 'c')])).toEqual(['s'])
    }
  })

  it('never blocks on a step that has no run of its own', () => {
    // A Load holds file references, not a result — it stays `idle` forever, and treating that as
    // pending would block the whole pipeline behind it.
    const nodes = [n('l', 'load', 'idle'), n('s', 'standardize')]
    expect(pending('s', nodes, [e('l', 's')])).toEqual([])
  })

  it('reports every unfinished input of a join, and only the unfinished ones', () => {
    const nodes = [
      n('a', 'standardize', 'done'),
      n('b', 'standardize', 'idle'),
      n('c', 'standardize', 'idle'),
      n('m', 'merge')
    ]
    expect(pending('m', nodes, [e('a', 'm'), e('b', 'm'), e('c', 'm')])).toEqual(['b', 'c'])
  })

  it('looks only one hop up, not through the whole chain', () => {
    // std is done, so compare is runnable — whether the Load behind it is "finished" is not
    // compare's problem, and re-running std is how a stale chain gets refreshed.
    const nodes = [n('l', 'load'), n('s', 'standardize', 'done'), n('c', 'compare')]
    expect(pending('c', nodes, [e('l', 's'), e('s', 'c')])).toEqual([])
  })

  it('is clear for an unwired step, so a source is never blocked', () => {
    expect(pending('s', [n('s', 'standardize')], [])).toEqual([])
  })
})
