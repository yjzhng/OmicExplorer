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
  /** the distance each merge happened at, in merge order (UPGMA linkage height) */
  height: number[]
  /** number of leaves */
  n: number
}

/** How clusters' distances are joined: `average` (UPGMA, the default); `ward` (Ward's minimum
 *  variance — scipy's `method='ward'`: each merge is the one that least raises the within-cluster
 *  sum of squares, so clusters come out compact and even-sized rather than one sprawling cluster
 *  with outliers chained on); or `complete` (the farthest pair — pheatmap's default: tight
 *  clusters, every member near every other). */
export type Linkage = 'average' | 'ward' | 'complete'

/** How the tree's leaves are laid out — at each merge either branch can go first:
 *  - `mean`: in increasing order of the branches' mean weight (`weights`) — R's `heatmap()`
 *    (`reorder.dendrogram` by row means), so neighbouring clusters run low → high;
 *  - `optimal`: whichever flips make the summed distance between neighbouring rows smallest —
 *    optimal leaf ordering (Bar-Joseph et al. 2001; scipy's `optimal_leaf_ordering`), the
 *    smoothest layout the tree allows. With `weights`, the whole order then runs low → high. */
export type LeafOrder = 'mean' | 'optimal'

export interface ClusterOrderOptions {
  /** one per row, for the `mean` leaf order (and the direction of the `optimal` one); without
   *  them, `mean` keeps the order the merges happened in */
  weights?: number[]
  linkage?: Linkage
  /** default `mean` */
  leafOrder?: LeafOrder
}

/** Return a row ordering that places similar rows adjacent (dendrogram leaf order). */
export function clusterRowOrder(rows: number[][], opts: ClusterOrderOptions = {}): number[] {
  return arrangeLeaves(rows, buildDendrogram(rows, opts), opts)
}

/** One merge of a dendrogram, for drawing: its two children's positions along the leaf axis (a
 *  leaf's position is its index in the leaf order; a subtree's, the midpoint of its children's)
 *  and heights (0 for a leaf), and the height the merge happened at. A child's branch runs from
 *  its own height up to `h`, and a bar at `h` joins the two. */
export interface DendroLink {
  a: number
  b: number
  ha: number
  hb: number
  h: number
  /** the leaf positions each child spans, first to last (a leaf: itself) — a subtree's leaves are
   *  a contiguous block, so a collapsed child can be drawn as a bracket over its rows */
  sa: [number, number]
  sb: [number, number]
}

/** `clusterRowOrder`, also returning the tree it ordered by — its merges in leaf-position space
 *  (see DendroLink), for drawing a dendrogram along the ordered rows. Every leaf order this module
 *  makes only flips branches, so each subtree stays a contiguous block and its links don't cross. */
export function clusterRowTree(
  rows: number[][],
  opts: ClusterOrderOptions = {}
): { order: number[]; links: DendroLink[] } {
  const d = buildDendrogram(rows, opts)
  const order = arrangeLeaves(rows, d, opts)
  const pos = new Float64Array(2 * d.n)
  const ht = new Float64Array(2 * d.n)
  const lo = new Float64Array(2 * d.n)
  const hi = new Float64Array(2 * d.n)
  order.forEach((leaf, i) => (pos[leaf] = lo[leaf] = hi[leaf] = i))
  const links: DendroLink[] = []
  // A merge's children always have lower ids, so their positions are known first.
  for (let i = 0; i < d.childA.length; i++) {
    const a = d.childA[i]
    const b = d.childB[i]
    const k = d.n + i
    pos[k] = (pos[a] + pos[b]) / 2
    ht[k] = d.height[i]
    lo[k] = Math.min(lo[a], lo[b])
    hi[k] = Math.max(hi[a], hi[b])
    links.push({
      a: pos[a],
      b: pos[b],
      ha: ht[a],
      hb: ht[b],
      h: d.height[i],
      sa: [lo[a], hi[a]],
      sb: [lo[b], hi[b]]
    })
  }
  return { order, links }
}

