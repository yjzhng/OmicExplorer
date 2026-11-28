/**
 * The cluster plot: the samples (or a response's genes) embedded in 2-D, with their condition metadata.
 * Plain data for the renderer to turn into Plotly traces (no Plotly dependency here).
 */
import { condValue } from '../compare/compare'
import { sampleLabel } from '../data/sampleLabel'
import { clusterRowGroups, suggestClusterCount } from '../stats/cluster'
import { type ClusterMethod, embed2D } from '../stats/embed'
import type { ValueScale } from '../data/scale'
import {
  type CompareResultRow,
  type ConditionKey,
  customSlug,
  isCustomCond,
  type StandardRow,
  VALID_CONDITIONS
} from '../types'
import { sampleCond } from './heatmap'
import { ctxValue, responseColorDims } from './facet'

// ── cluster / sample embedding (standardize) ─────────────────────────────────────

/** Per-point condition values, so the view can drive multi-condition (complex-legend)
 *  aesthetics — colour by a qualitative condition, shade/arrow by a quantitative one. */
export interface ClusterMeta {
  cell: string
  cmpd: string
  dose: number | null
  time: number | null
  /** custom condition slug → value (categorical, so always a string) */
  extra?: Record<string, string>
  /** the replicate, for a per-sample point (absent on a condition mean or a responsome point) */
  rep?: number
}
export interface ClusterPoint {
  x: number
  y: number
  /** full identity of this point (sample incl. replicate, or condition) */
  sample: string
  /** color group value (the colorBy condition) */
  group: string
  /** condition identity without the replicate — replicates of one condition share
   *  it, so the view can collapse them to a centroid + territory. */
  cond: string
  /** condition values, for the view's complex-legend aesthetics */
  meta: ClusterMeta
}
export interface ClusterData {
  points: ClusterPoint[]
  method: ClusterMethod
  /** PCA only: variance fraction on each axis ([0, 0] for UMAP/t-SNE). */
  varExplained: [number, number]
  colorBy: ClusterColorBy
  /** PCA only, and only when asked for: the most influential features in the plotted component
   *  plane, longest first. Raw loading coordinates — the loadings plot has its own axes, so nothing
   *  is rescaled to match the scores. */
  loadings?: Array<{ label: string; x: number; y: number }>
  /** Colouring by cluster only: the group count actually used (the `clusterCount` method resolves
   *  to a number, which the UI can report — 'auto' especially, where the user didn't pick it). */
  clusterK?: number
  /** What the embedding actually ran on, for a diagnostic caption (scree = variance fraction of
   *  each PC, descending; PCA only). `transform` = the log applied ('log2'|'log10'|'linear');
   *  `range` = raw value [min, max]. */
  diag?: {
    items: number
    features: number
    missingPct: number
    scree?: number[]
    transform?: string
    range?: [number, number]
    /** set when 'complete' left too few genes to embed and every gene was used, gaps imputed: how
     *  many genes were quantified in every item */
    completeFallback?: number
  }
}

