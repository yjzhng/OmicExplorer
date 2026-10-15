import { describe, expect, it } from 'vitest'

import { sizeKeyLevels } from './sizeKey'

describe('sizeKeyLevels', () => {
  it('rounds ¼ and ¾ of the largest outward to whole numbers', () => {
    // ¼ = 2.5 → 2, ¾ = 7.5 → 8
    expect(sizeKeyLevels(10)).toEqual([2, 8])
  })

  it('falls back to halves where whole numbers merge or pass the largest', () => {
    // whole: ¾ = 1.5 → 2 > 1.8; halves: 0.45 → 0.5, 1.35 → 1.5
    expect(sizeKeyLevels(1.8)).toEqual([0.5, 1.5])
  })

  it('keeps one level when even halves cannot make two', () => {
    expect(sizeKeyLevels(0.7)).toEqual([0.5])
    expect(sizeKeyLevels(0.3)).toEqual([0.3])
  })
})
