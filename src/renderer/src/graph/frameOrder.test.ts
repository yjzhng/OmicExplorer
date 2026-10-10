/** Groups in the step order: kept as one block where the wiring allows, split where it can't. */
import { describe, expect, it } from 'vitest'

import { dropOrder, formTree, groupedOrder } from './frameOrder'
import type { CanvasFrame } from './types'

const e = (source: string, target: string) => ({ source, target })
const G = (id: string, members: string[]): CanvasFrame => ({ id, label: id, members })

describe('groupedOrder', () => {
  it('pulls a group together, otherwise keeping the order', () => {
    // A → C, B loose: A and C can sit together
    expect(groupedOrder(['A', 'B', 'C', 'D'], [e('A', 'C')], [G('g', ['A', 'C'])])).toEqual([
      'A',
      'C',
      'B',
      'D'
    ])
  })

  it('moves a block after what feeds it', () => {
    // B feeds C; group {C, D} — the block goes after B
    expect(groupedOrder(['A', 'C', 'B', 'D'], [e('B', 'C')], [G('g', ['C', 'D'])])).toEqual([
      'A',
      'B',
      'C',
      'D'
    ])
  })

  it('splits a group only when an outside step is in the middle of its chain', () => {
    const out = groupedOrder(['A', 'B', 'C'], [e('A', 'B'), e('B', 'C')], [G('g', ['A', 'C'])])
    expect(out).toEqual(['A', 'B', 'C'])
    expect(formTree(out, [G('g', ['A', 'C'])])).toEqual([
      { kind: 'group', frameId: 'g', continued: false, items: [{ kind: 'step', id: 'A' }] },
      { kind: 'step', id: 'B' },
      { kind: 'group', frameId: 'g', continued: true, items: [{ kind: 'step', id: 'C' }] }
    ])
  })

  it('keeps nested groups together inside their parent', () => {
    const frames = [G('in', ['B', 'D']), G('out', ['A', 'in'])]
    const out = groupedOrder(['A', 'B', 'C', 'D'], [], frames)
    expect(out).toEqual(['A', 'B', 'D', 'C'])
    expect(formTree(out, frames)).toEqual([
      {
        kind: 'group',
        frameId: 'out',
        continued: false,
        items: [
          { kind: 'step', id: 'A' },
          {
            kind: 'group',
            frameId: 'in',
            continued: false,
            items: [
              { kind: 'step', id: 'B' },
              { kind: 'step', id: 'D' }
            ]
          }
        ]
      },
      { kind: 'step', id: 'C' }
    ])
  })
})

describe('dropOrder', () => {
  const frames = [G('g', ['B', 'C'])]
  const order = ['A', 'B', 'C', 'D']

  it('moves a step within its group', () => {
    expect(dropOrder(order, [], frames, 'C', { before: 'B' })).toEqual(['A', 'C', 'B', 'D'])
    expect(dropOrder(order, [], frames, 'B', { end: 'g' })).toEqual(['A', 'C', 'B', 'D'])
  })

  it('never moves a step into or out of a group', () => {
    expect(dropOrder(order, [], frames, 'A', { before: 'C' })).toBeNull()
    expect(dropOrder(order, [], frames, 'B', { before: 'A' })).toBeNull()
    expect(dropOrder(order, [], frames, 'B', { end: null })).toBeNull()
  })

  it('a loose step dropped on a group step lands before the whole group', () => {
    expect(dropOrder(order, [], frames, 'D', { before: 'C' })).toEqual(['A', 'D', 'B', 'C'])
  })

  it('moves a whole group, within the wiring', () => {
    expect(dropOrder(order, [], frames, 'g', { before: 'A' })).toEqual(['B', 'C', 'A', 'D'])
    expect(dropOrder(order, [], frames, 'g', { end: null })).toEqual(['A', 'D', 'B', 'C'])
    // A feeds B: the group can't go above A
    expect(dropOrder(order, [e('A', 'B')], frames, 'g', { before: 'A' })).toBeNull()
  })
})
