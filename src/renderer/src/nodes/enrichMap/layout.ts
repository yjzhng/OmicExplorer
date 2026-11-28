/** The enrichment map's layout: a flow of the enriched terms out of the levels their source files
 *  them under (KEGG category › group, GO aspect, …) into the terms — GO terms nested inside their
 *  enriched ancestors — and on into the gene modules that gather them, on the right. Pure: the
 *  graph (buildMap), then its geometry in px (layoutMap); MapView draws it.
 *
 *  - A node is as tall as its hit genes (a term's own; a level's, every term under it; a module's,
 *    every term in it), at one scale for the whole map.
 *  - A ribbon carries the genes its two nodes share. Ribbons into one node OVERLAP on its genes
 *    rather than stack, so a node keeps its true height and overlap reads as depth: a term filed
 *    under two groups takes two full-height ribbons, one over the other.
 *  - A ribbon leaves and arrives where its genes sit on each node's edge; the order of the columns
 *    and of every edge is searched for the map as a whole (see "order" below).
 *  - A node's parents are reduced to its nearest: a term inside an enriched GO ancestor flows from
 *    that ancestor, not again from the aspect above it. */

export interface MapTermIn {
  term: string
  /** the hit genes (ORA: query genes in the term; GSEA: leading edge), as uniqIDs */
  genes: readonly string[]
  pAdjust: number
  direction: 'up' | 'down' | 'both'
  /** its top-level group (the colour) */
  category?: string
}

export interface MapInput {
  /** the terms to draw, most significant first */
  terms: readonly MapTermIn[]
  /** the source's levels, top first (TermLevels) */
  levels: readonly string[]
  /** term → its paths down the levels (TermLevels) */
  paths: ReadonlyMap<string, string[][]>
  /** term → its gene module (none: absent); unset = no modules column */
  modules?: ReadonlyMap<string, string>
  /** GO term → its ancestors among the tested terms (main/goHierarchy) */
  ancestors?: Readonly<Record<string, readonly string[]>>
  /** a top-level group's place in the source's fixed order (groupOrder.ts) */
  topRank?: (group: string) => number
}

export type MapNodeKind = 'level' | 'module' | 'term'
export interface MapNode {
  id: string
  kind: MapNodeKind
  label: string
  /** a level node's level (0 = the top) */
  level?: number
  /** the term behind a term node */
  term?: MapTermIn
  /** the top-level group it's coloured by (a module: none — its own colour) */
  top?: string
  /** its genes */
  genes: string[]
  /** its genes down each edge (buildMap's order search): where its ribbons arrive, and leave */
  inGenes: string[]
  outGenes: string[]
  parents: string[]
  children: string[]
  col: number
  /** its place in its column, top first */
  order: number
  /** px, set by layoutMap */
  x: number
  y0: number
  y1: number
}
export interface MapLink {
  id: string
  source: string
  target: string
  /** the genes the two nodes share */
  genes: string[]
  /** px, set by layoutMap: the ribbon's strands at its source and at its target, top to bottom —
   *  one strand where its genes lie together on that edge, one per run of them where they don't
   *  (or, stacking, its slot in the node's stack) */
  src: Strand[]
  tgt: Strand[]
}
/** A span of a node's edge, px. */
export interface Strand {
  a: number
  b: number
}
export interface MapGraph {
  nodes: Map<string, MapNode>
  links: MapLink[]
  columns: number
}

const levelId = (i: number, name: string): string => `L${i}:${name}`
export const moduleNodeId = (m: string): string => `M:${m}`
export const termNodeId = (t: string): string => `T:${t}`

