/**
 * Over-representation analysis: the hypergeometric test of each term's genes among the called
 * ones.
 */
import { benjaminiHochberg } from '../stats/stats'
import type { CompareResultRow } from '../types'
import { type EnrichMethod, type EnrichSource, enrichTermsOf } from './terms'
import { runGsea } from './gsea'

export interface EnrichTerm {
  /** the GO term / KEGG pathway name */
  term: string
  /** ORA: query genes hitting the term (k). GSEA: leading-edge gene count. */
  count: number
  /** genes in the background / data annotated with this term (K) */
  setSize: number
  /** ORA: k / n (query fraction). GSEA: leading-edge / setSize. */
  geneRatio: number
  /** ORA: K / N (background fraction). GSEA: unused (0). */
  bgRatio: number
  /** ORA: fold enrichment (geneRatio / bgRatio). GSEA: unused (0). */
  fold: number
  /** nominal p-value (ORA: hypergeometric tail; GSEA: permutation) */
  pValue: number
  /** Benjamini–Hochberg FDR-adjusted p-value */
  pAdjust: number
  /** display names of the driving genes (ORA: query hits; GSEA: leading-edge genes) */
  genes: string[]
  /** uniqIDs of the driving genes, aligned to `genes` (for cross-view linking: hover, and a click
   *  selecting the term's genes). Absent on results from before ORA kept them. */
  geneIds?: string[]
  /** GSEA normalized enrichment score (sign = direction); undefined for ORA */
  nes?: number
  /** GSEA: the ranking metric (log2FC) of every member gene, for the ridgeline density */
  dist?: number[]
  /** GSEA: the ranking metric (log2FC) of the leading-edge genes, aligned to `genes` */
  leadingDist?: number[]
  /** the group this term is coloured by — a KEGG pathway's category, a COG category's area —
   *  when the source has one and it's known (EnrichOptions.termGroups) */
  category?: string
}

export interface EnrichData {
  /** which analysis produced these terms */
  method: EnrichMethod
  /** up-regulated enrichment — ORA: enriched among up-significant genes; GSEA: positive-NES sets */
  up: EnrichTerm[]
  /** down-regulated enrichment — ORA: down-significant genes; GSEA: negative-NES sets */
  down: EnrichTerm[]
  source: EnrichSource
  /** ORA: annotated significant genes per direction. GSEA: sets tested per direction. */
  querySize: { up: number; down: number }
  /** ORA: annotated background genes N. GSEA: ranked genes N. */
  bgSize: number
  /** terms tested per direction (before the topTerms cap) */
  totalTested: { up: number; down: number }
  /** GSEA: the ranking metric (log2FC) of every ranked gene — the global reference distribution
   *  for the ridgeline plot. Undefined for ORA. */
  ranked?: number[]
}

export interface EnrichOptions {
  /** 'ora' (over-representation) or 'gsea' (ranked). Defaults to 'ora'. */
  method?: EnrichMethod
  source: EnrichSource
  /** how many top terms to keep per direction (<= 0 → default 15) */
  topTerms: number
  /** uniqID → { column → value } from the ID-map DB (carries GO / KEGG / COG …) */
  annotationMap: Record<string, Record<string, string>>
  /** uniqID → display name (for the per-term gene lists) */
  displayMap?: Record<string, string>
  /** KEGG pathway name → BRITE top-level category: the term set for `kegg_category` (no longer
   *  offered, kept so an old tile still builds). */
  keggCategories?: Record<string, string>
  /** term → the group it's coloured and grouped by: a KEGG pathway's category, a COG category's
   *  area (cogAreasOf). Unset for a source without such a grouping. */
  termGroups?: Record<string, string>
  /** ORA: minimum query-gene hits for a term to be tested (default 2) */
  minCount?: number
  /** GSEA: minimum / maximum genes a set must have in the data (default 5 / 500) */
  minSet?: number
  maxSet?: number
  /** GSEA: number of gene-label permutations (default 1000) */
  permutations?: number
}

/** Split a semicolon/pipe-separated annotation cell into distinct trimmed terms. */
export function splitTerms(raw: string | undefined): string[] {
  if (!raw) return []
  const out = new Set<string>()
  for (const s of raw.split(/[;|]/)) {
    const t = s.trim()
    if (t) out.add(t)
  }
  return [...out]
}

/** ln Γ(z) via the Lanczos approximation — for hypergeometric log-binomials. */
function lnGamma(z: number): number {
  const g = 7
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7
  ]
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z)
  z -= 1
  let x = c[0]
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i)
  const t = z + g + 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}

/** ln C(n, k). */
function lnChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity
  return lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1)
}

/** P(X ≥ k) for X ~ Hypergeometric(N, K, n): drawing n from N with K "successes".
 *  Equivalent to a one-tailed Fisher exact test for over-representation. */
