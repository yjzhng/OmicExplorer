/** Reordering the form layout's sections. The node list is creation order, so moving an entry in it
 *  is what "the user's own order" means — and what a later-added step landing at the bottom is. */
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

const ids = (): string[] => useGraph.getState().nodes.map((n) => n.id)

describe('moveStep', () => {
  // The seed pipeline: load-1 → std-1 → cmp-1 → vol-1, and std-1 → heat-1.
  const at = (id: string): number => ids().indexOf(id)

  it('moves a step to sit before another', () => {
    useGraph.getState().moveStep('heat-1', 'cmp-1')
    expect(at('heat-1')).toBeLessThan(at('cmp-1'))
    expect(at('std-1')).toBeLessThan(at('heat-1')) // still below its own input
  })

  it('moves a step to the end when no anchor is given', () => {
    const before = ids()
    useGraph.getState().moveStep('vol-1', null)
    expect(ids()[ids().length - 1]).toBe('vol-1')
    expect(ids()).toHaveLength(before.length) // nothing lost or duplicated
    expect(new Set(ids())).toEqual(new Set(before))
  })

  it('corrects a move that would put a step above its input', () => {
    // Dropped at the very top, cmp-1 would sit above std-1, which feeds it. The action normalises
    // rather than trusting the caller, so the rule holds however moveStep is reached.
    useGraph.getState().moveStep('cmp-1', 'load-1')
    expect(at('std-1')).toBeLessThan(at('cmp-1'))
    expect(at('cmp-1')).toBeLessThan(at('vol-1'))
  })

  it('ignores a drop that changes nothing, so undo history stays clean', () => {
    const before = ids()
    const undos = useGraph.getState().past.length
    useGraph.getState().moveStep(before[1], before[1]) // onto itself
    useGraph.getState().moveStep(before[1], before[2]) // into the gap it already occupies
    useGraph.getState().moveStep(before[before.length - 1], null) // already last
    expect(ids()).toEqual(before)
    // Each of those would otherwise cost an undo step that undoes nothing visible.
    expect(useGraph.getState().past.length).toBe(undos)
  })

  it('takes exactly one undo step for a move that does change the order', () => {
    const before = ids()
    const undos = useGraph.getState().past.length
    useGraph.getState().moveStep('heat-1', 'cmp-1')
    expect(useGraph.getState().past.length).toBe(undos + 1)
    expect(ids()).not.toEqual(before)
  })

  it('ignores an unknown step or anchor rather than reshuffling', () => {
    const before = ids()
    useGraph.getState().moveStep('ghost', before[0])
    useGraph.getState().moveStep(before[0], 'ghost')
    expect(ids()).toEqual(before)
  })
})

describe('the node list stays consistent with the wiring', () => {
  it('reorders when an edge is drawn backwards, whichever view drew it', () => {
    // `onConnect` is what the CANVAS uses too, so a connection made there obeys the same rule as
    // one picked in a form. A new Compare lands at the bottom; wiring it into the existing Volcano
    // therefore points an edge UP the list, and the target has to move below its new source.
    const cmp = useGraph.getState().addNode('compare')
    expect(ids()[ids().length - 1]).toBe(cmp)
    useGraph
      .getState()
      .onConnect({ source: cmp, target: 'vol-1', sourceHandle: null, targetHandle: null })
    // The connection must actually have been made — otherwise this asserts nothing.
    expect(useGraph.getState().edges.some((e) => e.source === cmp && e.target === 'vol-1')).toBe(
      true
    )
    expect(ids().indexOf('vol-1')).toBeGreaterThan(ids().indexOf(cmp))
  })

  it('leaves every edge pointing down the list', () => {
    const order = ids()
    const rank = new Map(order.map((id, i) => [id, i]))
    for (const e of useGraph.getState().edges) {
      const a = rank.get(e.source)
      const b = rank.get(e.target)
      if (a === undefined || b === undefined) continue
      expect(a).toBeLessThan(b)
    }
  })
})
