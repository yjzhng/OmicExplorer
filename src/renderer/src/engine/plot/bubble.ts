/**
 * The bubble grid (compare): genes × comparisons, sized and coloured by effect.
 * Plain data for the renderer to turn into Plotly traces (no Plotly dependency here).
 */
import { pickTop, type TopSplitSpec } from '../stats/topPick'
import type { Effect } from '../stats/stats'
import type { CompareResultRow, ConditionKey } from '../types'
import { ctxNum } from './facet'
import { geneLimit } from './dr'

// ── bubble (compare) ─────────────────────────────────────────────────────────────

export interface BubblePoint {
  x: number // dose or time
  gene: string
  uniqID: string
  log2FC: number // → dot fill color (diverging)
  sig: number // −log10 P or Q (BubbleOptions.stat) — the significance the view may size/colour by
  effect: Effect
  signf: boolean
}
export interface BubbleData {
  points: BubblePoint[]
  genes: string[] // gene axis order as uniqIDs (unique — so same-named genes stay distinct rows)
  geneLabels: string[] // display names aligned to `genes`, for the axis tick labels
  axis: ConditionKey
  /** total genes available before the cap (for a "top N of M" note) */
  total: number
}
export interface BubbleOptions {
  axis: ConditionKey
  topGenes: number
  /** how the top-N splits between up and down (see topPick; default proportional) */
  split?: TopSplitSpec
  /** what ranks the genes: their log₂FC (default), or the significance column that drives the
   *  Compare's calls (−log₁₀ P or Q), signed by the fold change's direction */
  rank?: 'fc' | 'pP' | 'pQ'
  /** over the dose/time levels, the rank score's peak (the level scoring furthest from 0, its sign
   *  kept — default) or its total (summed, so opposite levels cancel to the net direction) */
  over?: 'peak' | 'total'
  /** the significance column the points carry (`sig`): the one the Compare calls by (default P) */
  stat?: 'pP' | 'pQ'
  displayMap?: Record<string, string>
  /** focus genes (uniqIDs): when non-empty, show exactly these genes instead of top-N */
  focus?: string[]
  /** linked-selection genes (uniqIDs) added to the chosen set, each in its place in the score
   *  order, so a pinned gene shows up alongside the top-N (or GOI) rather than replacing it */
  extra?: string[]
}

/** Bubble grid: genes × dose(or time), dot color = log2FC, size = |log2FC| (view). Top-N genes
 *  are those significant at one level or more, picked (and ordered) by a signed score over their
 *  dose/time levels: per level their log2FC (`rank` 'fc') or significance (−log₁₀ P or Q, signed by
 *  the fold change there, so up and down still split), taken at its peak or summed (`over`). */
/** buildBubble's part that reads every row — each gene's rows and score, and the genes shown
 *  before any linked selection is added — kept apart, so a pin (which only adds genes) doesn't
 *  scan every row again (bubbleWith). */
export interface BubbleBase {
  byGene: Map<string, CompareResultRow[]>
  topSigned: Map<string, number>
  base: string[]
  total: number
}

export function bubbleBase(
  rows: CompareResultRow[],
  opts: Omit<BubbleOptions, 'extra' | 'stat' | 'displayMap'>
): BubbleBase {
  const topSigned = new Map<string, number>() // signed rank score over the levels: picks + order
  const rank = opts.rank ?? 'fc'
  const total = opts.over === 'total'
  // the score: log₂FC, or the significance (−log₁₀) in the fold change's direction
  const scoreOf = (r: CompareResultRow): number =>
    rank === 'fc' ? r.log2FC! : Math.sign(r.log2FC!) * (r[rank] ?? 0)
  const byGene = new Map<string, CompareResultRow[]>()
  // Genes with at least one significant point (any dose / time level): only these can be top-N.
  const anySig = new Set<string>()
  for (const r of rows) {
    if (r.log2FC == null || !Number.isFinite(r.log2FC)) continue
    if (r.signf) anySig.add(r.uniqID)
    const x = ctxNum(r, opts.axis)
    if (x != null) {
      const sc = scoreOf(r)
      const cur = topSigned.get(r.uniqID)
      if (cur == null) topSigned.set(r.uniqID, sc)
      else if (total) topSigned.set(r.uniqID, cur + sc)
      else if (Math.abs(sc) > Math.abs(cur)) topSigned.set(r.uniqID, sc)
    }
    let arr = byGene.get(r.uniqID)
    if (!arr) {
      arr = []
      byGene.set(r.uniqID, arr)
    }
    arr.push(r)
  }
  // Top-N is drawn from the genes significant at some level — a big fold change that never passes
  // the Compare's threshold (grey on the volcano) isn't a "top" gene.
  const sigGenes = [...topSigned.entries()]
    .filter(([id]) => anySig.has(id))
    .map(([id, signed]) => ({ id, signed }))
  // Focus genes (when set) override top-N: keep exactly those present in the data.
  const focus = opts.focus ?? []
  const base =
    focus.length > 0
      ? focus.filter((id) => byGene.has(id))
      : // up / down as set (proportional by default); unset ⇒ all (safety-capped)
        opts.topGenes > 0
        ? pickTop(sigGenes, opts.topGenes, opts.split)
        : pickTop(sigGenes, geneLimit(0, sigGenes.length))
  return { byGene, topSigned, base, total: sigGenes.length }
}

/** A bubble plot from its base, with the linked selection's genes (`extra`) added. */
export function bubbleWith(
  b: BubbleBase,
  opts: Pick<BubbleOptions, 'axis' | 'extra' | 'stat' | 'displayMap'>
): BubbleData {
  const { byGene, topSigned, base } = b
  // Add the linked-selection genes not already shown, then order them all by their score
  // (descending) for the gene axis: a pinned gene takes its place in the order, between the genes
  // it ranks between, rather than going to the end.
  const baseSet = new Set(base)
  const extra = (opts.extra ?? []).filter((id) => byGene.has(id) && !baseSet.has(id))
  const top = [...base, ...extra].sort((a, b) => (topSigned.get(b) ?? 0) - (topSigned.get(a) ?? 0))
  const points: BubblePoint[] = []
  for (const g of top) {
    const label = opts.displayMap?.[g] ?? g
    for (const r of byGene.get(g) ?? []) {
      const x = ctxNum(r, opts.axis)
      if (x == null || r.log2FC == null) continue
      points.push({
        x,
        gene: label,
        uniqID: g,
        log2FC: r.log2FC,
        sig: r[opts.stat ?? 'pP'] ?? 0,
        effect: r.effect,
        signf: r.signf
      })
    }
  }
  return {
    points,
    genes: top, // uniqIDs — the axis category keys (unique per feature)
    geneLabels: top.map((g) => opts.displayMap?.[g] ?? g),
    axis: opts.axis,
    total: b.total
  }
}

export function buildBubble(rows: CompareResultRow[], opts: BubbleOptions): BubbleData {
  return bubbleWith(bubbleBase(rows, opts), opts)
}