function hyperTail(k: number, K: number, n: number, N: number): number {
  if (n === 0 || N === 0) return 1
  const hi = Math.min(K, n)
  const denom = lnChoose(N, n)
  let p = 0
  for (let i = k; i <= hi; i++) p += Math.exp(lnChoose(K, i) + lnChoose(N - K, n - i) - denom)
  return Math.min(1, Math.max(0, p))
}

/** Enrichment dispatcher: ORA (over-representation) or GSEA (ranked). See runOra / runGsea. */
export function buildEnrichment(rows: CompareResultRow[], opts: EnrichOptions): EnrichData {
  return (opts.method ?? 'ora') === 'gsea' ? runGsea(rows, opts) : runOra(rows, opts)
}

/** Over-representation analysis, run separately for UP- and DOWN-regulated significant genes.
 *  The background is all annotated genes (shared); the up query is the significant genes whose
 *  effect is 'up', the down query those whose effect is 'down'. Each direction is tested with
 *  the hypergeometric (Fisher) tail and BH-corrected independently. `rows` are one facet's Compare
 *  result; genes with no term of the chosen source are excluded from both query and background. */
function runOra(rows: CompareResultRow[], opts: EnrichOptions): EnrichData {
  const ann = opts.annotationMap ?? {}
  const dm = opts.displayMap ?? {}
  const termsOf = (uid: string): string[] =>
    enrichTermsOf(ann, opts.source, uid, opts.keggCategories)
  const push = (m: Map<string, string[]>, t: string, uid: string): void => {
    const arr = m.get(t)
    if (arr) arr.push(uid)
    else m.set(t, [uid])
  }
  const minCount = opts.minCount ?? 2
  const limit = opts.topTerms > 0 ? opts.topTerms : 15

  // Per gene: is it a significant UP hit / significant DOWN hit? (A gene pooled across several
  // comparisons in one facet could be both; it then counts toward each direction it hits.)
  const dir = new Map<string, { up: boolean; down: boolean }>()
  for (const r of rows) {
    let e = dir.get(r.uniqID)
    if (!e) dir.set(r.uniqID, (e = { up: false, down: false }))
    if (r.signf && r.effect === 'up') e.up = true
    if (r.signf && r.effect === 'down') e.down = true
  }

  // Background = annotated genes; also collect the two directional query sets.
  const bgByTerm = new Map<string, string[]>()
  const upGenes = new Set<string>()
  const downGenes = new Set<string>()
  let N = 0
  for (const [uid, e] of dir) {
    const terms = termsOf(uid)
    if (terms.length === 0) continue
    N++
    if (e.up) upGenes.add(uid)
    if (e.down) downGenes.add(uid)
    for (const t of terms) push(bgByTerm, t, uid)
  }

  const runDir = (queryGenes: Set<string>): { terms: EnrichTerm[]; total: number } => {
    const n = queryGenes.size
    const qByTerm = new Map<string, string[]>()
    for (const uid of queryGenes) for (const t of termsOf(uid)) push(qByTerm, t, uid)
    const staged: { term: string; k: number; K: number; genes: string[] }[] = []
    for (const [t, qg] of qByTerm) {
      if (qg.length < minCount) continue
      staged.push({ term: t, k: qg.length, K: (bgByTerm.get(t) ?? qg).length, genes: qg })
    }
    const pvals = staged.map((e) => hyperTail(e.k, e.K, n, N))
    const padj = benjaminiHochberg(pvals)
    const terms: EnrichTerm[] = staged.map((e, i) => {
      // the hits by name, their uniqIDs kept aligned (for selecting the term's genes)
      const hits = e.genes
        .map((uid) => ({ uid, name: dm[uid] ?? uid }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      return {
        term: e.term,
        count: e.k,
        setSize: e.K,
        geneRatio: n > 0 ? e.k / n : 0,
        bgRatio: N > 0 ? e.K / N : 0,
        fold: n > 0 && N > 0 && e.K > 0 ? e.k / n / (e.K / N) : 0,
        pValue: pvals[i],
        pAdjust: padj[i],
        genes: hits.map((h) => h.name),
        geneIds: hits.map((h) => h.uid),
        category: opts.termGroups?.[e.term]
      }
    })
    terms.sort((a, b) => a.pAdjust - b.pAdjust || b.count - a.count)
    return { terms: terms.slice(0, limit), total: terms.length }
  }

  const up = runDir(upGenes)
  const down = runDir(downGenes)
  return {
    method: 'ora',
    up: up.terms,
    down: down.terms,
    source: opts.source,
    querySize: { up: upGenes.size, down: downGenes.size },
    bgSize: N,
    totalTested: { up: up.total, down: down.total }
  }
}