/** The map's nodes and ribbons, columns and order — no geometry yet. */
export function buildMap(input: MapInput): MapGraph {
  const nodes = new Map<string, MapNode>()
  const geneSets = new Map<string, Set<string>>()
  const node = (
    id: string,
    kind: MapNodeKind,
    label: string,
    extra?: Partial<MapNode>
  ): MapNode => {
    let n = nodes.get(id)
    if (!n) {
      n = {
        id,
        kind,
        label,
        genes: [],
        inGenes: [],
        outGenes: [],
        parents: [],
        children: [],
        col: 0,
        order: 0,
        x: 0,
        y0: 0,
        y1: 0
      }
      Object.assign(n, extra)
      nodes.set(id, n)
      geneSets.set(id, new Set())
    }
    return n
  }
  const addGenes = (id: string, genes: Iterable<string>): void => {
    const s = geneSets.get(id)!
    for (const g of genes) s.add(g)
  }
  const edge = (p: string, c: string): void => {
    const pn = nodes.get(p)!
    const cn = nodes.get(c)!
    if (!pn.children.includes(c)) pn.children.push(c)
    if (!cn.parents.includes(p)) cn.parents.push(p)
  }
  const shown = new Set(input.terms.map((t) => t.term))
  /** each term's own parents before reduction: its last levels (its enriched GO ancestors join
   *  them below) */
  const base = new Map<string, string[]>()
  /** each term's module: the terms flow on into it, on the right */
  const moduleOf = new Map<string, string>()
  for (const t of input.terms) {
    const tid = termNodeId(t.term)
    node(tid, 'term', t.term, { term: t, top: t.category })
    addGenes(tid, t.genes)
    const lasts: string[] = []
    for (const path of input.paths.get(t.term) ?? []) {
      path.forEach((name, i) => {
        const id = levelId(i, name)
        node(id, 'level', name, { level: i, top: path[0] })
        addGenes(id, t.genes)
        if (i > 0) edge(levelId(i - 1, path[i - 1]), id)
      })
      if (path.length) lasts.push(levelId(path.length - 1, path[path.length - 1]))
    }
    const m = input.modules?.get(t.term)
    if (m !== undefined) {
      const mid = moduleNodeId(m)
      node(mid, 'module', m)
      addGenes(mid, t.genes)
      moduleOf.set(tid, mid)
    }
    base.set(tid, [...new Set(lasts)])
  }
  // every candidate edge into a term — its own parents and its enriched GO ancestors — then each
  // term keeps only its nearest (a candidate that's an ancestor of another candidate goes). An
  // ancestor counts only if it shares a hit gene with the term: annotation lists name the most
  // specific term, so an ancestor can hold none of its child's genes, and nesting with no ribbon
  // would only strand the ancestor in a column of its own
  const cand = new Map<string, string[]>()
  for (const t of input.terms) {
    const tid = termNodeId(t.term)
    const anc = (input.ancestors?.[t.term] ?? [])
      .filter((a) => shown.has(a) && t.genes.some((g) => geneSets.get(termNodeId(a))!.has(g)))
      .map(termNodeId)
    cand.set(tid, [...base.get(tid)!, ...anc])
  }
  const up = (id: string): string[] => [...(nodes.get(id)!.parents ?? []), ...(cand.get(id) ?? [])]
  const ancMemo = new Map<string, Set<string>>()
  const ancestorsOf = (id: string): Set<string> => {
    const hit = ancMemo.get(id)
    if (hit) return hit
    const out = new Set<string>()
    ancMemo.set(id, out)
    for (const p of up(id)) {
      out.add(p)
      for (const a of ancestorsOf(p)) out.add(a)
    }
    return out
  }
  for (const [tid, ps] of cand) {
    const near = ps.filter((p) => !ps.some((q) => q !== p && ancestorsOf(q).has(p)))
    for (const p of near) edge(p, tid)
  }
  // every term in a module flows into it (a GO ancestor and its child both, each with its genes)
  for (const [tid, mid] of moduleOf) edge(tid, mid)
  for (const [id, s] of geneSets) nodes.get(id)!.genes = [...s]

  // ribbons: the genes each pair shares; a term's genes no ribbon brings (a GO child's hits its
  // ancestor wasn't annotated with) come from its own parent, so every gene arrives somewhere
  const links: MapLink[] = []
  const link = (p: string, c: string, genes: string[]): void => {
    links.push({
      id: `${p}\u0001${c}`,
      source: p,
      target: c,
      genes,
      src: [],
      tgt: []
    })
  }
  for (const n of nodes.values())
    for (const c of n.children) {
      const cs = geneSets.get(c)!
      const shared = n.genes.filter((g) => cs.has(g))
      if (shared.length) link(n.id, c, shared)
    }
  for (const [tid, own] of base) {
    const n = nodes.get(tid)!
    const arrived = new Set(links.filter((l) => l.target === tid).flatMap((l) => l.genes))
    const missing = n.genes.filter((g) => !arrived.has(g))
    const from = own.find((p) => !n.parents.includes(p)) ?? null
    if (missing.length && from) {
      edge(from, tid)
      link(from, tid, missing)
    }
  }

  // columns: a level at its level, then the terms — each after its parents, the terms nothing
  // nests in at the right of them, an enriched GO ancestor just before the nearest term inside it —
  // and the modules last, on the right
  const depth = input.levels.length
  const isTerm = (id: string): boolean => nodes.get(id)!.kind === 'term'
  const colMemo = new Map<string, number>()
  const colOf = (n: MapNode): number => {
    const hit = colMemo.get(n.id)
    if (hit !== undefined) return hit
    const c =
      n.kind === 'level'
        ? n.level!
        : Math.max(depth, ...n.parents.map((p) => colOf(nodes.get(p)!) + 1))
    colMemo.set(n.id, c)
    return c
  }
  let termLast = depth
  for (const n of nodes.values()) if (n.kind === 'term') termLast = Math.max(termLast, colOf(n))
  const rightMemo = new Map<string, number>()
  const rightOf = (n: MapNode): number => {
    const hit = rightMemo.get(n.id)
    if (hit !== undefined) return hit
    const kids = n.children.filter(isTerm)
    const c = kids.length
      ? Math.max(colOf(n), Math.min(...kids.map((k) => rightOf(nodes.get(k)!))) - 1)
      : termLast
    rightMemo.set(n.id, c)
    return c
  }
  for (const n of nodes.values())
    n.col = n.kind === 'term' ? rightOf(n) : n.kind === 'module' ? termLast + 1 : colOf(n)
  // drop a term column left empty
  const used = [...new Set([...nodes.values()].map((n) => n.col))].sort((a, b) => a - b)
  const at = new Map(used.map((c, i) => [c, i]))
  for (const n of nodes.values()) n.col = at.get(n.col)!
  const columns = used.length

  const g: MapGraph = { nodes, links, columns }
  seedOrder(g, input)
  optimiseOrder(g)
  return g
}

// ── order ─────────────────────────────────────────────────────────────────────────────────────
// The map's order is two kinds of choice: each column's nodes top to bottom, and — at each edge of
// each node — its genes top to bottom, which places where every ribbon leaves or arrives. A node's
// two edges are ordered apart (nothing ties them: no ribbon passes through a bar), each by the
// nodes on that side. A clean edge has every ribbon's genes together, in the order of the nodes
// they reach, so nothing there splits or crosses; overlapping terms can make that impossible, and
// then the split falls on the smallest ribbons. The columns are searched as a whole (the top level
// too — a parent may move so its children come out clean), scored on ribbons crossing, ribbons
// split and ribbons running steep.

