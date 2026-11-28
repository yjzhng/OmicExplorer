/**
 * The log₂FC heatmap (compare): genes × comparison columns, signed fold change.
 * Plain data for the renderer to turn into Plotly traces (no Plotly dependency here).
 */
import {
  type ClusterOrderOptions,
  clusterRowTree,
  type DendroLink,
  type LeafOrder,
  type Linkage
} from '../stats/cluster'
import { pickTop, type TopSplitSpec } from '../stats/topPick'
import { type CompareResultRow, type ConditionKey, condsIn, ctxLabel } from '../types'
import { ctxValue } from './facet'
import { curveComparisonText } from './volcano'

// ── log2FC heatmap (compare): genes × comparison-columns, signed fold change ──────

export interface FcHeatmapData {
  /** gene display labels (row order) */
  genes: string[]
  /** gene uniqIDs, aligned to `genes` (for linked selection) */
  geneIds: string[]
  /** column labels — one per comparison × context, naming only what varies across the columns
   *  (the comparison, the context conditions); what every column shares is `columnsTitle` */
  columns: string[]
  /** the comparison every column shares (a curve fit's as "dose curve | baseline"), for the
   *  columns' axis title — absent when they're of several comparisons */
  columnsTitle?: string
  /** z[geneRow][col] = log2FC (null = missing) */
  z: Array<Array<number | null>>
  /** max |log2FC| across the matrix (≥ tiny) */
  absMax: number
  /** the symmetric colour limit: the 99th percentile of |log2FC| (≤ absMax), so a few extreme
   *  cells don't wash every other one out to near-white; colours saturate beyond it */
  colorMax: number
  /** the gene rows' clustering tree, in row-position space (absent when the rows weren't
   *  clustered — too few, or clustering off) */
  rowTree?: DendroLink[]
  /** the comparison columns' clustering tree, in column-position space (absent likewise) */
  colTree?: DendroLink[]
  /** what tells the columns apart, for the condition tracks: 'comparison', then each context
   *  condition (the conditions besides the compared one that vary between columns) */
  colConds: Array<'comparison' | ConditionKey>
  /** each column's value on each of `colConds` ('' = none), aligned with `columns` */
  colValues: string[][]
}

/** The share of |log2FC| cells the fold-change heatmap's colour range spans. */
const FC_COLOR_QUANTILE = 0.99

export interface FcHeatmapOptions {
  displayMap?: Record<string, string>
  /** cap to the top-N genes by max |log2FC| (0 = all); ignored when `focus` is set */
  maxGenes?: number
  /** how the top-N splits between up and down — a gene's direction is that of its largest
   *  |log2FC| (see topPick; default proportional) */
  split?: TopSplitSpec
  /** focus genes (uniqIDs) — show exactly these rows when non-empty */
  focus?: string[]
  /** bicluster gene rows AND comparison columns by log2FC profile (default true) */
  cluster?: boolean
  /** keep only genes that are significant (`signf`) in ≥1 comparison column — every column still
   *  shows, one with no significant cell included (those genes' fold change there is part of the
   *  picture: unchanged under one treatment while changed under another). Ignored when `focus` is
   *  set (an explicit gene pick always shows). */
  differentialOnly?: boolean
  /** how clusters join (default `ward`) — see Linkage */
  linkage?: Extract<Linkage, 'ward' | 'complete'>
  /** how the tree's leaves are laid out (default `mean`) — see LeafOrder */
  leafOrder?: LeafOrder
  /** cluster the comparison columns on the pattern of their changes alone: each column's profile
   *  centred and scaled to unit spread before the euclidean distance, which then ranks pairs as
   *  1 − Pearson r does (and keeps Ward valid). Unset: on the changes as they are — their size
   *  counts too. The genes are clustered on the changes as they are either way. */
  colPattern?: boolean
}

/** A profile centred on its mean and scaled to unit spread (a flat one: all zeros). */
function standardised(v: number[]): number[] {
  const n = v.length || 1
  const m = v.reduce((a, x) => a + x, 0) / n
  const sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / n)
  return sd > 0 ? v.map((x) => (x - m) / sd) : v.map(() => 0)
}

/** Pivot a comparison result into a genes × (comparison × context) matrix of log2FC. Each column
 *  is one vehicle-normalised / compared condition; cells are the signed fold change. */
export function buildFcHeatmap(
  rows: CompareResultRow[],
  opts: FcHeatmapOptions = {}
): FcHeatmapData {
  const gen = buildFcHeatmapSteps(rows, opts)
  let r = gen.next()
  while (!r.done) r = gen.next(clusterRowTree(r.value.rows, r.value.opts))
  return r.value
}