/** The fewest fully quantified genes the 'complete' missing-value mode embeds; fewer → impute. */
export const MIN_COMPLETE_FEATURES = 10
export interface ClusterOptions {
  method: ClusterMethod
  colorBy: ClusterColorBy
  /** Colouring by cluster: what the grouping is computed from. 'coords' clusters the embedded 2-D
   *  positions, so the colours always match the visual grouping (but cluster a lossy projection);
   *  'features' clusters the same high-dimensional matrix the embedding ran on, so the grouping is
   *  the real structure and is identical whichever method draws it. Defaults to 'coords'. */
  clusterOn?: 'coords' | 'features'
  /** Colouring by cluster: how the group count is chosen. 'fixed' uses `clusterK`; 'conditions'
   *  uses the number of distinct conditions (asking "do the samples group the way the design
   *  says?"); 'auto' takes the largest gap in the dendrogram. Defaults to 'fixed'. */
  clusterCount?: 'fixed' | 'conditions' | 'auto'
  /** `clusterCount: 'fixed'` only — the number of groups to cut. Defaults to 3. */
  clusterK?: number
  /** Return the top-N feature loadings (PCA only). 0 / undefined = none, which is the default:
   *  they're only computed for a tile that draws them. */
  loadings?: number
  /** uniqID → display label, for naming the loadings. Without it they carry the raw ID. */
  displayMap?: Record<string, string>
  /** Per-gene scaling before embedding. 'unit' z-scores each gene to unit variance
   *  (correlation PCA — every gene weighted equally). 'none' only mean-centers each gene, so
   *  high-variance genes keep their weight (covariance PCA — matches tools like Spectronaut).
   *  Defaults to 'unit'. */
  scale?: 'unit' | 'none'
  /** Missing-value policy. 'impute' fills each gene's gaps with its mean (keeps every gene, but
   *  flattens genes detected in only some samples). 'complete' drops any gene with a missing value
   *  in any item (Spectronaut-style — no imputation). Defaults to 'impute'. */
  missing?: 'impute' | 'complete'
  /** Per-sample normalization before embedding (standardize path only). 'median' subtracts each
   *  sample's median (offset). 'zscore' also divides by each sample's SD (per-sample standardization
   *  — removes scale too, like Pearson correlation). 'quantile' forces a common distribution.
   *  'none' leaves the log2 values as-is. Defaults to 'median'. */
  center?: 'median' | 'zscore' | 'quantile' | 'none'
  /** Feature selection: run the embedding on only the N most-variable genes (0 / undefined = all).
   *  With p ≫ n, restricting to the most variable proteins keeps the sample covariance from going
   *  isotropic, so a real group axis dominates PC1 instead of being buried in noise dimensions. */
  topVar?: number
  /** Log transform (standardize path). 'auto' follows Clean data (`autoScale`, see plotScaleOf);
   *  'log2'/'log10' force it; 'none' forces linear. A linear matrix of raw intensities (PCA on
   *  linear intensity) is a common cause of a flat scree. Defaults to 'auto'. */
  transform?: 'auto' | 'log2' | 'log10' | 'none'
  /** what 'auto' resolves to: the scale the plots show Clean data on. Unset → the old guess (log₂
   *  when the values look like raw intensity, else as-is). */
  autoScale?: ValueScale
  /** Replicate handling (standardize path). 'individual' embeds every replicate; 'mean' averages
   *  replicates to condition means first, cutting per-protein noise so a real group axis rises above
   *  the noise floor. Defaults to 'individual'. */
  replicates?: 'individual' | 'mean'
}

/** Pull the condition values off a standardized/compare row into a ClusterMeta. Numeric dose/time
 *  are coerced to numbers (null when absent); cell/cmpd and every custom condition stay strings. */
function clusterMetaOf(row: Record<string, unknown> | object): ClusterMeta {
  const r = row as Record<string, unknown>
  const num = (v: unknown): number | null =>
    v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
  const extra = r.extra as Record<string, string> | undefined
  return {
    cell: r.cell != null ? String(r.cell) : '',
    cmpd: r.cmpd != null ? String(r.cmpd) : '',
    dose: num(r.dose),
    time: num(r.time),
    ...(extra ? { extra: { ...extra } } : null),
    ...(num(r.rep) != null ? { rep: num(r.rep) as number } : null)
  }
}

/** Colour an embedding by a COMPUTED grouping rather than by a condition. Reserved as a `colorBy`
 *  value; it can't collide with a condition key (those are the presets or `@slug`). */
export const CLUSTER_COLOR = 'cluster'
/** Colour an embedding by its condition groups: each distinct combination of the chosen
 *  conditions (ClusterConfig.groupConds — every condition by default, so one colour per condition
 *  group, its replicates) its own colour. Reserved as CLUSTER_COLOR is; the run groups by the
 *  full condition identity, the view by the chosen conditions. */
export const GROUP_COLOR = 'groups'
/** What an embedding may be coloured by: any condition, the computed clustering, or the condition
 *  groups. */
export type ClusterColorBy = ConditionKey | typeof CLUSTER_COLOR | typeof GROUP_COLOR
/** Whether an embedding's colouring is one condition's (not the clustering or the groups). */
export const colorByCond = (c: ClusterColorBy): c is ConditionKey =>
  c !== CLUSTER_COLOR && c !== GROUP_COLOR

/** A cluster/heatmap meta's value for one condition, read the same way everywhere. Custom
 *  conditions live in `extra`; the view must never index the meta object with a custom key. */