/** A split ribbon's pieces off its main one cost this much per gene, plus a gene per gene they lie
 *  in from the end of the bar they gather at (piecesOf); a crossing, the two ribbons' genes (their geometric
 *  mean); a ribbon's slope, this much per gene per gene-height of drop. */
const SPLIT_COST = 3
/** …and this much per gene between it and the main piece (its strand's way back to the band). */
const APART_COST = 0.25

/** A ribbon's pieces on an edge `total` genes long (each [start, length], in order), gathered at
 *  the bar's `end`: its place — the middle of its main piece (the longest; of equals, the one
 *  furthest from that end), which is where its band runs — and what its other pieces cost: their
 *  genes, each by how far it lies from that end and from the main piece. So when overlap leaves no
 *  order that keeps every ribbon whole, the pieces gather together at one end of the bar, their
 *  strands peeling off beside the whole ribbons rather than through them — whichever ribbons it
 *  takes, big or small; and splitting a ribbon never moves its place, so it never pays just to move
 *  it toward where it goes. */
function piecesOf(
  pieces: readonly (readonly [number, number])[],
  total: number,
  end: End['end']
): { mid: number; cost: number } {
  const depth = (r: readonly [number, number]): number =>
    end === 'top' ? r[0] : total - r[0] - r[1]
  let main = 0
  for (let i = 1; i < pieces.length; i++) {
    const r = pieces[i]
    const m = pieces[main]
    if (r[1] > m[1] || (r[1] === m[1] && depth(r) > depth(m))) main = i
  }
  const [m0, mLen] = pieces[main]
  let cost = 0
  pieces.forEach((r, i) => {
    if (i === main) return
    const apart = r[0] < m0 ? m0 - r[0] - r[1] : r[0] - m0 - mLen
    cost += r[1] * (SPLIT_COST + depth(r) + APART_COST * apart)
  })
  return { mid: pieces[main][0] + pieces[main][1] / 2, cost }
}
const SLOPE_COST = 0.02
/** Room between nodes in a column, in genes, when placing before there's a scale. */
const GAP_UNITS = 2
/** Passes of the column search. */
const SWAP_PASSES = 4
/** Rounds of edge search and node swaps. */
const ROUNDS = 3
/** An edge's gene groups searched in full up to this many, briefly up to the next, else not. */
const SEARCH_FULL = 30
const SEARCH_MAX = 60
/** Shuffled starts for an edge that can't be untangled. */
const RESTARTS = 6

/** A first order to search from: the top level in the source's order, the rest by the average place
 *  of what they connect to, a few sweeps each way (the barycentre method). */
function seedOrder(g: MapGraph, input: MapInput): void {
  const { nodes, links, columns } = g
  const sig = new Map(input.terms.map((t, i) => [termNodeId(t.term), i]))
  const cols: MapNode[][] = Array.from({ length: columns }, () => [])
  for (const n of nodes.values()) cols[n.col].push(n)
  const rank = input.topRank ?? (() => 0)
  cols.forEach((c) =>
    c.sort((a, b) =>
      a.kind === 'level' && a.level === 0 && b.kind === 'level' && b.level === 0
        ? rank(a.label) - rank(b.label) || a.label.localeCompare(b.label)
        : (sig.get(a.id) ?? -1) - (sig.get(b.id) ?? -1) || b.genes.length - a.genes.length
    )
  )
  const weight = new Map(links.map((l) => [l.id, l.genes.length]))
  const pos = new Map<string, number>()
  cols.forEach((c) => c.forEach((n, i) => pos.set(n.id, (i + 0.5) / c.length)))
  const by = (others: string[], key: (o: string) => string): number | null => {
    let s = 0
    let w = 0
    for (const o of others) {
      const k = weight.get(key(o)) ?? 1
      s += (pos.get(o) ?? 0.5) * k
      w += k
    }
    return w ? s / w : null
  }
  const sweep = (c: MapNode[], key: (n: MapNode) => number | null): void => {
    const keyed = c.map((n, i) => ({ n, k: key(n) ?? (i + 0.5) / c.length, i }))
    keyed.sort((a, b) => a.k - b.k || a.i - b.i)
    c.splice(0, c.length, ...keyed.map((e) => e.n))
    c.forEach((n, i) => pos.set(n.id, (i + 0.5) / c.length))
  }
  for (let it = 0; it < 4; it++) {
    for (let ci = 1; ci < columns; ci++)
      sweep(cols[ci], (n) => by(n.parents, (p) => `${p}\u0001${n.id}`))
    for (let ci = columns - 2; ci >= 0; ci--)
      sweep(cols[ci], (n) => by(n.children, (c) => `${n.id}\u0001${c}`))
  }
  cols.forEach((c) => c.forEach((n, i) => (n.order = i)))
}

/** One edge's gene order: `genes` grouped by the ribbons at that edge they belong to (genes in
 *  just the same ribbons move as one), the groups ordered so each ribbon's genes lie together and
 *  in the order of the nodes the ribbons reach (`ends`, each its genes and that node's place) — a
 *  first order by the highest and lowest of them a group reaches, then (with `search`) each group
 *  tried at every place, kept where the edge scores best, until nothing improves. */
