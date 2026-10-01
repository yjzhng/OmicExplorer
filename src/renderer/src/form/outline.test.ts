/** Pure helpers behind the form workflow's nav. */
import { describe, expect, it } from 'vitest'

import { resolveSelection, wiredTo } from './outline'

const e = (source: string, target: string) => ({ id: `${source}-${target}`, source, target })
describe('wiredTo', () => {
  const edges = [e('l', 's'), e('s', 'c'), e('s', 'h'), e('c', 'v')]
  const near = (id: string | null) =>
    Object.fromEntries([...wiredTo(id, edges as never)].sort(([a], [b]) => a.localeCompare(b)))

  it('names which way each neighbour sits', () => {
    // The case a one-directional version gets wrong: a step in the middle of the pipeline, with
    // something on both sides of it.
    expect(near('s')).toEqual({ l: 'input', c: 'output', h: 'output' })
    expect(near('c')).toEqual({ s: 'input', v: 'output' })
  })

  it('handles the ends, where there is only one direction to look', () => {
    expect(near('l')).toEqual({ s: 'output' }) // a source: outputs only
    expect(near('v')).toEqual({ c: 'input' }) // a terminal plot: inputs only
  })

  it('reports every input of a join, not just the first', () => {
    const join = [e('a', 'm'), e('b', 'm'), e('m', 'z')]
    expect(near2('m', join)).toEqual({ a: 'input', b: 'input', z: 'output' })
  })

  it('is empty for an unwired step, and for no selection', () => {
    expect(near('orphan')).toEqual({})
    expect(near(null)).toEqual({})
  })

  it('never reports the step itself', () => {
    expect(wiredTo('a', [e('a', 'a')] as never).has('a')).toBe(false)
  })
})

const near2 = (id: string, edges: ReturnType<typeof e>[]) =>
  Object.fromEntries([...wiredTo(id, edges as never)].sort(([a], [b]) => a.localeCompare(b)))

describe('resolveSelection', () => {
  const order = ['a', 'b', 'c']

  it('keeps a selection this workflow has', () => {
    expect(resolveSelection('b', order)).toBe('b')
  })

  it('falls back to the first step when the selection is stale or unset', () => {
    // The selection is shared with the canvas, so it can name a deleted step or one from another
    // workflow. Blanking the details column for that would look like a bug.
    expect(resolveSelection('deleted', order)).toBe('a')
    expect(resolveSelection(null, order)).toBe('a')
  })

  it('is null only when there are no steps at all', () => {
    expect(resolveSelection('a', [])).toBeNull()
    expect(resolveSelection(null, [])).toBeNull()
  })
})
