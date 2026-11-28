import { describe, expect, it } from 'vitest'

import { dropUnknownKinds } from './unknownKinds'
import type { RawProject } from './upgrades'

const known = new Set(['load', 'compare', 'volcano', 'plotGroup'])
const step = (id: string, kind: string, config: unknown = {}) => ({
  id,
  position: { x: 0, y: 0 },
  data: { kind, config }
})

describe('dropUnknownKinds', () => {
  it('leaves out a step of unknown kind, its wiring and layout; a grouped plot of one', () => {
    const raw = {
      folders: [
        {
          workflows: [
            {
              doc: {
                nodes: [
                  step('a', 'load'),
                  step('b', 'compare'),
                  step('g1', 'plotGroup', {
                    children: [
                      { id: 'p1', kind: 'volcano', config: {} },
                      { id: 'p2', kind: 'gone', config: {} }
                    ]
                  }),
                  step('g2', 'plotGroup', { children: [{ id: 'p3', kind: 'gone', config: {} }] }),
                  step('x', 'gone')
                ],
                edges: [
                  { id: 'e1', source: 'a', target: 'b' },
                  { id: 'e2', source: 'b', target: 'g1' },
                  { id: 'e3', source: 'b', target: 'g2' },
                  { id: 'e4', source: 'b', target: 'x' }
                ],
                groupLayouts: {
                  g1: [
                    { i: 'p1', x: 0, y: 0, w: 1, h: 1 },
                    { i: 'p2', x: 1, y: 0, w: 1, h: 1 }
                  ],
                  g2: [{ i: 'p3', x: 0, y: 0, w: 1, h: 1 }]
                }
              }
            }
          ]
        }
      ]
    } as unknown as RawProject
    expect(dropUnknownKinds(raw, known)).toEqual(['gone'])
    const doc = raw.folders![0].workflows![0].doc!
    expect(doc.nodes.map((n) => n.id)).toEqual(['a', 'b', 'g1'])
    expect(doc.edges.map((e) => e.id)).toEqual(['e1', 'e2'])
    const g1 = doc.nodes[2].data.config as unknown as { children: Array<{ id: string }> }
    expect(g1.children.map((c) => c.id)).toEqual(['p1'])
    expect(doc.groupLayouts).toEqual({ g1: [{ i: 'p1', x: 0, y: 0, w: 1, h: 1 }] })
  })

  it('changes nothing when every kind is known', () => {
    const doc = { nodes: [step('a', 'load')], edges: [] }
    const raw = { folders: [{ workflows: [{ doc }] }] } as unknown as RawProject
    const before = structuredClone(raw)
    expect(dropUnknownKinds(raw, known)).toEqual([])
    expect(raw).toEqual(before)
  })
})