export function edgeOrder(
  genes: readonly string[],
  ends: readonly { genes: ReadonlySet<string>; at: number }[],
  search: boolean
): string[] {
  return orderGroups(
    edgeGroups(genes, ends),
    ends.map((e) => e.at),
    search
  )
}

/** An edge's genes grouped by the ribbons there they belong to (`ends`' gene sets) — which genes
 *  move together; it depends on the ribbons alone, not on where their nodes sit. */
export interface EdgeGroup {
  ends: number[]
  genes: string[]
}
export function edgeGroups(
  genes: readonly string[],
  ends: readonly { genes: ReadonlySet<string> }[]
): EdgeGroup[] {
  const groups = new Map<string, EdgeGroup>()
  for (const gene of genes) {
    const es: number[] = []
    ends.forEach((e, i) => e.genes.has(gene) && es.push(i))
    const key = es.join(',')
    const gr = groups.get(key) ?? groups.set(key, { ends: es, genes: [] }).get(key)!
    gr.genes.push(gene)
  }
  return [...groups.values()]
}

/** The groups ordered for the ribbons' nodes' places (`at`): first by the highest and lowest place a
 *  group reaches, then (with `search`) each tried at every place and kept where the edge scores
 *  best, until nothing improves — budgeted on a crowded edge (a hub of a big map), where the first
 *  order stands more on its own. */
function orderGroups(
  groups: readonly EdgeGroup[],
  at: readonly number[],
  search: boolean
): string[] {
  const keyed = groups.map((gr) => {
    let lo = Infinity
    let hi = Infinity
    if (gr.ends.length) {
      lo = Math.min(...gr.ends.map((i) => at[i]))
      hi = Math.max(...gr.ends.map((i) => at[i]))
    }
    return { gr, lo, hi, shared: gr.ends.length > 1 }
  })
  const byPlace = [...keyed].sort((a, b) => a.lo - b.lo || a.hi - b.hi)
  const first = byPlace.map((k) => k.gr)
  const sweeps = first.length > SEARCH_FULL ? (first.length > SEARCH_MAX ? 0 : 2) : 8
  if (!search || first.length <= 2 || sweeps === 0) return first.flatMap((a) => a.genes)
  // the search from a few first orders, as where it ends depends on where it starts: by place;
  // and the genes shared by ribbons gathered at the bottom, or the top (overlap that can't be
  // untangled is best pieced out at an end); each group — and on a small edge each run of two or
  // three — tried at every place; the best end kept
  const ends = at.map((a) => ({ at: a }))
  const small = first.length <= SEARCH_FULL
  const sharedLast = [...byPlace.filter((k) => !k.shared), ...byPlace.filter((k) => k.shared)].map(
    (k) => k.gr
  )
  const nShared = byPlace.filter((k) => k.shared).length
  const sharedFirst = [
    ...sharedLast.slice(sharedLast.length - nShared),
    ...sharedLast.slice(0, sharedLast.length - nShared)
  ]
  const climb = (start: readonly EdgeGroup[], span: number): [EdgeGroup[], number] => {
    const atoms = [...start]
    let best = edgeCost(atoms, ends)
    for (let sweep = 0; sweep < sweeps; sweep++) {
      let improved = false
      for (let len = 1; len <= span; len++)
        for (let i = 0; i + len <= atoms.length; i++) {
          const run = atoms.splice(i, len)
          let bestAt = i
          for (let j = 0; j <= atoms.length; j++) {
            atoms.splice(j, 0, ...run)
            const c = edgeCost(atoms, ends)
            if (c < best - 1e-9) {
              best = c
              bestAt = j
              improved = true
            }
            atoms.splice(j, len)
          }
          atoms.splice(bestAt, 0, ...run)
        }
      if (!improved) break
    }
    return [atoms, best]
  }
  const starts = small ? [first, sharedLast, sharedFirst] : [first]
  let [bestOrder, bestAll] = climb(first, 1)
  const consider = (start: readonly EdgeGroup[]): void => {
    const [o, c] = climb(start, 1)
    if (c < bestAll - 1e-9) [bestOrder, bestAll] = [o, c]
  }
  starts.slice(1).forEach(consider)
  // where an edge can't be untangled the search has many ends: a few more starts, shuffled (the
  // same each time, so a map lays out the same); then the best polished with runs of two or three
  if (small && splitIn(bestOrder, ends)) {
    let seed = 12345
    const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let r = 0; r < RESTARTS; r++) {
      const sh = [...first]
      for (let i = sh.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1))
        ;[sh[i], sh[j]] = [sh[j], sh[i]]
      }
      consider(sh)
    }
    bestOrder = climb(bestOrder, 3)[0]
  }
  return bestOrder.flatMap((a) => a.genes)
}

/** An edge's cost: each ribbon's pieces (piecesOf), and each pair of ribbons out of the order of
 *  the nodes they reach, how far they're out of it. */
