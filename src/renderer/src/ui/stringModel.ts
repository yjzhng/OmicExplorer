/**
 * The STRING network as data: which differential genes are queried, how the reply becomes nodes and
 * edges, what fits the draw budget, and the interaction modules (Markov clustering) with their
 * pathway labels. Shared by the STRING view, which lays it out and draws it, and the background
 * export that writes each facet's node / edge tables to the project's temp folder — so the files
 * hold exactly what the tile shows.
 */
import { benjaminiHochberg, type CompareResultRow } from '../engine'

/** ln Γ(z) via Lanczos, for the hypergeometric log-binomials in the per-module ORA. */
function lnGamma(z: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7
  ]
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z)
  z -= 1
  let x = c[0]
  for (let i = 1; i < 9; i++) x += c[i] / (z + i)
  const t = z + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}
const lnChoose = (n: number, k: number): number =>
  k < 0 || k > n ? -Infinity : lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1)
/** P(X ≥ k) for X ~ Hypergeometric(N, K, n) — the one-tailed Fisher over-representation test. */
function hyperTail(k: number, K: number, n: number, N: number): number {
  if (n === 0 || N === 0) return 1
  const denom = lnChoose(N, n)
  let p = 0
  for (let i = k; i <= Math.min(K, n); i++)
    p += Math.exp(lnChoose(K, i) + lnChoose(N - K, n - i) - denom)
  return Math.min(1, Math.max(0, p))
}

/** One differential gene from the compare result. */
export interface StringGene {
  uniqID: string
  name: string
  log2FC: number
  /** STRING ids from the annotation fetch, one per member protein (a protein group names several;
   *  each is its own node). Empty → the gene is sent by name. */
  stringIds: string[]
}
/** A network node. */
export interface StringNode {
  key: string
  name: string
  /** true = a differential (query) gene; false = a first-shell interactor pulled in for context */
  isQuery: boolean
  log2FC: number
}
export interface StringNet {
  nodes: StringNode[]
  edges: { a: string; b: string; score: number }[]
}

/** Query genes are sent at this multiple of the draw cap (bounded by SEND_MAX), since only the
 *  connected ones can be drawn. */
const SEND_MULT = 4
const SEND_MAX = 400
/** How many genes are SENT to STRING. `maxGenes` caps what's DRAWN, and only connected nodes are
 *  (a lone dot says nothing), so sending exactly that many would draw far fewer — send a multiple
 *  and let the draw cap decide, bounded so a huge significant set can't blow up the query. */
export const stringSendLimit = (maxGenes: number): number =>
  Math.min(SEND_MAX, Math.max(maxGenes * SEND_MULT, maxGenes))

/** Significant genes, one per feature (max |log₂FC|), strongest first, capped to `sendLimit`. */
export function stringQueryGenes(
  rows: CompareResultRow[],
  displayMap: Record<string, string> | undefined,
  annotationMap: Record<string, Record<string, string>> | undefined,
  sendLimit: number
): StringGene[] {
  const dm = displayMap ?? {}
  const am = annotationMap ?? {}
  const best = new Map<string, number>()
  for (const r of rows) {
    if (!r.signf || r.log2FC == null || !Number.isFinite(r.log2FC)) continue
    const prev = best.get(r.uniqID)
    if (prev == null || Math.abs(r.log2FC) > Math.abs(prev)) best.set(r.uniqID, r.log2FC)
  }
  return [...best.entries()]
    .map(([uniqID, log2FC]) => ({
      uniqID,
      name: dm[uniqID] ?? uniqID,
      log2FC,
      stringIds: splitIds(am[uniqID]?.stringId)
    }))
    .sort((a, b) => Math.abs(b.log2FC) - Math.abs(a.log2FC))
    .slice(0, Math.max(2, sendLimit))
}

/** What's sent to STRING: each gene's STRING ids (a protein group's members each), else its name. */
export const stringSendIds = (genes: StringGene[]): string[] =>
  genes.flatMap((g) => (g.stringIds.length ? g.stringIds : [g.name]))

/** The `string:network` reply as a network: query nodes carry the app's display name and log₂FC —
 *  unless the gene is a protein group, whose members each keep STRING's own name for that protein,
 *  as do first-shell interactors (no app-side name). */
export function stringNetFromResponse(
  res: {
    nodes: { id: string; name: string; isQuery: boolean }[]
    edges: { aId: string; bId: string; score: number }[]
  },
  genes: StringGene[]
): StringNet {
  const dispByStringId = new Map(
    genes.filter((g) => g.stringIds.length === 1).map((g) => [g.stringIds[0], g.name])
  )
  const fcByKey = new Map<string, number>()
  for (const g of genes) for (const sid of g.stringIds) fcByKey.set(sid, g.log2FC)
  return {
    nodes: res.nodes.map((n) => ({
      key: n.id,
      name: (n.isQuery ? dispByStringId.get(n.id) : undefined) ?? n.name,
      isQuery: n.isQuery,
      log2FC: n.isQuery ? (fcByKey.get(n.id) ?? 0) : 0
    })),
    edges: res.edges.map((e) => ({ a: e.aId, b: e.bId, score: e.score }))
  }
}