/** What buildFcHeatmapSteps hands out: the rows to cluster and how — answered with
 *  clusterRowTree's result for them. */
export interface FcHeatmapClusterJob {
  rows: number[][]
  opts: ClusterOrderOptions
}

/** buildFcHeatmap as steps: the pivot and layout here, each clustering (the comparison columns,
 *  then the gene rows — O(n²), the slow part) handed out, so the dashboard can run it off the UI
 *  thread. Same result either way. */
export function* buildFcHeatmapSteps(
  rows: CompareResultRow[],
  opts: FcHeatmapOptions = {}
): Generator<FcHeatmapClusterJob, FcHeatmapData, ReturnType<typeof clusterRowTree>> {
  // Context dims = present conditions that AREN'T the comparison axis (cmp_cond) — they distinguish
  // one comparison column from another alongside the `comparison` label.
  const consumed = new Set<string>()
  for (const r of rows) for (const p of r.cmp_cond.split(':')) if (p) consumed.add(p)
  const ctxDims = condsIn(rows).filter(
    (c) => !consumed.has(c) && rows.some((r) => ctxValue(r, c) != null && ctxValue(r, c) !== '')
  )
  const colLabel = (r: CompareResultRow): string =>
    [r.comparison, ...ctxDims.map((c) => ctxLabel(c, ctxValue(r, c)))].join(' · ')

  const colOrder: string[] = []
  const colSeen = new Set<string>()
  // each column's comparison and context values (its condition tracks)
  const colValueOf = new Map<string, string[]>()
  const geneOrder: string[] = []
  const geneSeen = new Set<string>()
  const diffGenes = new Set<string>() // genes significant (signf) in ≥1 comparison column
  const cells = new Map<string, Map<string, number | null>>() // gene → col → log2FC

  for (const r of rows) {
    const col = colLabel(r)
    if (!colSeen.has(col)) {
      colSeen.add(col)
      colOrder.push(col)
      colValueOf.set(col, [
        r.comparison,
        ...ctxDims.map((c) => {
          const v = ctxValue(r, c)
          return v == null ? '' : String(v)
        })
      ])
    }
    if (!geneSeen.has(r.uniqID)) {
      geneSeen.add(r.uniqID)
      geneOrder.push(r.uniqID)
    }
    if (r.signf) {
      diffGenes.add(r.uniqID)
    }
    let m = cells.get(r.uniqID)
    if (!m) {
      m = new Map()
      cells.set(r.uniqID, m)
    }
    m.set(col, r.log2FC != null && Number.isFinite(r.log2FC) ? r.log2FC : null)
  }
  const cellVal = (g: string, c: string): number | null => cells.get(g)?.get(c) ?? null

  let activeCols = colOrder

  const focus = opts.focus ?? []
  // Restrict to differential genes (significant somewhere) before top-N / clustering — an
  // explicit focus pick bypasses this and always shows.
  const universe = opts.differentialOnly ? geneOrder.filter((g) => diffGenes.has(g)) : geneOrder
  let genes = universe
  if (focus.length > 0) {
    const present = new Set(geneOrder)
    genes = focus.filter((g) => present.has(g))
  } else if (
    opts.maxGenes &&
    opts.maxGenes > 0 &&
    (universe.length > opts.maxGenes || opts.split?.by === 'fixed')
  ) {
    // each gene's largest |log2FC|, its sign kept: the direction it's picked on
    const signedPeak = (g: string): number => {
      let best = 0
      for (const c of activeCols) {
        const v = cellVal(g, c)
        if (v != null && Math.abs(v) > Math.abs(best)) best = v
      }
      return best
    }
    const keep = new Set(
      pickTop(
        universe.map((g) => ({ id: g, signed: signedPeak(g) })),
        opts.maxGenes,
        opts.split
      )
    )
    // in the order the top-N ranks them (by size), as before
    genes = [...universe]
      .filter((g) => keep.has(g))
      .sort((a, b) => Math.abs(signedPeak(b)) - Math.abs(signedPeak(a)))
  }

  let z = genes.map((g) => activeCols.map((c) => cellVal(g, c)))
  // The colour range: the 99th percentile of |log2FC|, not its max — one extreme cell (a curve
  // fit's runaway fold change) would otherwise stretch the scale until everything else reads as
  // near-white.
  const abs: number[] = []
  for (const row of z)
    for (const v of row) if (v != null && Number.isFinite(v)) abs.push(Math.abs(v))
  abs.sort((x, y) => x - y)
  const absMax = abs.length ? abs[abs.length - 1] : 0
  const colorMax = abs.length ? abs[Math.floor(FC_COLOR_QUANTILE * (abs.length - 1))] : 0
  // Bicluster — order BOTH gene rows and comparison columns by fold-change PROFILE so
  // co-regulated genes and co-varying conditions form visible blocks (pattern discovery).
  // Impute missing cells with the column mean, then cluster on the fold changes themselves, as
  // coloured (capped at the colour limit, where the colour stops changing): Ward linkage on
  // euclidean distance, so genes with the same changes, the same size, sit together in compact
  // blocks — strong reds with strong reds, the near-zero genes in one block. (Average linkage
  // chains: one sprawling cluster with the stragglers hung off it.) Neither scaled nor centred: a
  // unit-length profile weighs a near-zero gene's faint wobble as fully as a strong change and
  // scatters those genes through the blocks, and taking a gene's mean off makes "up under A only"
  // ([+, +, 0, 0]) and "down under B only" ([0, 0, −, −]) the same profile. Each merge then lays
  // its two branches out by mean fold change, low → high (R's heatmap(): reorder.dendrogram by
  // row / column means), so neighbouring clusters grade into one another rather than landing in
  // the arbitrary order the merges happened in. Columns are reordered first, then rows. The
  // displayed z keeps its real values/nulls; the imputing and capping only drive the ordering.
  // (Ordinal dose/time order is intentionally traded for pattern.)
  const mean = (vec: number[]): number => vec.reduce((a, v) => a + v, 0) / (vec.length || 1)
  const cap = colorMax || 1
  const how = { linkage: opts.linkage ?? 'ward', leafOrder: opts.leafOrder ?? 'mean' } as const
  let rowTree: DendroLink[] | undefined
  let colTree: DendroLink[] | undefined
  if (opts.cluster ?? true) {
    const colMean = activeCols.map((_, ci) => {
      let sum = 0
      let cnt = 0
      for (let ri = 0; ri < z.length; ri++) {
        const v = z[ri][ci]
        if (v != null && Number.isFinite(v)) {
          sum += v
          cnt++
        }
      }
      return cnt > 0 ? sum / cnt : 0
    })
    let imputed = z.map((row) =>
      row.map((v, ci) =>
        Math.max(-cap, Math.min(cap, v != null && Number.isFinite(v) ? v : colMean[ci]))
      )
    )
    // Columns first: cluster on each column's gene-response profile.
    if (activeCols.length > 2 && genes.length > 1) {
      const colVecs = activeCols.map((_, ci) => imputed.map((row) => row[ci]))
      // (the leaf order still by each column's own mean change, low → high)
      const ct = yield {
        rows: opts.colPattern ? colVecs.map(standardised) : colVecs,
        opts: { ...how, weights: colVecs.map(mean) }
      }
      const corder = ct.order
      colTree = ct.links
      activeCols = corder.map((i) => activeCols[i])
      z = z.map((row) => corder.map((i) => row[i]))
      imputed = imputed.map((row) => corder.map((i) => row[i]))
    }
    // Rows: cluster on each gene's (now column-reordered) profile — with one column, that orders
    // the genes by it.
    if (genes.length > 2 && activeCols.length > 0) {
      const rt = yield { rows: imputed, opts: { ...how, weights: imputed.map(mean) } }
      const order = rt.order
      rowTree = rt.links
      genes = order.map((i) => genes[i])
      z = order.map((i) => z[i])
    }
  }

  // A column is named by what tells it apart from the others: the comparison and the context
  // conditions that vary across the columns — one shared by every column (a curve fit's "dose
  // curve | 0") said once, as the axis title, not on every tick.
  const colValues = activeCols.map((c) => colValueOf.get(c) ?? [])
  const varies = (t: number): boolean => new Set(colValues.map((v) => v[t])).size > 1
  const many = colValues.length > 1
  const cmpVaries = varies(0)
  const ctxVaries = ctxDims.map((_, i) => varies(i + 1))
  const columns = activeCols.map((c, k) => {
    if (!many) return c
    const v = colValues[k]
    const parts = [
      ...(cmpVaries ? [v[0]] : []),
      ...ctxDims.flatMap((d, i) => (ctxVaries[i] && v[i + 1] !== '' ? [ctxLabel(d, v[i + 1])] : []))
    ]
    return parts.length ? parts.join(' · ') : c
  })
  const shared = many && !cmpVaries ? colValues[0]?.[0] : undefined
  const dm = opts.displayMap ?? {}
  return {
    genes: genes.map((g) => dm[g] ?? g),
    geneIds: genes,
    columns,
    ...(shared ? { columnsTitle: curveComparisonText(shared, rows) } : null),
    z,
    absMax: absMax || 1,
    colorMax: colorMax || absMax || 1,
    ...(rowTree?.length ? { rowTree } : null),
    ...(colTree?.length ? { colTree } : null),
    colConds: ['comparison', ...ctxDims],
    colValues
  }
}
