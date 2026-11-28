/** GSEA: ranked gene-set enrichment, its running score and permutation-normalised enrichment. */
import { benjaminiHochberg } from '../stats/stats'
import type { CompareResultRow } from '../types'
import type { EnrichData, EnrichOptions, EnrichTerm } from './ora'
import { enrichTermsOf } from './terms'

// ── GSEA (ranked gene-set enrichment) ────────────────────────────────────────────

/** Deterministic PRNG (mulberry32) — GSEA permutations are seeded so a facet's result is stable
 *  across re-renders instead of shifting every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Weighted running-sum enrichment score for a set, given its member positions (ascending) in the
 *  ranked list and the per-position weights |metric|. Returns the signed peak ES and the peak
 *  position (the deepest point of the walk), from which the leading edge is read.
 *  Between hits the sum falls by 1/(N−K) per miss; at a hit it rises by w/N_R (N_R = Σ member w).
 *  Indexed loops over the arrays: it runs nPerm times per set size, the bulk of a GSEA run. */
function runningEs(
  positions: readonly number[] | Int32Array,
  weights: ArrayLike<number>,
  N: number
): { es: number; peakAt: number } {
  const K = positions.length
  if (K === 0 || K >= N) return { es: 0, peakAt: -1 }
  let nr = 0
  for (let i = 0; i < K; i++) nr += weights[positions[i]]
  if (nr <= 0) return { es: 0, peakAt: -1 }
  const missPenalty = 1 / (N - K)
  let cum = 0
  let prev = -1
  let maxDev = 0
  let minDev = 0
  let peakAt = positions[0]
  for (let i = 0; i < K; i++) {
    const pos = positions[i]
    cum -= (pos - prev - 1) * missPenalty // misses since the previous hit
    if (cum < minDev) minDev = cum
    cum += weights[pos] / nr
    if (cum > maxDev) {
      maxDev = cum
      if (maxDev >= -minDev) peakAt = pos
    }
    prev = pos
  }
  const es = maxDev >= -minDev ? maxDev : minDev
  // For a negative ES the peak is the deepest trough — recover it by tracking the min side.
  if (es < 0) {
    cum = 0
    prev = -1
    let dev = 0
    for (let i = 0; i < K; i++) {
      const pos = positions[i]
      cum -= (pos - prev - 1) * missPenalty
      if (cum < dev) {
        dev = cum
        peakAt = pos
      }
      cum += weights[pos] / nr
      prev = pos
    }
  }
  return { es, peakAt }
}

/** Fewest same-sign null scores that make a usable normaliser (see gseaNormalize). */
const GSEA_MIN_SAME_SIGN = 10

/** A set's NES and nominal p from its observed ES and the null ES of random sets its size. The
 *  standard way: divide by the mean of the SAME-sign null scores, and take p among them. When fewer
 *  than GSEA_MIN_SAME_SIGN null scores share the sign — common for large sets, whose random scores
 *  all lean one way — that mean can't be estimated (with none at all it was a near-zero placeholder,
 *  blowing NES up to ~10⁸), so fall back to the mean |ES| of the whole null, and to p over every
 *  permutation: an ES no random set matched in sign is significant, not p = 1. */
export function gseaNormalize(es: number, nullEs: number[]): { nes: number; p: number } {
  const same = nullEs.filter((e) => (es >= 0 ? e >= 0 : e < 0))
  const enough = same.length >= GSEA_MIN_SAME_SIGN
  const ref = enough ? same : nullEs
  const mean = ref.length ? ref.reduce((a, e) => a + Math.abs(e), 0) / ref.length : 0
  const nes = mean > 0 ? es / mean : 0
  const asExtreme = same.filter((e) => Math.abs(e) >= Math.abs(es)).length
  const p = (asExtreme + 1) / ((enough ? same.length : nullEs.length) + 1)
  return { nes, p: Math.min(1, p) }
}

/** Ranked gene-set enrichment. Genes are ranked by log2FC (descending); each GO term / KEGG
 *  pathway is scored by the weighted running-sum ES, with significance from gene-label
 *  permutation (sets of random genes of the same size). Positive-NES sets (enriched at the
 *  up-regulated top) go to `up`, negative-NES sets to `down`. `rows` are one facet's Compare
 *  result. Gene-set (not phenotype) permutation is used since only per-gene fold changes are
 *  available; p-values are nominal and BH-adjusted within each direction. */
