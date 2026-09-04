/**
 * Hierarchical clustering leaf order for heatmap rows — mirrors omicViz's
 * `scipy.cluster.hierarchy.linkage(pdist(values, 'euclidean'), method='average')`
 * (UPGMA) + leaves_list, used by `scripts/viz/heatmap.py` to cluster genes.
 *
 * Average linkage is *reducible*, so the O(n²) nearest-neighbour-chain algorithm
 * (Müllner 2011) produces a correct dendrogram — no O(n³) generic scan needed.
 * Callers impute missing values first (omicViz fills each column with its mean).
 */

/** The clustering result: the dendrogram leaf order plus the merge tree (child arrays, indexed by
 *  internal-node id − n), so callers can also cut the tree into groups. */
interface Dendrogram {
  order: number[]
  childA: number[]
  childB: number[]
  /** number of leaves */
  n: number
}

/** Return a row ordering that places similar rows adjacent (dendrogram leaf order). */
export function clusterRowOrder(rows: number[][]): number[] {
  return buildDendrogram(rows).order
}

/**
 * Cluster the rows, then cut the dendrogram into (up to) `k` groups, returning each group as a list
 * of row indices in within-group leaf order. Groups are the k subtrees left after undoing the top
 * k−1 merges; each subtree's leaves are a contiguous block of the full leaf order, so within-group
 * clustering is preserved. The caller decides how to order the groups themselves (e.g. by value).
 */
export function clusterRowGroups(rows: number[][], k: number): number[][] {
  const n = rows.length
  if (n === 0) return []
  if (n <= 2 || k <= 1) return [rows.map((_, i) => i)]
  const d = buildDendrogram(rows)
  const merges = d.childA.length // = n − 1
  const target = Math.min(k, n)
  const keep = merges - (target - 1) // perform only the first `keep` merges → `target` components
  // Union-find over the ORIGINAL leaves, applying just the kept (lower) merges.
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]]
    return x
  }
  // A representative original leaf for each node id (leaf → itself; internal → its A-child's rep).
  const rep = new Int32Array(2 * n - 1)
  for (let i = 0; i < n; i++) rep[i] = i
  for (let i = 0; i < merges; i++) {
    const a = d.childA[i]
    const b = d.childB[i]
    rep[n + i] = rep[a]
    if (i < keep) {
      const ra = find(rep[a])
      const rb = find(rep[b])
      if (ra !== rb) parent[ra] = rb
    }
  }
  // Walk the leaf order, collecting one group per root (in first-appearance order).
  const byRoot = new Map<number, number[]>()
  for (const leaf of d.order) {
    const r = find(leaf)
    let g = byRoot.get(r)
    if (!g) byRoot.set(r, (g = []))
    g.push(leaf)
  }
  return [...byRoot.values()]
}

function buildDendrogram(rows: number[][]): Dendrogram {
  const n = rows.length
  if (n <= 2) return { order: rows.map((_, i) => i), childA: [], childB: [], n }
  const m = rows[0]?.length ?? 0

  // Full symmetric euclidean distance matrix.
  const D: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n))
  for (let i = 0; i < n; i++) {
    const a = rows[i]
    for (let j = i + 1; j < n; j++) {
      const b = rows[j]
      let s = 0
      for (let k = 0; k < m; k++) {
        const d = a[k] - b[k]
        s += d * d
      }
      const dist = Math.sqrt(s)
      D[i][j] = dist
      D[j][i] = dist
    }
  }

  const active = new Uint8Array(n).fill(1)
  const size = new Float64Array(n).fill(1)
  const node = new Int32Array(n) // node id currently occupying each slot
  for (let i = 0; i < n; i++) node[i] = i
  const childA: number[] = [] // per internal node (id − n): its two children
  const childB: number[] = []
  let nextId = n

  const chain: number[] = []
  let remaining = n

  while (remaining > 1) {
    if (chain.length === 0) {
      let s = 0
      while (!active[s]) s++
      chain.push(s)
    }
    const a = chain[chain.length - 1]
    const prev = chain.length >= 2 ? chain[chain.length - 2] : -1

    // Nearest active neighbour of `a`; on ties prefer the previous chain member
    // so mutual pairs are detected deterministically.
    let b = -1
    let bd = Infinity
    const Da = D[a]
    for (let j = 0; j < n; j++) {
      if (!active[j] || j === a) continue
      const d = Da[j]
      if (d < bd || (d === bd && j === prev)) {
        bd = d
        b = j
      }
    }

    if (prev !== -1 && b === prev) {
      // a and b are reciprocal nearest neighbours → merge them.
      chain.pop()
      chain.pop()
      const lo = a < b ? a : b
      const hi = a < b ? b : a
      childA.push(node[lo])
      childB.push(node[hi])
      node[lo] = nextId++
      const nl = size[lo]
      const nh = size[hi]
      const Dlo = D[lo]
      const Dhi = D[hi]
      const denom = nl + nh
      for (let k = 0; k < n; k++) {
        if (!active[k] || k === lo || k === hi) continue
        const merged = (nl * Dlo[k] + nh * Dhi[k]) / denom // Lance-Williams (UPGMA)
        Dlo[k] = merged
        D[k][lo] = merged
      }
      size[lo] = denom
      active[hi] = 0
      remaining--
    } else {
      chain.push(b)
    }
  }

  // In-order DFS of the merge tree → leaf order (children in recorded order).
  const order: number[] = []
  const stack: number[] = [nextId - 1] // root
  while (stack.length) {
    const id = stack.pop() as number
    if (id < n) {
      order.push(id)
      continue
    }
    const idx = id - n
    stack.push(childB[idx]) // push B then A so A is visited first
    stack.push(childA[idx])
  }
  return { order, childA, childB, n }
}