/** The tree's leaf order under `opts.leafOrder` (see LeafOrder). */
function arrangeLeaves(rows: number[][], d: Dendrogram, opts: ClusterOrderOptions): number[] {
  if (opts.leafOrder !== 'optimal' || d.childA.length === 0) return d.order
  const order = optimalLeafOrder(rows, d)
  // the whole order runs low → high mean weight (the optimal order is the same either way round)
  const w = opts.weights
  if (w) {
    const half = Math.floor(order.length / 2)
    let lo = 0
    let hi = 0
    for (let k = 0; k < half; k++) {
      lo += w[order[k]]
      hi += w[order[order.length - 1 - k]]
    }
    if (lo > hi) order.reverse()
  }
  return order
}

/**
 * Optimal leaf ordering of a dendrogram (Bar-Joseph, Gifford & Jaakkola 2001): of the 2ⁿ⁻¹ layouts
 * the tree allows (either branch first at every merge), the one whose neighbouring rows have the
 * smallest summed euclidean distance. M[i][j] is the best cost of laying out the subtree where
 * leaves i and j meet (their lowest common ancestor) from i to j; a node joining subtrees w and x
 * takes, for i in w and j in x, the best i → h (h in the other branch of w from i), the step
 * h → l, and l → j (l in the other branch of x from j). Cost O(n³) time, O(n²) memory.
 */
