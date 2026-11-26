import { describe, expect, it } from 'vitest'

import { pickTop } from './topPick'

describe('pickTop: proportional (default)', () => {
  const side = (prefix: string, n: number, sign: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, signed: sign * (10 - i * 0.1) }))

  it('splits the top N in proportion to each side', () => {
    // 70 up / 30 down → 10 picks split 7:3, even though the down side has the larger magnitudes
    const up = side('u', 70, 1)
    const down = side('d', 30, -1).map((c) => ({ ...c, signed: c.signed * 3 }))
    const got = pickTop([...up, ...down], 10)
    expect(got.filter((id) => id.startsWith('u'))).toHaveLength(7)
    expect(got.filter((id) => id.startsWith('d'))).toHaveLength(3)
    // within a side, the largest first
    expect(got).toContain('u0')
    expect(got).toContain('d0')
  })

  it('hands a short side’s slots to the other, and returns everything when N covers it', () => {
    const cands = [...side('u', 2, 1), ...side('d', 1, -1)]
    expect(pickTop(cands, 10)).toHaveLength(3)
    // a 1-gene side gives what it has; the rest go to the other side
    const lopsided = [...side('u', 9, 1), ...side('d', 1, -1)]
    const got = pickTop(lopsided, 4)
    expect(got.filter((id) => id.startsWith('d'))).toEqual(['d0'])
    expect(got).toHaveLength(4)
  })

  it('gives each side at least a quarter, rounded up', () => {
    // 96:4 of 10 would round to 10:0; the floor keeps ceil(10 / 4) = 3 for down
    const got = pickTop([...side('u', 96, 1), ...side('d', 4, -1)], 10)
    expect(got.filter((id) => id.startsWith('d'))).toHaveLength(3)
    expect(got.filter((id) => id.startsWith('u'))).toHaveLength(7)
  })
})

describe('pickTop: by size', () => {
  it('takes the largest |score| whichever side', () => {
    const cands = [
      { id: 'u1', signed: 5 },
      { id: 'u2', signed: 4 },
      { id: 'u3', signed: 3 },
      { id: 'd1', signed: -1 }
    ]
    expect(pickTop(cands, 3, { by: 'size' })).toEqual(['u1', 'u2', 'u3'])
  })
})

describe('pickTop: fixed per side', () => {
  const side = (prefix: string, n: number, sign: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, signed: sign * (10 - i) }))
  it('keeps the declared count each way, no hand-off', () => {
    const got = pickTop([...side('u', 9, 1), ...side('d', 1, -1)], 0, {
      by: 'fixed',
      up: 2,
      down: 3
    })
    expect(got.filter((id) => id.startsWith('u'))).toEqual(['u0', 'u1'])
    expect(got.filter((id) => id.startsWith('d'))).toEqual(['d0'])
  })
  it('a side set to 0 is left out; N still caps the total', () => {
    const cands = [...side('u', 5, 1), ...side('d', 5, -1)]
    expect(pickTop(cands, 0, { by: 'fixed', up: 0, down: 2 })).toEqual(['d0', 'd1'])
    expect(pickTop(cands, 3, { by: 'fixed', up: 5, down: 5 })).toHaveLength(3)
  })
})