function edgeCost(
  atoms: readonly { ends: number[]; genes: string[] }[],
  ends: readonly { at: number }[]
): number {
  const last = new Array<number>(ends.length).fill(-2)
  const pieces = ends.map((): [number, number][] => [])
  let pos = 0
  atoms.forEach((a, k) => {
    for (const e of a.ends) {
      if (last[e] !== k - 1) pieces[e].push([pos, 0])
      pieces[e][pieces[e].length - 1][1] += a.genes.length
      last[e] = k
    }
    pos += a.genes.length
  })
  const live = ends.map((_, e) => e).filter((e) => pieces[e].length > 0)
  // the pieces gathered at one end of the bar, whichever costs less
  const gathered = (end: End['end']): { mid: number; cost: number }[] =>
    live.map((e) => piecesOf(pieces[e], pos, end))
  const top = gathered('top')
  const bottom = gathered('bottom')
  const sum = (ps: { cost: number }[]): number => ps.reduce((s, p) => s + p.cost, 0)
  const side = sum(top) < sum(bottom) ? top : bottom
  let cost = sum(side)
  const mid = side.map((p) => p.mid)
  // ribbons out of order: over each pair whose nodes run one way and whose genes the other, how
  // far apart the genes are (pair by pair on a small edge — quicker there than sorting)
  const at = live.map((e) => ends[e].at)
  if (live.length <= 32) {
    for (let i = 0; i < live.length; i++)
      for (let j = 0; j < live.length; j++)
        if (at[i] < at[j] && mid[i] > mid[j]) cost += mid[i] - mid[j]
  } else inversions(at, mid, mid, (j, above, count) => (cost += above - count * mid[j]))
  return cost
}

/** Over items in order of `p`, each item j told the sum of `a` over the items before it whose `q`
 *  is greater than its own, and how many — every pair out of order, in O(n log n) (a Fenwick tree
 *  over q's ranks). Items tied on p aren't counted as out of order. */
export function inversions(
  p: ArrayLike<number>,
  q: ArrayLike<number>,
  a: ArrayLike<number>,
  each: (j: number, sumA: number, count: number) => void
): void {
  const n = p.length
  if (n < 2) return
  const byP = new Int32Array(n)
  const byQ = new Int32Array(n)
  for (let i = 0; i < n; i++) byP[i] = byQ[i] = i
  byP.sort((i, j) => p[i] - p[j] || q[i] - q[j])
  byQ.sort((i, j) => q[i] - q[j])
  // q's ranks, ties sharing one
  const rank = new Int32Array(n)
  let r = 0
  for (let k = 0; k < n; k++) {
    if (k === 0 || q[byQ[k]] !== q[byQ[k - 1]]) r++
    rank[byQ[k]] = r
  }
  const sums = new Float64Array(r + 1)
  const counts = new Int32Array(r + 1)
  let totalA = 0
  let total = 0
  for (let m = 0; m < n; m++) {
    const j = byP[m]
    const rj = rank[j]
    let sa = 0
    let c = 0
    for (let k = rj; k > 0; k -= k & -k) {
      sa += sums[k]
      c += counts[k]
    }
    each(j, totalA - sa, total - c)
    for (let k = rj; k <= r; k += k & -k) {
      sums[k] += a[j]
      counts[k] += 1
    }
    totalA += a[j]
    total += 1
  }
}

/** Whether any ribbon is in pieces on an edge ordered `atoms`. */
function splitIn(atoms: readonly EdgeGroup[], ends: readonly unknown[]): boolean {
  const last = new Array<number>(ends.length).fill(-2)
  for (let k = 0; k < atoms.length; k++)
    for (const e of atoms[k].ends) {
      if (last[e] >= 0 && last[e] !== k - 1) return true
      last[e] = k
    }
  return false
}

/** A ribbon's end on an edge: its place there (in genes, from the top) and what its pieces cost
 *  (piecesOf), gathered at its edge's end of the bar. */
interface End {
  mid: number
  cost: number
  /** the end of the bar its edge's pieces gather at */
  end: 'top' | 'bottom'
}

/** Where a ribbon's genes sit on an edge ordered `order` (`place`: its genes' places on it, shared
 *  by the edge's ribbons). */
function endOf(
  order: readonly string[],
  genes: readonly string[],
  place: ReadonlyMap<string, number> = placesOf(order),
  end: End['end'] = 'bottom'
): End {
  const at = genes.map((g) => place.get(g)).filter((i): i is number => i !== undefined)
  if (!at.length) return { mid: 0, cost: 0, end }
  at.sort((a, b) => a - b)
  const pieces: [number, number][] = [[at[0], 1]]
  for (let i = 1; i < at.length; i++) {
    if (at[i] !== at[i - 1] + 1) pieces.push([at[i], 1])
    else pieces[pieces.length - 1][1]++
  }
  return { ...piecesOf(pieces, order.length, end), end }
}

/** The ends of an edge's ribbons (each its genes), the pieces gathered at whichever end of the bar
 *  costs less. */
function endsOf(order: readonly string[], ribbons: readonly (readonly string[])[]): End[] {
  const place = placesOf(order)
  const top = ribbons.map((g) => endOf(order, g, place, 'top'))
  const bottom = ribbons.map((g) => endOf(order, g, place, 'bottom'))
  const sum = (es: End[]): number => es.reduce((s, e) => s + e.cost, 0)
  return sum(top) < sum(bottom) ? top : bottom
}
const placeMemo = new WeakMap<readonly string[], Map<string, number>>()
function placesOf(order: readonly string[]): Map<string, number> {
  let m = placeMemo.get(order)
  if (!m) placeMemo.set(order, (m = new Map(order.map((g, i) => [g, i]))))
  return m
}

