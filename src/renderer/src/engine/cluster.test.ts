import { describe, it, expect } from 'vitest'
import { clusterRowOrder } from './cluster'

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