export function metaValue(
  m: { extra?: Record<string, string> },
  c: ConditionKey
): string | number | null {
  if (isCustomCond(c)) return m.extra?.[customSlug(c)] ?? ''
  return (m as unknown as Record<string, string | number | null>)[c] ?? null
}

/** Core embedding: given a genes×items log2 matrix (NaN = missing) and per-item
 *  labels/colors, z-score each gene (center + scale to unit SD, mean-imputing missing),
 *  transpose to items×genes, and embed to 2-D. Shared by the sample (standardize) and
 *  responsome (compare) paths. */
function embedMatrix(
  M: number[][],
  items: Array<{ label: string; group: string; cond: string; meta: ClusterMeta }>,
  opts: ClusterOptions,
  /** display label per row of `M`, for naming the biplot's loading arrows; omit to skip them */
  geneLabels?: string[]
): ClusterData {
  const nItems = items.length
  // Missing-value fraction across the full gene×item matrix — reported so a flat scree can be
  // diagnosed (heavy missingness + mean-imputation is a common cause).
  let missCnt = 0
  let cellCnt = 0
  for (const row of M)
    for (let s = 0; s < nItems; s++) {
      cellCnt++
      if (!Number.isFinite(row[s])) missCnt++
    }
  const missingPct = cellCnt ? (100 * missCnt) / cellCnt : 0
  // 'complete' (Spectronaut-style): drop any gene with a gap in any item, so PCA runs on fully
  // quantified proteins with no imputation. 'impute' (default): keep every gene (gaps filled with
  // the gene mean below).
  // Both filters below select INDICES rather than rows, so `geneLabels` can be narrowed the same
  // way and a loading stays attached to the gene it came from.
  // With many samples, few genes (often none) are quantified in every one of them — 'complete'
  // would leave nothing to embed. Below MIN_COMPLETE_FEATURES complete genes it falls back to
  // 'impute', and says so (diag.completeFallback = how many genes 'complete' would have kept).
  const all = M.map((_, i) => i)
  let keep = all
  let completeFallback: number | undefined
  if ((opts.missing ?? 'complete') === 'complete') {
    const complete = all.filter((i) => M[i].every((v) => Number.isFinite(v)))
    if (complete.length >= MIN_COMPLETE_FEATURES || complete.length === M.length) keep = complete
    else completeFallback = complete.length
  }
  // Feature selection: keep only the `topVar` most-variable genes (by log2 variance across items).
  // With p ≫ n, the many low-signal genes make the sample covariance nearly isotropic, so every PC
  // gets ~1/(n−1) of the variance and a real group axis is buried; restricting to the most variable
  // proteins (standard proteomics PCA practice) concentrates the variance on the informative axes.
  const topVar = opts.topVar ?? 0
  if (topVar > 0 && keep.length > topVar) {
    const geneVar = (row: number[]): number => {
      let sum = 0
      let cnt = 0
      for (let s = 0; s < nItems; s++)
        if (Number.isFinite(row[s])) {
          sum += row[s]
          cnt++
        }
      if (cnt < 2) return 0
      const mean = sum / cnt
      let ss = 0
      for (let s = 0; s < nItems; s++) if (Number.isFinite(row[s])) ss += (row[s] - mean) ** 2
      return ss / (cnt - 1)
    }
    keep = keep
      .map((i) => ({ i, v: geneVar(M[i]) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, topVar)
      .map((e) => e.i)
  }
  const Mused = keep.map((i) => M[i])
  const labelsUsed = geneLabels ? keep.map((i) => geneLabels[i]) : undefined
  const nG = Mused.length
  if (nItems < 2 || nG < 1) {
    return {
      points: [],
      method: opts.method,
      varExplained: [0, 0],
      colorBy: opts.colorBy,
      diag: { items: nItems, features: nG, missingPct, completeFallback }
    }
  }
  // Center each gene across items (subtract the gene mean), and — in 'unit' mode — divide by its
  // SD so every gene contributes equally to the embedding (correlation PCA: a high-variance
  // protein no longer dominates). In 'none' mode we only center, keeping each gene's native
  // variance so high-variance discriminators dominate (covariance PCA — matches Spectronaut).
  // Missing → 0 (the centered mean); a constant gene (SD 0) in 'unit' mode → all 0.
  const unit = (opts.scale ?? 'none') === 'unit'
  for (let g = 0; g < nG; g++) {
    const row = Mused[g]
    let sum = 0
    let cnt = 0
    for (let s = 0; s < nItems; s++)
      if (Number.isFinite(row[s])) {
        sum += row[s]
        cnt++
      }
    const mean = cnt ? sum / cnt : 0
    let ss = 0
    for (let s = 0; s < nItems; s++) if (Number.isFinite(row[s])) ss += (row[s] - mean) ** 2
    const sd = cnt > 1 ? Math.sqrt(ss / (cnt - 1)) : 0
    const denom = unit ? sd : 1
    for (let s = 0; s < nItems; s++)
      row[s] = Number.isFinite(row[s]) && denom > 0 ? (row[s] - mean) / denom : 0
  }
  // items×genes matrix D = Mᵀ, fed to the chosen embedding.
  const D: number[][] = Array.from({ length: nItems }, (_, s) => Mused.map((geneRow) => geneRow[s]))
  const { coords, varExplained, scree, loadings } = embed2D(D, opts.method)
  // Colouring by cluster replaces each point's condition-derived group with its cluster label.
  const cl = opts.colorBy === CLUSTER_COLOR ? clusterGroups(coords, D, items, opts) : null
  const topLo = topLoadings(loadings, labelsUsed, opts.loadings ?? 0)
  const points: ClusterPoint[] = items.map((it, i) => ({
    x: coords[i][0],
    y: coords[i][1],
    sample: it.label,
    group: cl ? cl.labels[i] : it.group,
    cond: it.cond,
    meta: it.meta
  }))
  return {
    points,
    method: opts.method,
    varExplained,
    colorBy: opts.colorBy,
    ...(cl ? { clusterK: cl.k } : null),
    ...(topLo ? { loadings: topLo } : null),
    diag: { items: nItems, features: nG, missingPct, scree, completeFallback }
  }
}

/**
 * The `n` most influential features in the plotted component plane, longest first.
 *
 * "Most influential" is vector length in that plane — a long vector means the feature moves samples
 * far along the two components being drawn. Values are the loadings as computed, unscaled: the
 * loadings plot draws them on their own axes, so there is no score range to fit them to.
 */
function topLoadings(
  loadings: Array<[number, number]> | undefined,
  labels: string[] | undefined,
  n: number
): Array<{ label: string; x: number; y: number }> | null {
  if (!loadings || !labels || n <= 0) return null
  const mag = (p: [number, number]): number => Math.hypot(p[0], p[1])
  const top = loadings
    .map((p, i) => ({ p, label: labels[i] ?? `f${i}` }))
    .sort((a, b) => mag(b.p) - mag(a.p))
    .slice(0, n)
  return top.length ? top.map(({ p, label }) => ({ label, x: p[0], y: p[1] })) : null
}

/**
 * Assign each item a cluster label, for `colorBy: 'cluster'`.
 *
 * Clusters the embedded coordinates or the full feature matrix (`clusterOn`), cut into a group
 * count from `clusterCount`. Labels are `Cluster 1..k` in dendrogram leaf order, so the numbering
 * is stable for a given input rather than depending on item order.
 */
function clusterGroups(
  coords: Array<[number, number]>,
  D: number[][],
  items: Array<{ cond: string }>,
  opts: ClusterOptions
): { labels: string[]; k: number } {
  const src: number[][] =
    (opts.clusterOn ?? 'coords') === 'features' ? D : coords.map((c) => [c[0], c[1]])
  const n = src.length
  const method = opts.clusterCount ?? 'fixed'
  const k =
    method === 'conditions'
      ? new Set(items.map((it) => it.cond)).size
      : method === 'auto'
        ? suggestClusterCount(src)
        : (opts.clusterK ?? 3)
  const kk = Math.max(1, Math.min(Math.round(k), n))
  const groups = clusterRowGroups(src, kk)
  const labels = new Array<string>(n).fill('Cluster 1')
  groups.forEach((g, gi) => {
    for (const i of g) labels[i] = `Cluster ${gi + 1}`
  })
  return { labels, k: groups.length }
}

/** Per-sample (column) normalization of a genes×samples matrix, in place. NaN = missing (skipped).
 *  'median': subtract each column's median. 'zscore': subtract mean and divide by SD (per-sample
 *  standardization — removes offset AND scale, like Pearson). 'quantile': map every column to a
 *  common reference distribution (the average of the columns' sorted values, rank-interpolated to
 *  handle unequal missingness). 'none': leave untouched. */
function normalizeSamples(
  M: number[][],
  nSamp: number,
  mode: 'median' | 'zscore' | 'quantile' | 'none'
): void {
  if (mode === 'none') return
  const nG = M.length
  if (mode === 'quantile') {
    // Reference distribution on a fixed quantile grid, averaged across columns.
    const Q = 256
    const ref = new Float64Array(Q)
    let usedCols = 0
    const colSorted: number[][] = []
    for (let c = 0; c < nSamp; c++) {
      const col: number[] = []
      for (let g = 0; g < nG; g++) if (Number.isFinite(M[g][c])) col.push(M[g][c])
      col.sort((a, b) => a - b)
      colSorted.push(col)
      if (col.length < 2) continue
      usedCols++
      for (let q = 0; q < Q; q++) ref[q] += quantileAt(col, q / (Q - 1))
    }
    if (usedCols === 0) return
    for (let q = 0; q < Q; q++) ref[q] /= usedCols
    // Map each finite value to the reference at its within-column fractional rank.
    for (let c = 0; c < nSamp; c++) {
      const col = colSorted[c]
      const m = col.length
      if (m < 2) continue
      for (let g = 0; g < nG; g++) {
        const v = M[g][c]
        if (!Number.isFinite(v)) continue
        // fractional rank of v within the sorted column (ties → average position)
        let lo = 0
        let hi = m
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (col[mid] < v) lo = mid + 1
          else hi = mid
        }
        let hi2 = lo
        while (hi2 < m && col[hi2] === v) hi2++
        const rank = (lo + hi2 - 1) / 2
        M[g][c] = quantileAtGrid(ref, m > 1 ? rank / (m - 1) : 0.5)
      }
    }
    return
  }
  for (let c = 0; c < nSamp; c++) {
    let sum = 0
    let cnt = 0
    for (let g = 0; g < nG; g++)
      if (Number.isFinite(M[g][c])) {
        sum += M[g][c]
        cnt++
      }
    if (cnt === 0) continue
    if (mode === 'zscore') {
      const mean = sum / cnt
      let ss = 0
      for (let g = 0; g < nG; g++) if (Number.isFinite(M[g][c])) ss += (M[g][c] - mean) ** 2
      const sd = cnt > 1 ? Math.sqrt(ss / (cnt - 1)) : 0
      for (let g = 0; g < nG; g++)
        if (Number.isFinite(M[g][c])) M[g][c] = sd > 0 ? (M[g][c] - mean) / sd : 0
    } else {
      // median
      const col: number[] = []
      for (let g = 0; g < nG; g++) if (Number.isFinite(M[g][c])) col.push(M[g][c])
      col.sort((a, b) => a - b)
      const h = col.length >> 1
      const med = col.length % 2 ? col[h] : (col[h - 1] + col[h]) / 2
      for (let g = 0; g < nG; g++) if (Number.isFinite(M[g][c])) M[g][c] -= med
    }
  }
}

/** Value at fractional position t∈[0,1] of an ascending array (linear interpolation). */
function quantileAt(sorted: number[], t: number): number {
  const n = sorted.length
  if (n === 0) return 0
  if (n === 1) return sorted[0]
  const pos = t * (n - 1)
  const i = Math.floor(pos)
  const f = pos - i
  return i + 1 < n ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i]
}