function optimalLeafOrder(rows: number[][], d: Dendrogram): number[] {
  const { n, childA, childB } = d
  const m = rows[0]?.length ?? 0
  const S = new Float64Array(n * n)
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      let s = 0
      for (let k = 0; k < m; k++) {
        const v = rows[i][k] - rows[j][k]
        s += v * v
      }
      S[i * n + j] = S[j * n + i] = Math.sqrt(s)
    }
  // each node's leaves (a merge's children always have lower ids, so are listed first)
  const leaves: number[][] = []
  for (let i = 0; i < n; i++) leaves.push([i])
  for (let k = 0; k < childA.length; k++) leaves.push([...leaves[childA[k]], ...leaves[childB[k]]])
  const M = new Float64Array(n * n)
  // scratch: a leaf's position in the current x branch; a branch's positions and costs
  const pos = new Int32Array(n)
  const at = new Int32Array(n)
  const mj = new Float64Array(n)
  // which branch of a node each of its leaves is in (0 = A, 1 = B), written per node as needed
  const side = new Uint8Array(n)
  const mark = (id: number): void => {
    if (id < n) return
    for (const i of leaves[childA[id - n]]) side[i] = 0
    for (const i of leaves[childB[id - n]]) side[i] = 1
  }
  /** the leaves of `id` on the other branch from leaf `i` (marked for `id`); a leaf: itself */
  const other = (id: number, i: number): number[] =>
    id < n ? leaves[id] : leaves[side[i] === 0 ? childB[id - n] : childA[id - n]]

  for (let k = 0; k < childA.length; k++) {
    const w = childA[k]
    const x = childB[k]
    const Lw = leaves[w]
    const Lx = leaves[x]
    // T[i][l] = min over h of M[i][h] + S[h][l] — i in w, l in x
    const T = new Float64Array(Lw.length * Lx.length)
    mark(w)
    Lw.forEach((i, a) => {
      const H = other(w, i)
      const K = H.length
      for (let t = 0; t < K; t++) mj[t] = M[i * n + H[t]]
      for (let b = 0; b < Lx.length; b++) {
        const row = Lx[b] * n
        let best = Infinity
        for (let t = 0; t < K; t++) {
          const c = mj[t] + S[row + H[t]]
          if (c < best) best = c
        }
        T[a * Lx.length + b] = best
      }
    })
    // M[i][j] = min over l of T[i][l] + M[l][j]
    mark(x)
    Lx.forEach((l, b) => (pos[l] = b))
    for (const j of Lx) {
      const Lo = other(x, j)
      const K = Lo.length
      for (let t = 0; t < K; t++) {
        at[t] = pos[Lo[t]]
        mj[t] = M[Lo[t] * n + j]
      }
      for (let a = 0; a < Lw.length; a++) {
        const base = a * Lx.length
        let best = Infinity
        for (let t = 0; t < K; t++) {
          const c = T[base + at[t]] + mj[t]
          if (c < best) best = c
        }
        const i = Lw[a]
        M[i * n + j] = M[j * n + i] = best
      }
    }
  }

  // The best ends at the root, then down the tree: each node's i → h, l → j.
  const root = n + childA.length - 1
  let bi = -1
  let bj = -1
  let bc = Infinity
  for (const i of leaves[childA[root - n]])
    for (const j of leaves[childB[root - n]])
      if (M[i * n + j] < bc) {
        bc = M[i * n + j]
        bi = i
        bj = j
      }
  const order: number[] = []
  const stack: Array<[number, number, number]> = [[root, bi, bj]]
  while (stack.length) {
    const [id, i, j] = stack.pop()!
    if (id < n) {
      order.push(i)
      continue
    }
    // w holds i, x holds j
    mark(id)
    const [w, x] =
      side[i] === 0 ? [childA[id - n], childB[id - n]] : [childB[id - n], childA[id - n]]
    mark(w)
    const H = other(w, i)
    mark(x)
    const Lo = other(x, j)
    let bh = -1
    let bl = -1
    let best = Infinity
    for (const h of H)
      for (const l of Lo) {
        const c = M[i * n + h] + S[h * n + l] + M[l * n + j]
        if (c < best) {
          best = c
          bh = h
          bl = l
        }
      }
    // x's part after w's: pushed first, popped last
    stack.push([x, bl, j], [w, i, bh])
  }
  return order
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
  const keep = merges - (target - 1) // perform only the `keep` LOWEST merges → `target` components
  // Cut by merge HEIGHT, not by the order merges were recorded in. The nearest-neighbour-chain
  // algorithm doesn't emit merges in ascending height, so "undo the last k−1 recorded merges" can
  // undo a merge from deep inside the tree — with tied heights it visibly splits two identical
  // points while leaving two distant groups together. Average linkage is monotonic (a parent is
  // never lower than its children), so selecting the lowest `keep` heights always cuts the tree at
  // one level. Ties break by merge index, so the result is deterministic.
  const applied = new Uint8Array(merges)
  const byHeight = Array.from({ length: merges }, (_, i) => i).sort(
    (x, y) => d.height[x] - d.height[y] || x - y
  )
  for (let i = 0; i < keep; i++) applied[byHeight[i]] = 1
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
  // Recorded order still drives the `rep` walk: a merge's children always have lower ids, so each
  // node's representative leaf is known before any parent needs it.
  for (let i = 0; i < merges; i++) {
    const a = d.childA[i]
    const b = d.childB[i]
    rep[n + i] = rep[a]
    if (applied[i]) {
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

function buildDendrogram(
  rows: number[][],
  { weights, linkage = 'average' }: ClusterOrderOptions = {}
): Dendrogram {
  const ward = linkage === 'ward'
  const complete = linkage === 'complete'
  const n = rows.length
  if (n <= 2) return { order: rows.map((_, i) => i), childA: [], childB: [], height: [], n }
  const m = rows[0]?.length ?? 0

  // The full symmetric euclidean distance matrix (squared for Ward, whose update works on
  // squares) in ONE buffer, row i at i·n — not n arrays of n, whose allocation (and the garbage
  // collection it set off) cost more than the clustering on a busy UI thread. Kept square, not a
  // triangle: the nearest-neighbour scan reads a whole row, and a row in order is the fast read.
  const D = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    const a = rows[i]
    for (let j = i + 1; j < n; j++) {
      const b = rows[j]
      let s = 0
      for (let k = 0; k < m; k++) {
        const d = a[k] - b[k]
        s += d * d
      }
      const dist = ward ? s : Math.sqrt(s)
      D[i * n + j] = dist
      D[j * n + i] = dist
    }
  }

  const active = new Uint8Array(n).fill(1)
  const size = new Float64Array(n).fill(1)
  const node = new Int32Array(n) // node id currently occupying each slot
  for (let i = 0; i < n; i++) node[i] = i
  const childA: number[] = [] // per internal node (id − n): its two children
  const childB: number[] = []
  const height: number[] = [] // the distance each merge happened at
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
    const rowA = a * n
    for (let j = 0; j < n; j++) {
      if (!active[j] || j === a) continue
      const d = D[rowA + j]
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
      height.push(ward ? Math.sqrt(bd) : bd)
      node[lo] = nextId++
      const nl = size[lo]
      const nh = size[hi]
      const denom = nl + nh
      const rowLo = lo * n
      const rowHi = hi * n
      for (let k = 0; k < n; k++) {
        if (!active[k] || k === lo || k === hi) continue
        // Lance-Williams: UPGMA, Ward on squared distances, or complete (the farther)
        const nk = size[k]
        const dl = D[rowLo + k]
        const dh = D[rowHi + k]
        const merged = ward
          ? ((nl + nk) * dl + (nh + nk) * dh - nk * bd) / (denom + nk)
          : complete
            ? Math.max(dl, dh)
            : (nl * dl + nh * dh) / denom
        D[rowLo + k] = merged
        D[k * n + lo] = merged
      }
      size[lo] = denom
      active[hi] = 0
      remaining--
    } else {
      chain.push(b)
    }
  }

  // Each node's mean weight (a merge's children always have lower ids, so are known first).
  let mean: Float64Array | null = null
  if (weights) {
    const sum = new Float64Array(nextId)
    const cnt = new Float64Array(nextId)
    for (let i = 0; i < n; i++) {
      sum[i] = weights[i]
      cnt[i] = 1
    }
    for (let i = 0; i < childA.length; i++) {
      sum[n + i] = sum[childA[i]] + sum[childB[i]]
      cnt[n + i] = cnt[childA[i]] + cnt[childB[i]]
    }
    mean = sum.map((v, i) => v / cnt[i])
  }
  // In-order DFS of the merge tree → leaf order (children in recorded order, or by mean weight).
  const order: number[] = []
  const stack: number[] = [nextId - 1] // root
  while (stack.length) {
    const id = stack.pop() as number
    if (id < n) {
      order.push(id)
      continue
    }
    const idx = id - n
    let a = childA[idx]
    let b = childB[idx]
    if (mean && mean[b] < mean[a]) [a, b] = [b, a]
    stack.push(b) // push B then A so A is visited first
    stack.push(a)
  }
  return { order, childA, childB, height, n }
}

