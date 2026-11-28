/** Term modules: enriched terms grouped by the genes that carry them, as a differential heatmap
 *  groups genes by their fold changes. Many top terms are carried by the same genes — a GO term and
 *  its parents, overlapping pathways — so a module of them is one finding, and its most
 *  significant term stands for it.
 *
 *  - Similarity: the Jaccard index of two terms' hit genes (the query genes in them, ORA; the
 *    leading edge, GSEA), |A ∩ B| / |A ∪ B|. Hit genes, not the terms' whole membership: what makes
 *    two significant terms redundant here is the same hits carrying both — and a GO child and its
 *    parent carried by the same hits score high. Not the overlap coefficient (|A ∩ B| / the smaller):
 *    on real data (TPP, GO) it made hubs of broad terms — "cytosol", with 92 hits, took in any term
 *    whose two or three hits it held — where Jaccard kept tight, sensible modules (glycolysis with
 *    pyruvate kinase; the phenylalanine-tRNA ligase terms; GTP binding with GTPase activity).
 *  - Clustering: average linkage, merging while two groups' mean similarity is at least
 *    `threshold`, over the most significant `cap` terms (the ones a plot can show).
 *  - A module is a group of two or more terms, named after its most significant term with its size;
 *    a term like no other is in none. Modules are ordered by their best term's significance. */

export interface ModuleTerm {
  term: string
  /** the term's hit genes (any stable id) */
  genes: readonly string[]
  pAdjust: number
}

export interface TermModules {
  /** term → its module's name (terms in no module are absent) */
  of: Map<string, string>
  /** the modules' names, most significant first */
  order: string[]
  /** module name → its terms, most significant first */
  members: Map<string, string[]>
}

/** Terms sharing at least this much (Jaccard, averaged across two groups) group. */
export const MODULE_OVERLAP = 0.5
/** The most terms clustered: the most significant ones. */
export const MODULE_CANDIDATES = 300

/** A module's name: its most significant term, with its size — "glycolytic process (4)". */
export const moduleName = (rep: string, size: number): string => `${rep} (${size})`
/** A module's name split back into its term and its size (moduleName's inverse). */
export function moduleParts(name: string): { rep: string; size: number } | null {
  const k = /^(.*) \((\d+)\)$/.exec(name)
  return k ? { rep: k[1], size: Number(k[2]) } : null
}

export function termModules(
  terms: readonly ModuleTerm[],
  threshold = MODULE_OVERLAP,
  cap = MODULE_CANDIDATES
): TermModules {
  // one entry per term name (a term enriched both up and down: its hits pooled, its best p)
  const byName = new Map<string, { genes: Set<string>; p: number }>()
  for (const t of terms) {
    const e = byName.get(t.term)
    if (e) {
      for (const g of t.genes) e.genes.add(g)
      e.p = Math.min(e.p, t.pAdjust)
    } else byName.set(t.term, { genes: new Set(t.genes), p: t.pAdjust })
  }
  // most significant first; ties in the order given (the lists' own: a module's name is the term
  // its list shows first, so "one per group" keeps the term the module is named after)
  const items = [...byName.entries()]
    .map(([term, e], at) => ({ term, genes: e.genes, p: e.p, at }))
    .sort((a, b) => a.p - b.p || a.at - b.at)
    .slice(0, cap)
  const n = items.length

  const jaccard = (a: Set<string>, b: Set<string>): number => {
    const [small, big] = a.size <= b.size ? [a, b] : [b, a]
    let k = 0
    for (const g of small) if (big.has(g)) k++
    const union = a.size + b.size - k
    return union > 0 ? k / union : 0
  }
  // the groups' mean pairwise similarity, kept up to date as groups merge (Lance–Williams)
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) sim[i][j] = sim[j][i] = jaccard(items[i].genes, items[j].genes)
  const groups: (number[] | null)[] = items.map((_, i) => [i])
  for (;;) {
    let best = threshold
    let bi = -1
    let bj = -1
    for (let i = 0; i < n; i++) {
      if (!groups[i]) continue
      for (let j = i + 1; j < n; j++) {
        if (!groups[j]) continue
        if (sim[i][j] >= best) {
          // the most similar pair; ties to the earliest (most significant) one
          if (sim[i][j] > best || bi < 0) {
            best = sim[i][j]
            bi = i
            bj = j
          }
        }
      }
    }
    if (bi < 0) break
    const a = groups[bi]!
    const b = groups[bj]!
    for (let k = 0; k < n; k++) {
      if (!groups[k] || k === bi || k === bj) continue
      sim[bi][k] = sim[k][bi] =
        (a.length * sim[bi][k] + b.length * sim[bj][k]) / (a.length + b.length)
    }
    groups[bi] = [...a, ...b].sort((x, y) => x - y)
    groups[bj] = null
  }

  const mods = groups.filter((g): g is number[] => !!g && g.length > 1).sort((a, b) => a[0] - b[0])
  const of = new Map<string, string>()
  const members = new Map<string, string[]>()
  const order: string[] = []
  for (const g of mods) {
    const name = moduleName(items[g[0]].term, g.length)
    order.push(name)
    members.set(
      name,
      g.map((i) => items[i].term)
    )
    for (const i of g) of.set(items[i].term, name)
  }
  return { of, order, members }
}
