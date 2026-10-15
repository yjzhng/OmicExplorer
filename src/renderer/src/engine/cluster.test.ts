import { describe, it, expect } from 'vitest'
import { clusterRowGroups, clusterRowOrder, clusterRowTree } from './cluster'

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

describe('clusterRowOrder — branches ordered by weight', () => {
  it('lays each merge out low → high mean weight', () => {
    // two tight pairs far apart, given high-first; weights = the values
    const rows = [[10], [10.1], [0], [0.1]]
    const w = rows.map((r) => r[0])
    const order = clusterRowOrder(rows, { weights: w })
    expect(order.map((i) => w[i])).toEqual([0, 0.1, 10, 10.1])
    // the same tree, reversed weights → reversed layout
    expect(clusterRowOrder(rows, { weights: w.map((v) => -v) }).map((i) => w[i])).toEqual([
      10.1, 10, 0.1, 0
    ])
  })
})

describe('clusterRowOrder — optimal leaf ordering', () => {
  const dist = (a: number[], b: number[]): number =>
    Math.sqrt(a.reduce((s, v, k) => s + (v - b[k]) ** 2, 0))
  const cost = (rows: number[][], o: number[]): number =>
    o.slice(1).reduce((s, v, k) => s + dist(rows[o[k]], rows[v]), 0)
  const perms = (a: number[]): number[][] =>
    a.length <= 1
      ? [a]
      : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]))

  it('finds the layout with the smallest neighbour distance the tree allows (brute force)', () => {
    let seed = 5
    const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let t = 0; t < 40; t++) {
      const n = 3 + (t % 5)
      const rows = Array.from({ length: n }, () => [rnd() * 4, rnd() * 4])
      // the tree's subtrees (every cut of the average-linkage tree), each contiguous in a layout
      const subtrees: number[][] = []
      for (let k = 1; k <= n; k++) subtrees.push(...clusterRowGroups(rows, k))
      const layouts = perms(rows.map((_, i) => i)).filter((p) =>
        subtrees.every((c) => {
          const at = c.map((i) => p.indexOf(i))
          return Math.max(...at) - Math.min(...at) === c.length - 1
        })
      )
      const best = Math.min(...layouts.map((p) => cost(rows, p)))
      const order = clusterRowOrder(rows, { leafOrder: 'optimal' })
      expect(new Set(order).size).toBe(n)
      expect(cost(rows, order)).toBeCloseTo(best, 9)
    }
  })

  it('runs low → high mean weight with weights', () => {
    const rows = [[5], [0], [5.2], [0.3], [9]]
    const w = rows.map((r) => r[0])
    const order = clusterRowOrder(rows, { leafOrder: 'optimal', weights: w })
    expect(w[order[0]]).toBeLessThan(w[order[order.length - 1]])
  })
})

describe('clusterRowOrder — complete linkage', () => {
  it('clusters points on a line into a monotone layout', () => {
    const rows = [[0], [1], [2], [3], [4.5]]
    const order = clusterRowOrder(rows, { linkage: 'complete', weights: rows.map((r) => r[0]) })
    expect(order).toEqual([0, 1, 2, 3, 4])
  })
})

describe('clusterRowTree (dendrogram links in leaf-position space)', () => {
  const rows = [
    [0, 0],
    [100, 100],
    [1, 0],
    [101, 100],
    [0, 1],
    [100, 101]
  ]

  it.each(['mean', 'optimal'] as const)(
    'orders as clusterRowOrder (%s leaf order)',
    (leafOrder) => {
      const w = rows.map((r) => r[0])
      const opts = { linkage: 'ward' as const, leafOrder, weights: w }
      expect(clusterRowTree(rows, opts).order).toEqual(clusterRowOrder(rows, opts))
    }
  )

  it('has one link per merge, branches never above their merge, the root on top', () => {
    const { links } = clusterRowTree(rows, { linkage: 'ward' })
    expect(links).toHaveLength(rows.length - 1)
    for (const l of links) {
      expect(l.ha).toBeLessThanOrEqual(l.h)
      expect(l.hb).toBeLessThanOrEqual(l.h)
      for (const x of [l.a, l.b]) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(rows.length - 1)
      }
    }
    const root = links.reduce((m, l) => (l.h > m.h ? l : m))
    // the two far groups join last, each a contiguous block of three (rows 0–2 and 3–5): each
    // side of the root stands inside its own block
    const [lo, hi] = [root.a, root.b].sort((x, y) => x - y)
    expect(lo).toBeGreaterThan(0)
    expect(lo).toBeLessThan(2)
    expect(hi).toBeGreaterThan(3)
    expect(hi).toBeLessThan(5)
  })

  it('leaves sit at their row positions: every leaf is a branch foot at height 0', () => {
    const { links } = clusterRowTree(rows)
    const feet = links
      .flatMap((l) => [
        [l.a, l.ha],
        [l.b, l.hb]
      ])
      .filter(([, h]) => h === 0)
      .map(([x]) => x)
      .sort((x, y) => x - y)
    expect(feet).toEqual(rows.map((_, i) => i))
  })

  it('has no links for ≤2 rows', () => {
    expect(clusterRowTree([[1], [2]]).links).toEqual([])
  })
})