/** A `;`-joined id list (a protein group's STRING ids) → its distinct ids. */
export const splitIds = (raw: string | undefined): string[] => [
  ...new Set(
    (raw ?? '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
  )
]

/** The drawn network: nodes within the budget, the edges between them, and the modules. */
export interface StringModel {
  vis: StringNode[]
  degree: number[]
  eIdx: [number, number][]
  eScore: number[]
  /** interaction modules (≥2 nodes): member node indices and the "module N (pathways)" label */
  territoryGroups: { members: number[]; label: string }[]
  /** which module (territoryGroups index) each node belongs to (−1 = none) */
  moduleByNode: number[]
  /** node key (STRING id) → its gene's uniqID, for query genes */
  uniqByStringId: Map<string, string>
  /** STRING id → uniqID over EVERY gene with annotations (interactors that are themselves genes) */
  uniqByStringIdAll: Map<string, string>
}

/** What a fetched network draws, and its modules — see the comments inside for each rule. */
export function buildStringModel(
  net: StringNet,
  genes: StringGene[],
  annotationMap: Record<string, Record<string, string>> | undefined,
  maxGenes: number
): StringModel {
  // Index nodes by key; build edge index pairs + degree.
  const idxByKey = new Map(net.nodes.map((n, i) => [n.key, i]))
  const degAll = new Array(net.nodes.length).fill(0)
  const eAll: { a: number; b: number; score: number }[] = []
  for (const e of net.edges) {
    const a = idxByKey.get(e.a)
    const b = idxByKey.get(e.b)
    if (a == null || b == null || a === b) continue
    eAll.push({ a, b, score: e.score })
    degAll[a]++
    degAll[b]++
  }
  // What's DRAWN: singletons never are (an unconnected dot says nothing), and `maxGenes` is the
  // budget for the rest — query genes first (the data being explored), then any first-shell
  // interactors, each by how connected it is. Interactors count toward the SAME budget, so the
  // setting reads as "at most N nodes" whether or not they're on.
  const ranked = net.nodes
    .map((_, i) => i)
    .filter((i) => degAll[i] > 0)
    .sort((a, b) => {
      const q = Number(net.nodes[b].isQuery) - Number(net.nodes[a].isQuery)
      return q !== 0 ? q : degAll[b] - degAll[a]
    })
    .slice(0, Math.max(2, maxGenes))
  // Trimming can orphan a kept node (all its partners went): re-count degrees over the surviving
  // edges and drop whatever is now isolated, so the drawing stays singleton-free.
  const inBudget = new Set(ranked)
  const budgetEdges = eAll.filter((e) => inBudget.has(e.a) && inBudget.has(e.b))
  const degKept = new Array(net.nodes.length).fill(0)
  for (const e of budgetEdges) {
    degKept[e.a]++
    degKept[e.b]++
  }
  // Original node order (not the ranking) keeps the layout stable across re-renders.
  const keep = net.nodes.map((_, i) => i).filter((i) => inBudget.has(i) && degKept[i] > 0)
  const newIdx = new Map(keep.map((gi, ni) => [gi, ni]))
  const vis = keep.map((i) => net.nodes[i])
  const degree = keep.map((i) => degKept[i])
  const drawn = budgetEdges.filter((e) => newIdx.has(e.a) && newIdx.has(e.b))
  const eIdx: [number, number][] = drawn.map((e) => [newIdx.get(e.a)!, newIdx.get(e.b)!])
  const eScore = drawn.map((e) => e.score)

  // Territories from Markov clustering of the interaction scores.
  const wEdges = eIdx.map(([a, b], k) => ({ a, b, w: eScore[k] ?? 0 }))
  const cid = mclClusters(vis.length, wEdges)
  const byCluster = new Map<number, number[]>()
  cid.forEach((c, i) => {
    const arr = byCluster.get(c)
    if (arr) arr.push(i)
    else byCluster.set(c, [i])
  })
  // uniqID per node key (stringId), for pulling each query gene's KEGG pathways from the annotations.
  // Every member node of a protein group maps to the group's one uniqID.
  const uniqByStringId = new Map(
    genes.flatMap((g) => g.stringIds.map((sid) => [sid, g.uniqID] as [string, string]))
  )
  const am = annotationMap ?? {}
  // stringId → uniqID over EVERY comparison gene (not just the query set), so an interactor node
  // that is itself a comparison gene still resolves to its uniqID and highlights when selected.
  const uniqByStringIdAll = new Map<string, string>()
  for (const uid in am)
    for (const sid of splitIds(am[uid]?.stringId))
      if (!uniqByStringIdAll.has(sid)) uniqByStringIdAll.set(sid, uid)
  const splitPaths = (raw: string | undefined): string[] =>
    (raw ?? '')
      .split(/[;|]/)
      .map((s) => s.trim())
      .filter(Boolean)
  // KEGG pathways per query gene, and the background: query genes that carry ≥1 pathway.
  const pathsByNode = new Map<number, string[]>() // vis node index → its pathways (query only)
  const termGenes = new Map<string, Set<number>>() // pathway → query node indices (background)
  let bgN = 0
  vis.forEach((n, i) => {
    if (!n.isQuery) return
    const uid = uniqByStringId.get(n.key)
    const paths = uid ? [...new Set(splitPaths(am[uid]?.KEGG))] : []
    if (paths.length === 0) return
    bgN++
    pathsByNode.set(i, paths)
    for (const t of paths) (termGenes.get(t) ?? termGenes.set(t, new Set()).get(t)!).add(i)
  })
  // Label each module by ORA of its query gene set: hypergeometric over-representation of pathways
  // vs the background (all annotated query genes), BH-corrected. Name = the significant pathways.
  const moduleLabel = (mem: number[]): string => {
    const setGenes = mem.filter((m) => pathsByNode.has(m))
    const n = setGenes.length
    if (n < 2 || bgN < 2) return ''
    const kByTerm = new Map<string, number>()
    for (const m of setGenes)
      for (const t of pathsByNode.get(m)!) kByTerm.set(t, (kByTerm.get(t) ?? 0) + 1)
    const staged = [...kByTerm.entries()]
      .filter(([, k]) => k >= 2)
      .map(([term, k]) => ({ term, k, K: termGenes.get(term)?.size ?? k }))
    if (staged.length === 0) return ''
    const padj = benjaminiHochberg(staged.map((s) => hyperTail(s.k, s.K, n, bgN)))
    const sig = staged
      .map((s, i) => ({ term: s.term, padj: padj[i], k: s.k }))
      .filter((s) => s.padj < 0.05)
      .sort((a, b) => a.padj - b.padj || b.k - a.k)
    return sig
      .slice(0, 3)
      .map((s) => s.term)
      .join(' / ')
  }
  const territoryGroups = [...byCluster.entries()]
    .filter(([, mem]) => mem.length >= 2)
    .map(([id, mem]) => {
      const paths = moduleLabel(mem)
      return { members: mem, label: `module ${id + 1}${paths ? ` (${paths})` : ''}` }
    })
  // Which module (territoryGroups index) each visible node belongs to (−1 = none).
  const moduleByNode = new Array<number>(vis.length).fill(-1)
  territoryGroups.forEach((grp, gi) => grp.members.forEach((m) => (moduleByNode[m] = gi)))
  return {
    vis,
    degree,
    eIdx,
    eScore,
    territoryGroups,
    moduleByNode,
    uniqByStringId,
    uniqByStringIdAll
  }
}

/**
 * Markov Clustering (MCL) on a weighted graph — the algorithm STRING uses to find interaction
 * modules. Repeatedly expands (matrix square) and inflates (element-wise power + column renormalise)
 * a column-stochastic matrix until it converges to an idempotent one whose non-zero pattern's weak
 * components are the clusters. Self-loops are added so every node attracts itself. Small n only.
 * Returns a cluster id per node.
 */
function mclClusters(
  n: number,
  edges: { a: number; b: number; w: number }[],
  inflation = 2
): number[] {
  if (n === 0) return []
  let M = Array.from({ length: n }, () => new Float64Array(n))
  for (const { a, b, w } of edges) {
    M[a][b] = w
    M[b][a] = w
  }
  for (let i = 0; i < n; i++) M[i][i] = 1 // self-loops
  const normCols = (m: Float64Array[]): void => {
    for (let j = 0; j < n; j++) {
      let s = 0
      for (let i = 0; i < n; i++) s += m[i][j]
      if (s > 0) for (let i = 0; i < n; i++) m[i][j] /= s
    }
  }
  normCols(M)
  for (let iter = 0; iter < 60; iter++) {
    // Expand: M·M.
    const E = Array.from({ length: n }, () => new Float64Array(n))
    for (let i = 0; i < n; i++)
      for (let k = 0; k < n; k++) {
        const v = M[i][k]
        if (v === 0) continue
        for (let j = 0; j < n; j++) E[i][j] += v * M[k][j]
      }
    // Inflate: element-wise power, then renormalise columns.
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) E[i][j] = Math.pow(E[i][j], inflation)
    normCols(E)
    // Convergence: Frobenius change.
    let diff = 0
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) diff += Math.abs(E[i][j] - M[i][j])
    M = E
    if (diff < 1e-4) break
  }
  // Clusters = weak components of the converged matrix's non-zero pattern.
  const adj: number[][] = Array.from({ length: n }, () => [])
  const T = 1e-3
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (i !== j && M[i][j] > T) {
        adj[i].push(j)
        adj[j].push(i)
      }
  const cid = new Array<number>(n).fill(-1)
  let c = 0
  for (let s = 0; s < n; s++) {
    if (cid[s] !== -1) continue
    const st = [s]
    cid[s] = c
    while (st.length) {
      const u = st.pop()!
      for (const v of adj[u])
        if (cid[v] === -1) {
          cid[v] = c
          st.push(v)
        }
    }
    c++
  }
  return cid
}
