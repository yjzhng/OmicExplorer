/** Opening a saved workflow repairs an order that predates the sequencing rule. */
import { describe, expect, it } from 'vitest'

import { parseWorkflowDoc } from './workflowDoc'
import type { WorkflowDoc } from './workflowDoc'

const step = (id: string, kind: string) => ({
  id,
  position: { x: 0, y: 0 },
  data: { kind, config: {} }
})
const doc = (ids: [string, string][], edges: [string, string][]): WorkflowDoc =>
  ({
    version: 4,
    nodes: ids.map(([id, kind]) => step(id, kind)),
    edges: edges.map(([source, target]) => ({ id: `${source}-${target}`, source, target })),
    nextId: 9
  }) as unknown as WorkflowDoc

describe('parseWorkflowDoc ordering', () => {
  it('moves a step that was saved above its own input', () => {
    // What an existing project looks like: built on the canvas, where nothing enforced an order.
    const loaded = parseWorkflowDoc(
      doc(
        [
          ['vol-1', 'volcano'],
          ['cmp-1', 'compare'],
          ['std-1', 'standardize'],
          ['load-1', 'load']
        ],
        [
          ['load-1', 'std-1'],
          ['std-1', 'cmp-1'],
          ['cmp-1', 'vol-1']
        ]
      )
    )
    expect(loaded.nodes.map((n) => n.id)).toEqual(['load-1', 'std-1', 'cmp-1', 'vol-1'])
  })

  it('leaves a well-ordered workflow exactly as saved', () => {
    const ids: [string, string][] = [
      ['load-1', 'load'],
      ['std-1', 'standardize'],
      ['qc-1', 'qc'],
      ['cmp-1', 'compare']
    ]
    const loaded = parseWorkflowDoc(
      doc(ids, [
        ['load-1', 'std-1'],
        ['std-1', 'qc-1'],
        ['std-1', 'cmp-1']
      ])
    )
    // qc before cmp is the user's choice, not something the wiring decides — it must survive.
    expect(loaded.nodes.map((n) => n.id)).toEqual(ids.map(([id]) => id))
  })

  it('loses no step while reordering, including an unwired one', () => {
    const loaded = parseWorkflowDoc(
      doc(
        [
          ['b', 'compare'],
          ['note', 'qc'],
          ['a', 'standardize']
        ],
        [['a', 'b']]
      )
    )
    expect(new Set(loaded.nodes.map((n) => n.id))).toEqual(new Set(['a', 'b', 'note']))
    const ids = loaded.nodes.map((n) => n.id)
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'))
  })
})