/** Search the columns' order: from the seed, every neighbouring pair in every column swapped and
 *  kept swapped when the map scores better, a few passes (fewer on a big map) — the map scored on
 *  ribbons crossing, split at either end, and running steep, in gene units, with nodes stacked
 *  GAP_UNITS apart. Ribbons cross in a gap between two columns, so each gap counts every ribbon
 *  passing through it, a long one (aspect → term, past a GO ancestor's column) too. A swap moves
 *  only its two nodes, so only their neighbours' edges are re-ordered (quickly, meanwhile) — then
 *  every edge is searched in full for the order settled on. */
function optimiseOrder(g: MapGraph): void {
  const cols: MapNode[][] = Array.from({ length: g.columns }, () => [])
  for (const n of g.nodes.values()) cols[n.col].push(n)
  cols.forEach((c) => c.sort((a, b) => a.order - b.order))
  const linksOut = new Map<string, MapLink[]>()
  const linksIn = new Map<string, MapLink[]>()
  for (const l of g.links) {
    ;(linksOut.get(l.source) ?? linksOut.set(l.source, []).get(l.source)!).push(l)
    ;(linksIn.get(l.target) ?? linksIn.set(l.target, []).get(l.target)!).push(l)
  }
  // where each node will sit (the middle of it, in gene units): the tallest column stacked; every
  // other column — shorter, so it has room to move — its nodes where their ribbons pull them (as
  // layoutMap's relaxation will), columns outward from the tallest, kept in order and apart
  const heightOf = (c: MapNode[]): number =>
    c.reduce((s, n) => s + n.genes.length, 0) + GAP_UNITS * (c.length - 1)
  const tallest = cols.reduce((b, c, i) => (heightOf(c) > heightOf(cols[b]) ? i : b), 0)
  const outward = cols
    .map((_, i) => i)
    .sort((a, b) => Math.abs(a - tallest) - Math.abs(b - tallest))
  const mids = new Map<string, number>()
  const place = (): void => {
    let y = 0
    for (const n of cols[tallest]) {
      mids.set(n.id, y + n.genes.length / 2)
      y += n.genes.length + GAP_UNITS
    }
    const placed = new Set(cols[tallest].map((n) => n.id))
    for (const ci of outward.slice(1)) {
      const c = cols[ci]
      const want = c.map((n, i) => {
        let s = 0
        let w = 0
        for (const l of [...(linksIn.get(n.id) ?? []), ...(linksOut.get(n.id) ?? [])]) {
          const o = l.source === n.id ? l.target : l.source
          if (!placed.has(o)) continue
          s += mids.get(o)! * l.genes.length
          w += l.genes.length
        }
        return w ? s / w : (mids.get(n.id) ?? i)
      })
      isotonic(
        want,
        c.map((n) => n.genes.length),
        GAP_UNITS
      ).forEach((y, i) => mids.set(c[i].id, y))
      for (const n of c) placed.add(n.id)
    }
  }
  const at = (id: string): number => mids.get(id)!
  const sets = new Map([...g.nodes.values()].map((n) => [n.id, new Set(n.genes)]))
  const ends = new Map<string, { s: End; t: End }>(
    g.links.map((l) => [
      l.id,
      { s: { mid: 0, cost: 0, end: 'bottom' }, t: { mid: 0, cost: 0, end: 'bottom' } }
    ])
  )
  // each edge's gene groups: fixed by the ribbons, whatever the order — worked out once
  const groupsOf = new Map(
    [...g.nodes.values()].map((n) => [
      n.id,
      {
        out: edgeGroups(
          n.genes,
          n.children.map((id) => ({ genes: sets.get(id)! }))
        ),
        in: edgeGroups(
          n.genes,
          n.parents.map((id) => ({ genes: sets.get(id)! }))
        )
      }
    ])
  )
  const orderNode = (n: MapNode, search: boolean): void => {
    const gr = groupsOf.get(n.id)!
    n.outGenes = n.children.length ? orderGroups(gr.out, n.children.map(at), search) : [...n.genes]
    n.inGenes = n.parents.length ? orderGroups(gr.in, n.parents.map(at), search) : [...n.genes]
    const out = linksOut.get(n.id) ?? []
    const into = linksIn.get(n.id) ?? []
    endsOf(
      n.outGenes,
      out.map((l) => l.genes)
    ).forEach((e, i) => (ends.get(out[i].id)!.s = e))
    endsOf(
      n.inGenes,
      into.map((l) => l.genes)
    ).forEach((e, i) => (ends.get(into[i].id)!.t = e))
  }

  const reorder = (): void => {
    cols.forEach((c) => c.forEach((n, i) => (n.order = i)))
    place()
  }
  reorder()
  // the ribbons through each gap between neighbouring columns: the ones that can cross there
  const L = g.links.length
  const src = g.links.map((l) => g.nodes.get(l.source)!)
  const tgt = g.links.map((l) => g.nodes.get(l.target)!)
  const weight = g.links.map((l) => l.genes.length)
  const gaps = Array.from({ length: Math.max(0, g.columns - 1) }, (_, j) => {
    const ls = g.links.map((_, i) => i).filter((i) => src[i].col <= j && j < tgt[i].col)
    return {
      ls,
      root: ls.map((i) => Math.sqrt(weight[i])),
      p: new Float64Array(ls.length),
      q: new Float64Array(ls.length)
    }
  })
  const sy = new Float64Array(L)
  const ty = new Float64Array(L)
  const score = (): number => {
    let cost = 0
    g.links.forEach((l, i) => {
      const s = src[i]
      const t = tgt[i]
      const e = ends.get(l.id)!
      cost += e.s.cost + e.t.cost
      sy[i] = mids.get(s.id)! - s.genes.length / 2 + e.s.mid
      ty[i] = mids.get(t.id)! - t.genes.length / 2 + e.t.mid
      cost += SLOPE_COST * weight[i] * Math.abs(sy[i] - ty[i])
    })
    // crossings: in each gap, each pair of ribbons whose heights either side of it run opposite
    // ways (a long ribbon's taken along the straight line between its ends), weighted by the two's
    // genes (their geometric mean — separable, so counted by sorting)
    gaps.forEach(({ ls, root, p, q }, j) => {
      if (ls.length < 2) return
      ls.forEach((i, k) => {
        const c0 = src[i].col
        const step = (ty[i] - sy[i]) / (tgt[i].col - c0)
        p[k] = sy[i] + step * (j - c0)
        q[k] = p[k] + step
      })
      inversions(p, q, root, (k, above) => (cost += above * root[k]))
    })
    return cost
  }
  // rounds: every edge searched for where the nodes are, then the nodes swapped for those edges'
  // orders (each swap judged with the edges as they are — the search inside a swap would cost too
  // much), until a round moves nothing
  const all = [...g.nodes.values()]
  const passes = g.links.length > 300 ? 1 : SWAP_PASSES
  for (let round = 0; round < ROUNDS; round++) {
    for (const n of all) orderNode(n, true)
    let best = score()
    let moved = false
    for (let pass = 0; pass < passes; pass++) {
      let improved = false
      for (const c of cols)
        for (let i = 0; i + 1 < c.length; i++) {
          ;[c[i], c[i + 1]] = [c[i + 1], c[i]]
          reorder()
          const sc = score()
          if (sc < best - 1e-9) {
            best = sc
            improved = moved = true
          } else {
            ;[c[i], c[i + 1]] = [c[i + 1], c[i]]
            reorder()
          }
        }
      if (!improved) break
    }
    if (!moved) return
  }
  for (const n of all) orderNode(n, true)
}

