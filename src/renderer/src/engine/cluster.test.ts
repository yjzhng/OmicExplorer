import { describe, it, expect } from 'vitest'
import { clusterRowGroups, clusterRowOrder } from './cluster'

describe('clusterRowOrder (average-linkage leaf order)', () => {
  it('returns identity for ≤2 rows', () => {
    expect(clusterRowOrder([])).toEqual([])
    expect(clusterRowOrder([[1, 2]])).toEqual([0])
    expect(clusterRowOrder([[1], [9]])).toEqual([0, 1])
  })

  it('is a permutation of all row indices', () => {
    const rows = Array.from({ length: 20 }, (_, i) => [Math.sin(i), Math.cos(i), i % 3])
    const order = clusterRowOrder(rows)
    expect([...order].sort((a, b) => a - b)).toEqual(rows.map((_, i) => i))
  })

  it('places similar rows adjacent (two tight groups)', () => {
    // Two clusters far apart: {0,1,2} near 0, {3,4,5} near 100.
    const rows = [
      [0, 0],
      [0.1, 0.1],
      [0.2, -0.1],
      [100, 100],
      [100.1, 99.9],
      [99.9, 100.2]
    ]
    const order = clusterRowOrder(rows)
    const groupOf = (i: number) => (i < 3 ? 'A' : 'B')
    // The ordering must not interleave the two groups: exactly one A→B boundary.
    const seq = order.map(groupOf).join('')
    const boundaries = seq.split('').filter((g, i) => i > 0 && g !== seq[i - 1]).length
    expect(boundaries).toBe(1)
  })
})

describe('clusterRowGroups cuts by merge height', () => {
  /** Three pairs of IDENTICAL points, the pairs mutually equidistant. Every high merge is tied, so
   *  a cut that trusted the recorded merge order (rather than height) would undo an arbitrary one —
   *  splitting a zero-distance pair while leaving two distant groups together. */
  const symmetric = [
    [0, 0],
    [0, 0],
    [100, 0],
    [100, 0],
    [50, 86.6],
    [50, 86.6]
  ]

  const sorted = (groups: number[][]): number[][] =>
    groups.map((g) => [...g].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0])

  it('cuts three tied groups into exactly the three pairs', () => {
    expect(sorted(clusterRowGroups(symmetric, 3))).toEqual([
      [0, 1],
      [2, 3],
      [4, 5]
    ])
  })

  it('never splits a zero-distance pair before separating distant ones', () => {
    // k=2 must merge two of the pairs, never break one.
    const g2 = sorted(clusterRowGroups(symmetric, 2))
    expect(g2).toHaveLength(2)
    for (const pair of [
      [0, 1],
      [2, 3],
      [4, 5]
    ]) {
      const holding = g2.filter((g) => g.includes(pair[0]) || g.includes(pair[1]))
      expect(holding).toHaveLength(1) // both members in the same group
    }
  })

  it('returns k groups for every k up to n', () => {
    for (let k = 1; k <= symmetric.length; k++)
      expect(clusterRowGroups(symmetric, k)).toHaveLength(k)
  })

  it('partitions every row exactly once, whatever k', () => {
    for (let k = 1; k <= 4; k++) {
      const all = clusterRowGroups(symmetric, k)
        .flat()
        .sort((a, b) => a - b)
      expect(all).toEqual([0, 1, 2, 3, 4, 5])
    }
  })
})
