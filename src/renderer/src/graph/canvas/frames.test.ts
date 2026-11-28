/** Nested canvas frames: grouping keeps selected frames whole; ungrouping hands members back. */
import { describe, expect, it } from 'vitest'

import {
  editMembers,
  frameHolds,
  frameDepths,
  frameLayers,
  frameTiles,
  groupInto,
  outermostFrame,
  topFullFrames,
  ungroupFrom,
  withoutTiles
} from './frames'
import type { CanvasFrame } from '../types'

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

describe('editing a group', () => {
  it('adds an outside tile, taking it out of the group it was in', () => {
    expect(editMembers([g1, g2], 'f1', ['c', 'd'], [])).toEqual([
      { ...g1, members: ['a', 'b', 'c', 'd'] }
    ])
  })

  it('takes a tile out, nested ones included, to the group around the edited one', () => {
    const outer: CanvasFrame = { id: 'f3', label: 'Group 3', members: ['f1', 'f4', 'e'] }
    const inner: CanvasFrame = { id: 'f4', label: 'Group 4', members: ['f2', 'd'] }
    const out = editMembers([g1, g2, outer, inner], 'f4', [], ['c', 'd'])
    // f2 emptied, so dropped; f4 emptied too, so dropped from f3
    expect(out).toEqual([g1, { ...outer, members: ['f1', 'e', 'c', 'd'] }])
  })

  it('adds another group whole, and takes a nested one out whole', () => {
    // f2 (c) joins f1 as a member, nested
    const added = editMembers([g1, g2], 'f1', ['f2'], [])
    expect(added).toEqual([{ ...g1, members: ['a', 'b', 'f2'] }, g2])
    expect(frameHolds(added, 'f1', 'c')).toBe(true)
    // and back out, to no group
    expect(editMembers(added, 'f1', [], ['f2'])).toEqual([g1, g2])
  })

  it('never adds a group holding the edited one, nor the edited one itself', () => {
    const outer: CanvasFrame = { id: 'f3', label: 'Group 3', members: ['f1', 'd'] }
    const frames = [g1, outer]
    expect(editMembers(frames, 'f1', ['f3', 'f1'], [])).toBe(frames)
  })

  it('ignores a tile already where it would go, and an unknown group', () => {
    expect(editMembers([g1, g2], 'f1', ['a'], ['c'])).toEqual([g1, g2])
    const frames = [g1]
    expect(editMembers(frames, 'nope', ['c'], [])).toBe(frames)
  })
})

describe('frameLayers', () => {
  it('stacks each group, frame then tiles, a later group over an earlier, all under loose tiles', () => {
    const frames = [
      { id: 'f1', label: 'A', members: ['a', 'f2'] },
      { id: 'f2', label: 'A2', members: ['b'] },
      { id: 'f3', label: 'A_copy', members: ['c'] }
    ]
    const { frameZ, tileZ } = frameLayers(frames)
    const z = (m: Map<string, number>, id: string): number => m.get(id)!
    // within a group: frame < nested frame < its tiles
    expect(z(frameZ, 'f1')).toBeLessThan(z(frameZ, 'f2'))
    expect(z(frameZ, 'f2')).toBeLessThan(z(tileZ, 'a'))
    expect(z(tileZ, 'a')).toBe(z(tileZ, 'b'))
    // the later group's frame over the earlier group's tiles
    expect(z(frameZ, 'f3')).toBeGreaterThan(z(tileZ, 'b'))
    expect(z(tileZ, 'c')).toBeGreaterThan(z(frameZ, 'f3'))
    // every group under an ungrouped tile (0)
    expect(z(tileZ, 'c')).toBeLessThan(0)
  })
})