/** Value at fractional position t∈[0,1] of an ascending Float64Array grid (linear interpolation). */
function quantileAtGrid(grid: Float64Array, t: number): number {
  const n = grid.length
  const pos = Math.max(0, Math.min(1, t)) * (n - 1)
  const i = Math.floor(pos)
  const f = pos - i
  return i + 1 < n ? grid[i] * (1 - f) + grid[i + 1] * f : grid[i]
}

/** Average replicates to one row per (uniqID × condition), so the embedding runs on condition
 *  means instead of individual replicates. Replicate averaging cuts per-protein technical noise
 *  (~√n_rep), which in a noisy p ≫ n dataset can lift a real group axis well above the noise floor
 *  (a flat scree over individual replicates is a common symptom). */
function collapseReplicates(rows: StandardRow[]): StandardRow[] {
  const key = (r: StandardRow): string =>
    `${r.uniqID}\u0001${r.cell}\u0001${r.cmpd}\u0001${r.dose ?? ''}\u0001${r.time ?? ''}`
  const agg = new Map<string, { sum: number; n: number; proto: StandardRow }>()
  for (const r of rows) {
    if (r.value == null || !Number.isFinite(r.value)) continue
    const k = key(r)
    let a = agg.get(k)
    if (!a) agg.set(k, (a = { sum: 0, n: 0, proto: r }))
    a.sum += r.value
    a.n++
  }
  return [...agg.values()].map((a) => ({ ...a.proto, rep: 1, value: a.sum / a.n }))
}

