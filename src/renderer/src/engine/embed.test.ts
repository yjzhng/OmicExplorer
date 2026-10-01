/**
 * 2-D embeddings (PCA / UMAP / t-SNE).
 *
 * The test that matters for all three is the same: given input that IS separated, the embedding
 * must come out separated and on a sane scale. t-SNE previously failed both — its gradient loop
 * moved each point while still computing later points' forces from the affinities of the old
 * positions, so the error compounded down the loop and the layout diverged to ~1e20 with the
 * clusters smeared together. A bounded-scale check alone wouldn't have caught it (the values were
 * finite), and a separation check alone wouldn't either (a diverged layout can look "spread out"),
 * so both are asserted.
 */
import { describe, expect, it } from 'vitest'

import { embed2D, type ClusterMethod } from './embed'

/** Three well-separated blobs: identical but for an offset along the first feature. */
function blobs(perBlob: number, dim: number): { X: number[][]; label: number[] } {
  const X: number[][] = []
  const label: number[] = []
  let seed = 7
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  ;[0, 20, 40].forEach((centre, b) => {
    for (let k = 0; k < perBlob; k++) {
      X.push(Array.from({ length: dim }, (_, d) => (d === 0 ? centre : 0) + rnd() * 0.5))
      label.push(b)
    }
  })
  return { X, label }
}

/** Mean between-blob centroid distance over mean within-blob spread. ~1 means the blobs overlap;
 *  well above 1 means they are resolved. */
function separation(coords: Array<[number, number]>, label: number[]): number {
  const byBlob = new Map<number, Array<[number, number]>>()
  label.forEach((l, i) => {
    if (!byBlob.has(l)) byBlob.set(l, [])
    byBlob.get(l)!.push(coords[i])
  })
  const blobs = [...byBlob.values()]
  const cents = blobs.map((pts) => [
    pts.reduce((a, p) => a + p[0], 0) / pts.length,
    pts.reduce((a, p) => a + p[1], 0) / pts.length
  ])
  const within =
    blobs
      .map((pts, bi) =>
        Math.sqrt(
          pts.reduce((a, p) => a + (p[0] - cents[bi][0]) ** 2 + (p[1] - cents[bi][1]) ** 2, 0) /
            pts.length
        )
      )
      .reduce((a, b) => a + b, 0) / blobs.length
  let between = 0
  let pairs = 0
  for (let i = 0; i < cents.length; i++)
    for (let j = i + 1; j < cents.length; j++) {
      between += Math.hypot(cents[i][0] - cents[j][0], cents[i][1] - cents[j][1])
      pairs++
    }
  return within > 0 ? between / pairs / within : Infinity
}

const METHODS: ClusterMethod[] = ['pca', 'umap', 'tsne']

describe('embed2D', () => {
  for (const method of METHODS) {
    describe(method, () => {
      it('resolves three separated blobs', () => {
        const { X, label } = blobs(5, 10)
        const { coords } = embed2D(X, method)
        expect(coords).toHaveLength(X.length)
        expect(coords.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true)
        expect(separation(coords, label)).toBeGreaterThan(1.5)
      })

      it('stays on a sane scale (a diverged optimiser is still finite)', () => {
        const { X } = blobs(20, 30)
        const { coords } = embed2D(X, method)
        const maxAbs = Math.max(...coords.flat().map(Math.abs))
        expect(Number.isFinite(maxAbs)).toBe(true)
        // Generous: the inputs span ~40, and t-SNE legitimately spreads to the hundreds. Anything
        // past this is an optimiser that ran away, not a layout.
        expect(maxAbs).toBeLessThan(1e5)
      })

      it('is deterministic (seeded) — the same input gives the same layout', () => {
        const { X } = blobs(5, 8)
        expect(embed2D(X, method).coords).toEqual(embed2D(X, method).coords)
      })
    })
  }

  it('degenerates safely on too little data', () => {
    for (const method of METHODS) {
      expect(embed2D([], method).coords).toEqual([])
      expect(embed2D([[1, 2, 3]], method).coords).toEqual([[0, 0]])
      // No features to embed on.
      expect(embed2D([[], []], method).coords).toEqual([
        [0, 0],
        [0, 0]
      ])
    }
  })

  it('reports variance explained for PCA only', () => {
    const { X } = blobs(5, 10)
    expect(embed2D(X, 'pca').varExplained[0]).toBeGreaterThan(0)
    expect(embed2D(X, 'umap').varExplained).toEqual([0, 0])
    expect(embed2D(X, 'tsne').varExplained).toEqual([0, 0])
  })
})
