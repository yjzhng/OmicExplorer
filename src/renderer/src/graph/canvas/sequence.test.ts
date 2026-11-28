/** The form layout's sequence invariant: a step's inputs are steps above it. */
import { describe, expect, it } from 'vitest'

import { blockedDrops, canMoveBefore, eligibleInputs, orderedByWiring } from './sequence'

const e = (source: string, target: string) => ({ source, target })
const ORDER = ['load', 'clean', 'compare', 'volcano']
const WIRED = [e('load', 'clean'), e('clean', 'compare'), e('compare', 'volcano')]

describe('eligibleInputs', () => {
  it('offers only the steps above', () => {
    expect(eligibleInputs('compare', ORDER, WIRED)).toEqual(['load', 'clean'])
    expect(eligibleInputs('volcano', ORDER, WIRED)).toEqual(['load', 'clean', 'compare'])
  })

  it('offers nothing to the first step, and never the step itself', () => {
    expect(eligibleInputs('load', ORDER, WIRED)).toEqual([])
    for (const id of ORDER) expect(eligibleInputs(id, ORDER, WIRED)).not.toContain(id)
  })

  it('keeps a current input that sits below, so the picker never blanks', () => {
    // Shouldn't arise — the order is normalised — but a select whose value is missing from its
    // options renders empty, which reads as "this step lost its input" and invites a click that
    // really would drop the edge.
    const odd = [...WIRED, e('volcano', 'clean')]
    expect(eligibleInputs('clean', ORDER, odd)).toEqual(['load', 'volcano'])
  })

  it('returns nothing for a step not in the order', () => {
    expect(eligibleInputs('ghost', ORDER, WIRED)).toEqual([])
  })
})

describe('orderedByWiring', () => {
  it('leaves an already-sequenced list untouched', () => {
    expect(orderedByWiring(ORDER, WIRED)).toEqual(ORDER)
  })

  it('moves a step that sits above one of its inputs', () => {
    // However the edge was drawn — canvas or form — the list ends up agreeing with it.
    const jumbled = ['volcano', 'compare', 'clean', 'load']
    expect(orderedByWiring(jumbled, WIRED)).toEqual(['load', 'clean', 'compare', 'volcano'])
  })

  it('disturbs the user order no more than the wiring demands', () => {
    // `note` is unwired, so it must keep its place rather than being swept to one end.
    const order = ['note', 'compare', 'clean']
    expect(orderedByWiring(order, [e('clean', 'compare')])).toEqual(['note', 'clean', 'compare'])
  })

  it('puts every input of a join above it', () => {
    const order = ['m', 'a', 'b']
    const out = orderedByWiring(order, [e('a', 'm'), e('b', 'm')])
    expect(out.indexOf('m')).toBeGreaterThan(out.indexOf('a'))
    expect(out.indexOf('m')).toBeGreaterThan(out.indexOf('b'))
  })

  it("keeps a cycle's members rather than dropping them", () => {
    // A cycle can't be sequenced; losing steps from the list would be far worse than not sorting.
    const out = orderedByWiring(['x', 'y'], [e('x', 'y'), e('y', 'x')])
    expect(new Set(out)).toEqual(new Set(['x', 'y']))
    expect(out).toHaveLength(2)
  })

  it('ignores edges to steps that are not in the list', () => {
    expect(orderedByWiring(['a', 'b'], [e('ghost', 'a'), e('a', 'b')])).toEqual(['a', 'b'])
  })
})

describe('canMoveBefore', () => {
  it("allows a move that keeps every one of the step's edges pointing down", () => {
    // A drop that changes nothing is not a move.
    expect(canMoveBefore('volcano', null, ORDER, WIRED)).toBe(false) // already last
    expect(canMoveBefore('load', 'clean', ORDER, WIRED)).toBe(false) // already there
    // table takes clean, so it may go anywhere below it — including up past compare.
    const four = ['load', 'clean', 'compare', 'volcano', 'table']
    const wired = [...WIRED, e('clean', 'table')]
    expect(canMoveBefore('table', 'compare', four, wired)).toBe(true) // still below clean
  })

  it("refuses a move above one of the step's inputs", () => {
    expect(canMoveBefore('compare', 'clean', ORDER, WIRED)).toBe(false)
    expect(canMoveBefore('compare', 'load', ORDER, WIRED)).toBe(false)
  })

  it("refuses a move below one of the step's outputs", () => {
    expect(canMoveBefore('clean', null, ORDER, WIRED)).toBe(false)
  })

  it('judges only the moved step, so an unrelated pair cannot lock the list', () => {
    const order = ['free', 'a', 'b', 'c']
    expect(canMoveBefore('free', 'c', order, [e('a', 'b')])).toBe(true)
  })

  it('refuses an unknown anchor or a no-op', () => {
    expect(canMoveBefore('clean', 'ghost', ORDER, WIRED)).toBe(false)
    expect(canMoveBefore('clean', 'clean', ORDER, WIRED)).toBe(false)
  })
})

describe('blockedDrops', () => {
  it('blocks the slots above its inputs and below its outputs', () => {
    // compare takes clean and feeds volcano: above clean or below volcano would break an edge.
    expect(blockedDrops('compare', ORDER, WIRED)).toEqual(new Set(['load', 'clean', null]))
  })

  it('never blocks the slots the step already occupies', () => {
    const blocked = blockedDrops('compare', ORDER, WIRED)
    expect(blocked.has('compare')).toBe(false)
    expect(blocked.has('volcano')).toBe(false) // right below it: a no-op, not a violation
  })

  it('blocks nothing for an unwired step', () => {
    expect(blockedDrops('free', ['a', 'free', 'b'], [])).toEqual(new Set())
  })
})
