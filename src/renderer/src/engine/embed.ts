/**
 * 2-D sample embeddings for the Cluster plot: PCA, UMAP, or t-SNE. Sample-level
 * (few points), so exact methods are fine. PCA reuses the Jacobi eigensolver, UMAP
 * comes from umap-js, and t-SNE is an inline exact implementation (the npm t-SNE
 * builds don't bundle under Vite). All are seeded so a layout stays put across
 * recomputes of the same input.
 */
import { UMAP } from 'umap-js'

import { jacobiEigenSymmetric } from './stats'

export type ClusterMethod = 'pca' | 'umap' | 'tsne'

export interface Embedding {
  coords: Array<[number, number]>
  /** fraction of variance on each axis — PCA only ([0, 0] for UMAP/t-SNE). */
  varExplained: [number, number]
}

/** Small deterministic PRNG (mulberry32) so seeded runs are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Embed a samples×features matrix to 2-D by the chosen method. */
export function embed2D(matrix: number[][], method: ClusterMethod): Embedding {
  const nS = matrix.length
  const nF = matrix[0]?.length ?? 0
  if (nS < 2 || nF < 1) return { coords: matrix.map(() => [0, 0]), varExplained: [0, 0] }

  if (method === 'umap') {
    const nNeighbors = Math.max(2, Math.min(15, nS - 1))
    const umap = new UMAP({ nComponents: 2, nNeighbors, minDist: 0.1, random: mulberry32(42) })
    const e = umap.fit(matrix)
    return { coords: e.map((p) => [p[0], p[1]]), varExplained: [0, 0] }
  }

  if (method === 'tsne') {
    const perplexity = Math.max(2, Math.min(30, Math.floor((nS - 1) / 3)))
    return { coords: tsne2D(matrix, perplexity), varExplained: [0, 0] }
  }

  return embedPCA(matrix)
}

/**
 * Exact (O(n²)) t-SNE — plenty for the handful of samples here, and dependency-free
 * (the npm t-SNE builds don't bundle cleanly under Vite). Seeded, so layouts are
 * reproducible. Standard van der Maaten scheme: perplexity-calibrated affinities,
 * early exaggeration, momentum + adaptive gains.
 */
function tsne2D(X: number[][], perplexity: number): Array<[number, number]> {
  const n = X.length
  const dim = X[0].length
  const rand = mulberry32(1234)
  const gauss = (): number => {
    let u = 0
    let v = 0
    while (u === 0) u = rand()
    while (v === 0) v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  // pairwise squared euclidean distances
  const D: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let s = 0
      for (let d = 0; d < dim; d++) {
        const diff = X[i][d] - X[j][d]
        s += diff * diff
      }
      D[i][j] = s
      D[j][i] = s
    }
  }

  // P_{j|i}: binary-search precision (beta) per point to match the target perplexity.
  const target = Math.log(perplexity)
  const P: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n))
  const row = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let betaMin = -Infinity
    let betaMax = Infinity
    let beta = 1
    for (let iter = 0; iter < 60; iter++) {
      let sum = 0
      for (let j = 0; j < n; j++) {
        row[j] = i === j ? 0 : Math.exp(-D[i][j] * beta)
        sum += row[j]
      }
      if (sum === 0) sum = 1e-12
      let H = 0
      for (let j = 0; j < n; j++) {
        const p = row[j] / sum
        if (p > 1e-12) H += -p * Math.log(p)
      }
      const diff = H - target
      if (Math.abs(diff) < 1e-5) break
      if (diff > 0) {
        betaMin = beta
        beta = betaMax === Infinity ? beta * 2 : (beta + betaMax) / 2
      } else {
        betaMax = beta
        beta = betaMin === -Infinity ? beta / 2 : (beta + betaMin) / 2
      }
    }
    let sum = 0
    for (let j = 0; j < n; j++) sum += row[j]
    if (sum === 0) sum = 1e-12
    for (let j = 0; j < n; j++) P[i][j] = row[j] / sum
  }
  // symmetrize + normalize, with a floor
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      P[i][j] = Math.max((P[i][j] + P[j][i]) / (2 * n), 1e-12)
    }

  // gradient descent
  const Y = Array.from({ length: n }, () => [gauss() * 1e-2, gauss() * 1e-2])
  const vel = Array.from({ length: n }, () => [0, 0])
  const gains = Array.from({ length: n }, () => [1, 1])
  const ITERS = 500
  const EXAG_UNTIL = 100
  const LR = 200

  for (let iter = 0; iter < ITERS; iter++) {
    const num: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n))
    let qsum = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = Y[i][0] - Y[j][0]
        const dy = Y[i][1] - Y[j][1]
        const q = 1 / (1 + dx * dx + dy * dy)
        num[i][j] = q
        num[j][i] = q
        qsum += 2 * q
      }
    }
    if (qsum === 0) qsum = 1e-12
    const exag = iter < EXAG_UNTIL ? 4 : 1
    const mom = iter < 250 ? 0.5 : 0.8
    for (let i = 0; i < n; i++) {
      let gx = 0
      let gy = 0
      for (let j = 0; j < n; j++) {
        if (i === j) continue
        const mult = (exag * P[i][j] - num[i][j] / qsum) * num[i][j]
        gx += mult * (Y[i][0] - Y[j][0])
        gy += mult * (Y[i][1] - Y[j][1])
      }
      gx *= 4
      gy *= 4
      gains[i][0] = Math.max(
        0.01,
        Math.sign(gx) !== Math.sign(vel[i][0]) ? gains[i][0] + 0.2 : gains[i][0] * 0.8
      )
      gains[i][1] = Math.max(
        0.01,
        Math.sign(gy) !== Math.sign(vel[i][1]) ? gains[i][1] + 0.2 : gains[i][1] * 0.8
      )
      vel[i][0] = mom * vel[i][0] - LR * gains[i][0] * gx
      vel[i][1] = mom * vel[i][1] - LR * gains[i][1] * gy
      Y[i][0] += vel[i][0]
      Y[i][1] += vel[i][1]
    }
    // recenter
    let mx = 0
    let my = 0
    for (let i = 0; i < n; i++) {
      mx += Y[i][0]
      my += Y[i][1]
    }
    mx /= n
    my /= n
    for (let i = 0; i < n; i++) {
      Y[i][0] -= mx
      Y[i][1] -= my
    }
  }
  return Y.map((y) => [y[0], y[1]] as [number, number])
}

/** Classical PCA via the sample Gram matrix (nS×nS) — exact for the few samples here. */
function embedPCA(matrix: number[][]): Embedding {
  const nS = matrix.length
  const G: number[][] = Array.from({ length: nS }, () => new Array(nS).fill(0))
  for (let i = 0; i < nS; i++) {
    const a = matrix[i]
    for (let j = i; j < nS; j++) {
      const b = matrix[j]
      let acc = 0
      for (let f = 0; f < a.length; f++) acc += a[f] * b[f]
      G[i][j] = acc
      G[j][i] = acc
    }
  }
  const { values, vectors } = jacobiEigenSymmetric(G)
  const order = values.map((_, i) => i).sort((a, b) => values[b] - values[a])
  const [k1, k2] = [order[0], order[1] ?? order[0]]
  const total = values.reduce((s, v) => s + Math.max(v, 0), 0) || 1
  const score = (i: number, k: number): number => vectors[i][k] * Math.sqrt(Math.max(values[k], 0))
  return {
    coords: matrix.map((_, i) => [score(i, k1), score(i, k2)]),
    varExplained: [Math.max(values[k1], 0) / total, Math.max(values[k2], 0) / total]
  }
}