/** Sample embedding (PCA / UMAP / t-SNE) from the standardized genes×samples log2
 *  matrix — one point per sample, colored by a condition. */
export function buildCluster(rows: StandardRow[], opts: ClusterOptions): ClusterData {
  if ((opts.replicates ?? 'individual') === 'mean') rows = collapseReplicates(rows)
  const sampleIdx = new Map<string, number>()
  const sampleMeta: StandardRow[] = []
  const geneIdx = new Map<string, number>()
  for (const r of rows) {
    const s = sampleLabel(r)
    if (!sampleIdx.has(s)) {
      sampleIdx.set(s, sampleMeta.length)
      sampleMeta.push(r)
    }
    if (!geneIdx.has(r.uniqID)) geneIdx.set(r.uniqID, geneIdx.size)
  }
  // Only log2 the matrix when the values look like RAW intensity (all positive, ≥2 decades of
  // range) — the same heuristic the heatmap/QC/table use. If the standardized values are already
  // on a log scale, they're used as-is (double-logging would distort the embedding, and negative
  // log values would be dropped as NaN). NaN = missing.
  let min = Infinity
  let max = -Infinity
  for (const r of rows)
    if (r.value != null && Number.isFinite(r.value)) {
      if (r.value < min) min = r.value
      if (r.value > max) max = r.value
    }
  // Which log transform to apply. 'auto' (default) logs only when the values look like RAW
  // intensity (all positive, ≥2 decades of range) — matching the heatmap/QC/table; already-log
  // values are left as-is (double-logging distorts the embedding). 'log2'/'log10' force it (needed
  // when the auto guess is wrong — e.g. a narrow-range raw matrix reads as "already log" and PCA
  // then runs on linear intensities, which high-abundance proteins dominate). 'none' forces linear.
  const tOpt = opts.transform ?? 'auto'
  const applied: 'log2' | 'log10' | 'none' =
    tOpt !== 'auto'
      ? tOpt
      : opts.autoScale
        ? opts.autoScale === 'linear'
          ? 'none'
          : opts.autoScale
        : min > 0 && max / min >= 100
          ? 'log2'
          : 'none'
  const tf = (v: number): number =>
    applied === 'log2'
      ? v > 0
        ? Math.log2(v)
        : NaN
      : applied === 'log10'
        ? v > 0
          ? Math.log10(v)
          : NaN
        : v
  const M: number[][] = Array.from({ length: geneIdx.size }, () =>
    new Array(sampleMeta.length).fill(NaN)
  )
  for (const r of rows) {
    const v = r.value
    const lv = v != null && Number.isFinite(v) ? tf(v) : NaN
    M[geneIdx.get(r.uniqID) as number][sampleIdx.get(sampleLabel(r)) as number] = lv
  }
  // Per-sample (column) normalization, so per-run technical differences don't dominate the
  // embedding. 'median' subtracts each sample's median (removes an OFFSET only). 'zscore' also
  // divides by each sample's SD (removes SCALE too — the same per-sample standardization Pearson
  // correlation applies, so PCA reflects pattern rather than a sample's dynamic range). 'quantile'
  // forces every sample to a common distribution (the strongest normalization; matches tools that
  // quantile/median-normalize before PCA). 'none' leaves the log2 values untouched.
  normalizeSamples(M, sampleMeta.length, opts.center ?? 'none')
  const items = sampleMeta.map((meta) => ({
    label: sampleLabel(meta),
    // Colouring by cluster has no condition to read — embedMatrix replaces the group with the
    // computed label once the embedding (which the clustering may run on) exists.
    group:
      opts.colorBy === GROUP_COLOR
        ? sampleCond(meta)
        : colorByCond(opts.colorBy)
          ? String(condValue(meta, opts.colorBy) ?? '')
          : '',
    cond: sampleCond(meta),
    meta: clusterMetaOf(meta)
  }))
  // Gene order matches the matrix rows (geneIdx was filled in first-seen order), labelled for the
  // biplot's arrows.
  const geneLabels = [...geneIdx.keys()].map((id) => opts.displayMap?.[id] ?? id)
  const out = embedMatrix(M, items, opts, geneLabels)
  // Record what the log decision was and the raw value range, so the caption can show whether the
  // PCA ran on log or linear values (a wrong auto-guess is a common cause of a flat scree).
  if (out.diag) out.diag.transform = applied === 'none' ? 'linear' : applied
  if (out.diag && Number.isFinite(min) && Number.isFinite(max)) out.diag.range = [min, max]
  return out
}