/**
 * Suggest a cluster count from where the dendrogram jumps: sort the merge heights ascending and
 * find the largest gap between consecutive merges in the upper part of the tree. Merging across a
 * big gap joins two groups that are much further apart than anything joined so far, so the number
 * of components still standing just below it is a natural k.
 *
 * Only the top `maxK - 1` merges are considered — the biggest gap in a dendrogram is often the very
 * last merge (k = 2), which is a true answer but rarely a useful one, and low merges are noise
 * between near-identical replicates.
 */
export function suggestClusterCount(rows: number[][], maxK = 8): number {
  const n = rows.length
  if (n <= 2) return 1
  const heights = [...buildDendrogram(rows).height].sort((a, b) => a - b)
  if (heights.length < 2) return 1
  // heights[i] is the merge that takes the tree from (n - i) components to (n - i - 1).
  const top = Math.min(maxK - 1, heights.length - 1)
  let bestGap = -Infinity
  let bestK = 1
  for (let i = heights.length - top; i < heights.length; i++) {
    const gap = heights[i] - heights[i - 1]
    if (gap > bestGap) {
      bestGap = gap
      // Cutting BELOW merge i leaves (n - i) components standing.
      bestK = n - i
    }
  }
  return Math.max(1, Math.min(bestK, n))
}
