/** Nested canvas frames: grouping keeps selected frames whole; ungrouping hands members back. */
import { describe, expect, it } from 'vitest'

import {
  frameDepths,
  frameTiles,
  groupInto,
  outermostFrame,
  topFullFrames,
  ungroupFrom,
  withoutTiles
} from './frames'
import type { CanvasFrame } from './types'

const g1: CanvasFrame = { id: 'f1', label: 'Group 1', members: ['a', 'b'] }
const g2: CanvasFrame = { id: 'f2', label: 'Group 2', members: ['c'] }
const isItem = (): boolean => true

describe('nested frames', () => {
  it('groups two whole groups and a tile without touching the groups inside', () => {
    const out = groupInto([g1, g2], ['a', 'b', 'c', 'd'], isItem, {
      id: 'f3',
      label: 'Group 3'
    })
    expect(out.slice(0, 2)).toEqual([g1, g2])
    expect([...out[2].members].sort()).toEqual(['d', 'f1', 'f2'])
    expect(frameTiles(out, 'f3').sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(frameDepths(out).get('f1')).toBe(1)
  })

  it('a tile picked out of a group on its own leaves it', () => {
    expect(groupInto([g1], ['a', 'd'], isItem, { id: 'f3', label: 'G' })).toEqual([
      { ...g1, members: ['b'] },
      { id: 'f3', label: 'G', members: ['a', 'd'] }
    ])
  })

  it('ungrouping the outer group gives back the two groups and the tile', () => {
    const nested = groupInto([g1, g2], ['a', 'b', 'c', 'd'], isItem, { id: 'f3', label: 'G3' })
    expect(ungroupFrom(nested, ['a', 'b', 'c', 'd'])).toEqual([g1, g2])
  })

  it('ungrouping an inner group (its tiles selected) hands its tiles to the outer group', () => {
    const nested = groupInto([g1, g2], ['a', 'b', 'c', 'd'], isItem, { id: 'f3', label: 'G3' })
    const out = ungroupFrom(nested, ['a', 'b'])
    expect([...out.find((f) => f.id === 'f3')!.members].sort()).toEqual(['a', 'b', 'd', 'f2'])
    expect(out.some((f) => f.id === 'f1')).toBe(false)
  })

  it('with only tiles selected, ungroup dissolves the frame directly holding them', () => {
    expect(ungroupFrom([g1, g2], ['a'])).toEqual([g2])
  })

  it('a tile grouped on its own leaves its old frame', () => {
    const out = groupInto([g1], ['b'], isItem, { id: 'f9', label: 'Group 2' })
    expect(out).toEqual([
      { ...g1, members: ['a'] },
      { id: 'f9', label: 'Group 2', members: ['b'] }
    ])
  })

  it('the selected groups are the outermost frames whose tiles are all selected', () => {
    const nested = groupInto([g1, g2], ['a', 'b', 'c', 'd'], isItem, { id: 'f3', label: 'G3' })
    const sel = (ids: string[]) => (id: string) => ids.includes(id)
    expect(topFullFrames(nested, sel(['a', 'b', 'c', 'd']))).toEqual(['f3'])
    expect(topFullFrames(nested, sel(['a', 'b', 'd']))).toEqual(['f1'])
    expect(topFullFrames(nested, sel(['a']))).toEqual([])
    expect(outermostFrame(nested, 'a')).toBe('f3')
    expect(outermostFrame(nested, 'x')).toBeUndefined()
  })

  it('a deleted tile leaves its frame; frames emptied by it go too, nested ones included', () => {
    const nested: CanvasFrame[] = [g2, { id: 'f3', label: 'G3', members: ['f2'] }]
    expect(withoutTiles(nested, new Set(['c']))).toEqual([])
  })
})