/** Condition key for a comparison row: its present context columns joined, e.g.
 *  "E28|10|24". Mirrors omicViz pca_response's `_cond`. */
function conditionLabel(r: CompareResultRow): string {
  return [
    ...VALID_CONDITIONS.map((c) => (r as unknown as Record<string, unknown>)[c]),
    ...Object.keys(r.extra ?? {})
      .sort()
      .map((k) => r.extra![k])
  ]
    .filter((v) => v !== '' && v != null)
    .join('|')
}

/** Responsome embedding: the same PCA / UMAP / t-SNE, but over a comparison's
 *  genes×conditions log2FC matrix — one point per condition (omicViz's pca_response),
 *  colored by a condition. Valid colour-by dims come from responseColorDims: the context
 *  conditions plus any comparison dim (e.g. cmpd in a multi-compound two-way ANOVA) that
 *  actually varies across the pooled comparisons. An invalid `colorBy` falls back to the
 *  first such dim; the effective choice is returned in `colorBy`. */
export function buildResponseCluster(rows: CompareResultRow[], opts: ClusterOptions): ClusterData {
  const contextDims = responseColorDims(rows)
  // 'cluster' is not a context dim but IS a valid choice — keep it rather than snapping to a
  // condition; embedMatrix fills the groups in.
  const colorBy: ClusterColorBy =
    !colorByCond(opts.colorBy) || contextDims.includes(opts.colorBy)
      ? opts.colorBy
      : (contextDims[0] ?? opts.colorBy)
  const condIdx = new Map<string, number>()
  const condMeta: CompareResultRow[] = []
  const geneIdx = new Map<string, number>()
  for (const r of rows) {
    const c = conditionLabel(r)
    if (!condIdx.has(c)) {
      condIdx.set(c, condMeta.length)
      condMeta.push(r)
    }
    if (!geneIdx.has(r.uniqID)) geneIdx.set(r.uniqID, geneIdx.size)
  }
  // genes×conditions log2FC matrix (NaN for missing)
  const M: number[][] = Array.from({ length: geneIdx.size }, () =>
    new Array(condMeta.length).fill(NaN)
  )
  for (const r of rows) {
    const v = r.log2FC
    M[geneIdx.get(r.uniqID) as number][condIdx.get(conditionLabel(r)) as number] =
      v != null && Number.isFinite(v) ? v : NaN
  }
  const items = condMeta.map((meta) => {
    const label = conditionLabel(meta)
    // Each condition carries a single log2FC (no replicates), so cond == label —
    // centroid mode collapses to the point itself (the single-replicate fallback).
    return {
      label,
      group:
        colorBy === GROUP_COLOR
          ? label
          : colorByCond(colorBy)
            ? String(ctxValue(meta, colorBy) ?? '')
            : '',
      cond: label,
      meta: clusterMetaOf(meta)
    }
  })
  return embedMatrix(M, items, { ...opts, colorBy })
}