/** Heights as near `want` as they can be (least squares, weighted by `size`) while kept in order
 *  and apart: each item's middle at least half of each size plus `gap` below the one before — pool
 *  adjacent violators, on the wanted heights less each item's least offset. */
export function isotonic(want: readonly number[], size: readonly number[], gap: number): number[] {
  const n = want.length
  const off: number[] = []
  for (let i = 0; i < n; i++) off.push(i ? off[i - 1] + (size[i - 1] + size[i]) / 2 + gap : 0)
  const blocks: { v: number; w: number; len: number }[] = []
  for (let i = 0; i < n; i++) {
    let b = { v: want[i] - off[i], w: Math.max(size[i], 1e-6), len: 1 }
    while (blocks.length && blocks[blocks.length - 1].v > b.v) {
      const p = blocks.pop()!
      b = { v: (p.v * p.w + b.v * b.w) / (p.w + b.w), w: p.w + b.w, len: p.len + b.len }
    }
    blocks.push(b)
  }
  const out: number[] = []
  for (const b of blocks) for (let k = 0; k < b.len; k++) out.push(b.v + off[out.length])
  return out
}

// ── geometry ──────────────────────────────────────────────────────────────────────────────────

export interface MapGeometry {
  /** the plot's height, px — more than asked for when the nodes can't fit it legibly (it scrolls) */
  height: number
  /** px per gene */
  scale: number
}

/** The least share of the visible height a column's genes get between them: where labels can't
 *  all fit, the map grows (and scrolls) rather than shrinking the bars to slivers to make room. */
const SCALE_FLOOR_SHARE = 0.5

/** How many passes pull the nodes toward what they connect to, and how far each moves them. */
const RELAX_PASSES = 8
const RELAX_PULL = 0.6

/** Where a ribbon can't leave a node in one piece (its genes apart on that edge, overlapping terms
 *  allowing no better): 'split' — strands off each run of its genes, merging soon after; 'stack' —
 *  that node's ribbons on that edge stacked in the order they go, each thinned so together they
 *  fill the bar exactly, widening to their full size by the far end. */
export type OverlapFallback = 'split' | 'stack'

/** Place the map in a `width` × `height` px area: columns spread across it (`nodeW` wide), the
 *  order searched in buildMap, every node at least `minSlot` px of its column (its label's line)
 *  with `gap` between. Each node then moves toward where its ribbons leave and arrive (a few passes
 *  each way, keeping the order). Sets every node's x / y0 / y1 and every ribbon's strands. */
