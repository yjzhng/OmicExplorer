import { describe, expect, it } from 'vitest'

import { jacobiEigenSymmetric } from './stats'

/** Deterministic PRNG so the planted matrices are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('jacobiEigenSymmetric', () => {
  it('2×2 [[2,1],[1,2]] → {3, 1}', () => {
    const { values } = jacobiEigenSymmetric([
      [2, 1],
      [1, 2]
    ])
    const s = [...values].sort((a, b) => b - a)
    expect(s[0]).toBeCloseTo(3, 8)
    expect(s[1]).toBeCloseTo(1, 8)
  })

  // Regression: the eigensolver must recover a dominant eigenvalue at realistic sample counts.
  // A prior implementation silently failed for n beyond a handful — it preserved the trace but
  // smeared the dominant axis across many components, so PCA on ~90 samples reported PC1 ≈ 4%
  // when a single group axis actually held >50% of the variance.
  for (const n of [8, 30, 60, 93, 150]) {
    it(`n=${n}: recovers a planted dominant eigenvalue (50·uuᵀ + I)`, () => {
      const rnd = rng(n * 7 + 1)
      const u = Array.from({ length: n }, () => rnd() - 0.5)
      const nrm = Math.sqrt(u.reduce((s, v) => s + v * v, 0))
      for (let i = 0; i < n; i++) u[i] /= nrm
      const A: number[][] = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => 50 * u[i] * u[j] + (i === j ? 1 : 0))
      )
      const { values, vectors } = jacobiEigenSymmetric(A)
      // Dominant eigenvalue is 50·|u|² + 1 = 51; the rest are 1.
      const order = values.map((_, i) => i).sort((a, b) => values[b] - values[a])
      expect(values[order[0]]).toBeCloseTo(51, 4)
      expect(values[order[1]]).toBeCloseTo(1, 4)
      // Trace preserved (= 50 + n).
      const trace = values.reduce((s, v) => s + v, 0)
      expect(trace).toBeCloseTo(50 + n, 3)
      // Reconstruction A ≈ V·diag(λ)·Vᵀ (checks eigenvectors, not just eigenvalues).
      let maxErr = 0
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          let acc = 0
          for (let k = 0; k < n; k++) acc += vectors[i][k] * values[k] * vectors[j][k]
          maxErr = Math.max(maxErr, Math.abs(acc - A[i][j]))
        }
      }
      expect(maxErr).toBeLessThan(1e-6)
    })
  }
})
