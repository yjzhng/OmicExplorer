/**
 * Editing a group: what it holds reads as selected, and a click takes a tile or group in or out.
 */
import { describe, expect, it } from 'vitest'

import { editHolds, toggleMark, type FrameEdit } from './frames'
import type { CanvasFrame } from '../types'

// E (edited) holds a, b and the nested group N (holding n1); O, outside, holds o1, o2.
const frames: CanvasFrame[] = [
  { id: 'E', label: 'E', members: ['a', 'b', 'N'] },
  { id: 'N', label: 'N', members: ['n1'] },
  { id: 'O', label: 'O', members: ['o1', 'o2'] }
]
const edit = (add: string[] = [], remove: string[] = []): FrameEdit => ({ id: 'E', add, remove })

describe('editHolds', () => {
  it('reads members as in and everything else as out', () => {
    for (const t of ['a', 'b', 'N', 'n1']) expect(editHolds(frames, edit(), t)).toBe(true)
    for (const t of ['O', 'o1', 'x']) expect(editHolds(frames, edit(), t)).toBe(false)
  })
  it('follows the clicks: a member taken out, an outsider added', () => {
    expect(editHolds(frames, edit([], ['a']), 'a')).toBe(false)
    expect(editHolds(frames, edit(['x']), 'x')).toBe(true)
  })
  it('a group in or out takes its tiles with it', () => {
    expect(editHolds(frames, edit([], ['N']), 'n1')).toBe(false)
    expect(editHolds(frames, edit(['O']), 'o2')).toBe(true)
  })
  it('the edited group itself is not pickable', () => {
    expect(editHolds(frames, edit(), 'E')).toBeNull()
  })
})

describe('toggleMark', () => {
  it('a click inside marks it out, a second click undoes it', () => {
    const once = toggleMark(frames, edit(), 'a')
    expect(once.remove).toEqual(['a'])
    expect(toggleMark(frames, once, 'a').remove).toEqual([])
  })
  it('a click outside marks it in', () => {
    expect(toggleMark(frames, edit(), 'x').add).toEqual(['x'])
  })
  it('a tile inside a group already clicked goes with it', () => {
    const e = toggleMark(frames, edit(), 'O')
    expect(toggleMark(frames, e, 'o1')).toEqual(edit(['O']))
  })
  it('ignores the edited group itself', () => {
    expect(toggleMark(frames, edit(), 'E')).toEqual(edit())
  })
})