export function layoutMap(
  g: MapGraph,
  o: {
    width: number
    height: number
    nodeW: number
    gap: number
    minSlot: number
    fallback?: OverlapFallback
  }
): MapGeometry {
  const cols: MapNode[][] = Array.from({ length: g.columns }, () => [])
  for (const n of g.nodes.values()) cols[n.col].push(n)
  cols.forEach((c) => c.sort((a, b) => a.order - b.order))
  const total = (c: MapNode[], k: number): number =>
    c.reduce((s, n) => s + Math.max(n.genes.length * k, o.minSlot), 0) + o.gap * (c.length - 1)
  const fits = (k: number): boolean => cols.every((c) => total(c, k) <= o.height)
  // the scale: the most at which every column fits the height asked for — but never under the
  // floor (the tallest column's genes over half the height), the map then growing to fit
  const genes = Math.max(1, ...cols.map((c) => c.reduce((s, n) => s + n.genes.length, 0)))
  const floor = (SCALE_FLOOR_SHARE * o.height) / genes
  let lo = 0
  let hi = o.height
  if (fits(0))
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2
      if (fits(m)) lo = m
      else hi = m
    }
  const k = Math.max(lo, floor)
  const height = Math.max(o.height, ...cols.map((c) => total(c, k)))
  const step = g.columns > 1 ? (o.width - o.nodeW) / (g.columns - 1) : 0
  const hOf = (n: MapNode): number => Math.max(n.genes.length * k, Math.min(2, o.minSlot))
  const slotOf = (n: MapNode): number => Math.max(hOf(n), o.minSlot)
  const top = new Map<string, number>()
  for (const c of cols) {
    let y = (height - total(c, k)) / 2
    for (const n of c) {
      n.x = n.col * step
      top.set(n.id, y)
      y += slotOf(n) + o.gap
    }
  }
  const place = (c: MapNode[]): void => {
    for (const n of c) {
      const h = hOf(n)
      n.y0 = top.get(n.id)! + (slotOf(n) - h) / 2
      n.y1 = n.y0 + h
    }
  }
  // a column kept in its order, its nodes apart and inside the plot
  const settle = (c: MapNode[]): void => {
    let y = 0
    for (const n of c) {
      const t = Math.max(top.get(n.id)!, y)
      top.set(n.id, t)
      y = t + slotOf(n) + o.gap
    }
    let bottom = height
    for (let i = c.length - 1; i >= 0; i--) {
      const n = c[i]
      const t = Math.min(top.get(n.id)!, bottom - slotOf(n))
      top.set(n.id, t)
      bottom = t - o.gap
    }
  }
  const per = (n: MapNode): number => (n.y1 - n.y0) / (n.genes.length || 1)
  const midOn = (n: MapNode, order: readonly string[], genes: readonly string[]): number =>
    n.y0 + endOf(order, genes).mid * per(n)
  const linksIn = new Map<string, MapLink[]>()
  const linksOut = new Map<string, MapLink[]>()
  for (const l of g.links) {
    ;(linksIn.get(l.target) ?? linksIn.set(l.target, []).get(l.target)!).push(l)
    ;(linksOut.get(l.source) ?? linksOut.set(l.source, []).get(l.source)!).push(l)
  }
  // a node moves so its ribbons run level: each ribbon's end on it toward its end on the other
  // node, weighted by its genes
  const pull = (n: MapNode, dir: 'in' | 'out'): void => {
    const ls = (dir === 'in' ? linksIn : linksOut).get(n.id)
    if (!ls?.length) return
    let s = 0
    let w = 0
    for (const l of ls) {
      const s0 = g.nodes.get(l.source)!
      const t0 = g.nodes.get(l.target)!
      const here = dir === 'in' ? midOn(t0, t0.inGenes, l.genes) : midOn(s0, s0.outGenes, l.genes)
      const there = dir === 'in' ? midOn(s0, s0.outGenes, l.genes) : midOn(t0, t0.inGenes, l.genes)
      s += (there - here) * l.genes.length
      w += l.genes.length
    }
    if (w) top.set(n.id, top.get(n.id)! + (s / w) * RELAX_PULL)
  }
  cols.forEach(place)
  for (let it = 0; it < RELAX_PASSES; it++) {
    for (let ci = g.columns - 2; ci >= 0; ci--) {
      for (const n of cols[ci]) pull(n, 'out')
      settle(cols[ci])
      place(cols[ci])
    }
    for (let ci = 1; ci < g.columns; ci++) {
      for (const n of cols[ci]) pull(n, 'in')
      settle(cols[ci])
      place(cols[ci])
    }
  }

  // each ribbon's strands at each end: the runs of its genes on that edge — or, stacking, one
  // thinned slot in the node's stack
  const runsOn = (n: MapNode, order: readonly string[], genes: readonly string[]): Strand[] => {
    const want = new Set(genes)
    const out: Strand[] = []
    const p = per(n)
    order.forEach((gene, i) => {
      if (!want.has(gene)) return
      const last = out[out.length - 1]
      if (last && Math.abs(last.b - (n.y0 + i * p)) < 1e-6) last.b = n.y0 + (i + 1) * p
      else out.push({ a: n.y0 + i * p, b: n.y0 + (i + 1) * p })
    })
    return out.length ? out : [{ a: n.y0, b: n.y0 }]
  }
  for (const l of g.links) {
    l.src = runsOn(g.nodes.get(l.source)!, g.nodes.get(l.source)!.outGenes, l.genes)
    l.tgt = runsOn(g.nodes.get(l.target)!, g.nodes.get(l.target)!.inGenes, l.genes)
  }
  if ((o.fallback ?? 'stack') === 'stack') {
    const stack = (n: MapNode, ls: MapLink[], end: 'src' | 'tgt'): void => {
      if (!ls.some((l) => l[end].length > 1)) return
      const other = (l: MapLink): MapNode => g.nodes.get(end === 'src' ? l.target : l.source)!
      const sorted = [...ls].sort((a, b) => other(a).y0 - other(b).y0)
      const sum = sorted.reduce((s, l) => s + l.genes.length, 0)
      let y = n.y0
      for (const l of sorted) {
        const h = ((n.y1 - n.y0) * l.genes.length) / (sum || 1)
        l[end] = [{ a: y, b: y + h }]
        y += h
      }
    }
    for (const n of g.nodes.values()) {
      stack(n, linksOut.get(n.id) ?? [], 'src')
      stack(n, linksIn.get(n.id) ?? [], 'tgt')
    }
  }
  return { height, scale: k }
}