export function runGsea(rows: CompareResultRow[], opts: EnrichOptions): EnrichData {
  const ann = opts.annotationMap ?? {}
  const dm = opts.displayMap ?? {}
  const termsOf = (uid: string): string[] =>
    enrichTermsOf(ann, opts.source, uid, opts.keggCategories)
  const minSet = Math.max(2, opts.minSet ?? 5)
  const maxSet = opts.maxSet ?? 500
  const nPerm = Math.max(100, opts.permutations ?? 1000)
  const limit = opts.topTerms > 0 ? opts.topTerms : 15
  const empty: EnrichData = {
    method: 'gsea',
    up: [],
    down: [],
    source: opts.source,
    querySize: { up: 0, down: 0 },
    bgSize: 0,
    totalTested: { up: 0, down: 0 }
  }

  // Rank metric: mean log2FC per gene (one entry per gene), most up-regulated first.
  const fc = new Map<string, { sum: number; n: number }>()
  for (const r of rows) {
    if (r.log2FC == null || !Number.isFinite(r.log2FC)) continue
    const e = fc.get(r.uniqID) ?? { sum: 0, n: 0 }
    e.sum += r.log2FC
    e.n += 1
    fc.set(r.uniqID, e)
  }
  const ranked = [...fc.entries()]
    .map(([uid, e]) => ({ uid, metric: e.sum / e.n }))
    .sort((a, b) => b.metric - a.metric)
  const N = ranked.length
  if (N < minSet + 1) return empty
  const weights = ranked.map((g) => Math.abs(g.metric)) // p = 1 weighting
  const posOf = new Map<string, number>()
  ranked.forEach((g, i) => posOf.set(g.uid, i))

  // Gene sets: term → member positions within the ranked list (size-filtered).
  const members = new Map<string, number[]>()
  ranked.forEach((g, i) => {
    for (const t of termsOf(g.uid)) {
      const arr = members.get(t)
      if (arr) arr.push(i)
      else members.set(t, [i])
    }
  })
  const sets = [...members.entries()]
    .map(([term, pos]) => ({ term, pos: pos.sort((a, b) => a - b) }))
    .filter((s) => s.pos.length >= minSet && s.pos.length <= maxSet)
  if (sets.length === 0) return empty

  // Null ES per set size (permutations depend only on K), reused across sets of equal size.
  const rand = mulberry32(0x9e3779b9 ^ N ^ (sets.length << 8))
  const nullBySize = new Map<number, number[]>()
  // k distinct random ranked positions, ascending. The hot loop of a run (nPerm draws per set
  // size), so a picked position is marked in a reused stamp array rather than a Set, and sorted as
  // a typed array (numeric, no comparator) — the same draws in the same order, many times faster.
  const picked = new Uint32Array(N)
  let stamp = 0
  const sample = (k: number): Int32Array => {
    stamp++
    const out = new Int32Array(k)
    let n = 0
    while (n < k) {
      const idx = (rand() * N) | 0
      if (picked[idx] !== stamp) {
        picked[idx] = stamp
        out[n++] = idx
      }
    }
    return out.sort()
  }
  const nullFor = (k: number): number[] => {
    const cached = nullBySize.get(k)
    if (cached) return cached
    const es: number[] = []
    for (let i = 0; i < nPerm; i++) es.push(runningEs(sample(k), weights, N).es)
    nullBySize.set(k, es)
    return es
  }

  interface Scored {
    term: string
    nes: number
    p: number
    setSize: number
    leading: string[]
    /** leading-edge genes' uniqIDs, aligned to `leading` */
    leadIds: string[]
    /** leading-edge genes' log2FC, aligned to `leading` */
    leadDist: number[]
    dist: number[]
  }
  const scored: Scored[] = []
  for (const s of sets) {
    const { es, peakAt } = runningEs(s.pos, weights, N)
    if (es === 0) continue
    const { nes, p } = gseaNormalize(es, nullFor(s.pos.length))
    // Leading edge: members up to (positive) / from (negative) the peak position, ordered by
    // |log2FC| so the most extreme drivers come first (names + values kept aligned).
    const leadPos = s.pos
      .filter((pos) => (es >= 0 ? pos <= peakAt : pos >= peakAt))
      .sort((a, b) => Math.abs(ranked[b].metric) - Math.abs(ranked[a].metric))
    const leading = leadPos.map((pos) => dm[ranked[pos].uid] ?? ranked[pos].uid)
    const leadIds = leadPos.map((pos) => ranked[pos].uid)
    const leadDist = leadPos.map((pos) => ranked[pos].metric)
    const dist = s.pos.map((pos) => ranked[pos].metric)
    scored.push({ term: s.term, nes, p, setSize: s.pos.length, leading, leadIds, leadDist, dist })
  }
  if (scored.length === 0) return empty

  // BH within each direction.
  const pack = (group: Scored[]): { terms: EnrichTerm[]; total: number } => {
    const padj = benjaminiHochberg(group.map((g) => g.p))
    const terms: EnrichTerm[] = group.map((g, i) => ({
      term: g.term,
      count: g.leading.length,
      setSize: g.setSize,
      geneRatio: g.setSize > 0 ? g.leading.length / g.setSize : 0,
      bgRatio: 0,
      fold: 0,
      pValue: g.p,
      pAdjust: padj[i],
      genes: g.leading,
      geneIds: g.leadIds,
      nes: g.nes,
      dist: g.dist,
      leadingDist: g.leadDist,
      category: opts.termGroups?.[g.term]
    }))
    terms.sort((a, b) => a.pAdjust - b.pAdjust || Math.abs(b.nes ?? 0) - Math.abs(a.nes ?? 0))
    return { terms: terms.slice(0, limit), total: terms.length }
  }
  const up = pack(scored.filter((s) => s.nes > 0))
  const down = pack(scored.filter((s) => s.nes < 0))
  return {
    method: 'gsea',
    up: up.terms,
    down: down.terms,
    source: opts.source,
    querySize: { up: up.total, down: down.total },
    bgSize: N,
    totalTested: { up: up.total, down: down.total },
    ranked: ranked.map((g) => g.metric)
  }
}
