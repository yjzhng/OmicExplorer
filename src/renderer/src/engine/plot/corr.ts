/**
 * The sample-correlation matrix (Clean data).
 * Plain data for the renderer to turn into Plotly traces (no Plotly dependency here).
 */
import { condValue } from '../compare/compare'
import { clusterRowOrder } from '../stats/cluster'
import { labelGroups, sampleIndex } from '../data/sampleIndex'
import type { ValueScale } from '../data/scale'
import { customCond, type StandardizeResult, type StandardRow } from '../types'
import { type SampleMeta, type SampleOrdering, sortSamples } from './heatmap'

// ── standardize sample-correlation matrix ─────────────────────────────────────────

/** How a sample pair is scored (see buildSampleCorr): Pearson r (do they fall on a straight
 *  line), Spearman ρ (do they rank the proteins alike), or Lin's concordance (are they the same values
 *  — a shift or a stretch counts against it). */
export type CorrMetric = 'pearson' | 'spearman' | 'ccc'
export const CORR_METRICS: readonly CorrMetric[] = ['pearson', 'spearman', 'ccc']
/** A stored metric as offered now (one no longer offered reads as Pearson). */
export const corrMetricOf = (m: unknown): CorrMetric =>
  CORR_METRICS.includes(m as CorrMetric) ? (m as CorrMetric) : 'pearson'
export const CORR_METRIC_LABEL: Record<CorrMetric, string> = {
  pearson: 'Pearson r',
  spearman: 'Spearman ρ',
  ccc: 'CCC'
}

export interface CorrData {
  /** what each cell scores */
  metric: CorrMetric
  /** sample labels, in (optionally clustered) row/column order */
  labels: string[]
  /** each sample's condition values (its replicate included), aligned with `labels` — for the
   *  tooltip */
  metas: SampleMeta[]
  /** symmetric matrix z[i][j] = the metric of (sample_i, sample_j); diagonal 1 */
  z: number[][]
  /** smallest and largest off-diagonal value (the colour scale's range) */
  min: number
  max: number
}

/** Each sample's values as ranks among its own present values (ties averaged; NaN stays NaN) —
 *  Spearman's input. Ranked once per sample rather than per pair: with pairwise-complete data a
 *  pair's ranks are its samples' own, a close approximation unless many proteins are missing. */
function rankVector(v: Float64Array): Float64Array {
  const idx: number[] = []
  for (let k = 0; k < v.length; k++) if (!Number.isNaN(v[k])) idx.push(k)
  idx.sort((a, b) => v[a] - v[b])
  const out = new Float64Array(v.length).fill(NaN)
  for (let i = 0; i < idx.length;) {
    let j = i
    while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++
    const rank = (i + j) / 2 + 1
    for (let t = i; t <= j; t++) out[idx[t]] = rank
    i = j + 1
  }
  return out
}

/** A sample pair's scores under one metric, the samples in data order (see SampleCorrAll). */
export interface CorrMatrix {
  z: number[][]
  min: number
  max: number
  /** the samples' clustered order (by their profile of scores): what `cluster` shows */
  clustered: number[]
}

/** A correlation plot's run (in the worker): the sample-pair matrix under every metric asked for,
 *  each with its clustered order — so switching the metric, clustering or the sample order on the
 *  tile only re-arranges it (arrangeSampleCorr). Samples in data order. */
export interface SampleCorrAll {
  labels: string[]
  /** each sample's active conditions (the tooltip) */
  metas: SampleMeta[]
  /** each sample's own conditions, unmasked — what an unclustered order sorts on */
  ownMetas: SampleMeta[]
  matrices: Partial<Record<CorrMetric, CorrMatrix>>
}

/**
 * All-samples × all-samples sample-pair scores of a standardized result, for a QC
 * correlation heatmap. A "sample" is the active-condition combo + replicate; each pair is
 * correlated over the proteins present in BOTH (pairwise-complete, since per-sample dropout
 * makes a global complete-case intersection nearly empty at scale). Values are log10'd first
 * when they look like raw intensity (matching the heatmap/QC scale). Every metric in `metrics`
 * (default all), each with its clustered order.
 */
export function buildSampleCorrAll(
  std: Pick<StandardizeResult, 'rows' | 'activeConditions'>,
  /** `scale`: the scale abundance is shown on (see plotScaleOf); unset → the old guess (log₁₀
   *  when the values look like raw intensity). A log base doesn't change Pearson r; log vs linear
   *  does. */
  opts: { scale?: ValueScale; metrics?: readonly CorrMetric[] } = {}
): SampleCorrAll {
  const conds = std.activeConditions
  const sampleLabel = (r: StandardRow): string => {
    const p = conds.map((c) => String(condValue(r, c) ?? '')).filter((x) => x !== '')
    if (r.rep != null) p.push(`r${r.rep}`)
    return p.join(' · ') || 'sample'
  }
  // Register samples and genes; find the value range for the log heuristic.
  // (off the shared sample index: each label made once per sample, the rows read as ids)
  const ix = sampleIndex(std)
  const groups = labelGroups(ix, sampleLabel)
  const sampleIdx = new Int32Array(groups.labels.length).fill(-1) // label id → matrix index
  const geneIdx = new Int32Array(ix.genes.length).fill(-1) // gene id → vector position
  let G = 0
  const labels: string[] = []
  const metas: SampleMeta[] = []
  // each sample's own conditions, unmasked — what `opts.order` sorts on (as the heatmap's do)
  const ownMetas: SampleMeta[] = []
  let min = Infinity
  let max = -Infinity
  for (let row = 0; row < ix.n; row++) {
    const v = ix.value[row]
    if (Number.isNaN(v)) continue
    const k = groups.of[ix.sample[row]]
    if (sampleIdx[k] < 0) {
      sampleIdx[k] = labels.length
      labels.push(groups.labels[k])
      const r = ix.reps[ix.sample[row]]
      // only the active conditions: the ones the label (and so the sample) is made of
      const act = new Set(conds)
      const extra = Object.fromEntries(
        Object.entries(r.extra ?? {}).filter(([k]) => act.has(customCond(k)))
      )
      metas.push({
        cell: act.has('cell') ? r.cell : '',
        cmpd: act.has('cmpd') ? r.cmpd : '',
        dose: act.has('dose') ? r.dose : null,
        time: act.has('time') ? r.time : null,
        rep: r.rep,
        ...(Object.keys(extra).length ? { extra } : null)
      })
      ownMetas.push({
        cell: r.cell,
        cmpd: r.cmpd,
        dose: r.dose,
        time: r.time,
        rep: r.rep,
        ...(r.extra ? { extra: r.extra } : null)
      })
    }
    if (geneIdx[ix.gene[row]] < 0) geneIdx[ix.gene[row]] = G++
    if (v < min) min = v
    if (v > max) max = v
  }
  const S = labels.length
  const log = opts.scale ? opts.scale !== 'linear' : min > 0 && max / min >= 100

  // Dense per-sample vectors over the gene axis (NaN = protein absent in that sample).
  const vecs = Array.from({ length: S }, () => new Float64Array(G).fill(NaN))
  for (let row = 0; row < ix.n; row++) {
    const v = ix.value[row]
    if (Number.isNaN(v)) continue
    vecs[sampleIdx[groups.of[ix.sample[row]]]][geneIdx[ix.gene[row]]] = log ? Math.log10(v) : v
  }

  // Every sample pair, scored over the proteins both carry (pairwise-complete). Spearman is
  // Pearson on the samples' ranks.
  const scoreAll = (metric: CorrMetric): CorrMatrix => {
    const cols = metric === 'spearman' ? vecs.map(rankVector) : vecs
    const self = 1
    const z = Array.from({ length: S }, () => new Array<number>(S).fill(self))
    // (the floor never above 1, as before)
    let lo = 1
    let hi = -Infinity
    for (let i = 0; i < S; i++) {
      const a = cols[i]
      for (let j = i + 1; j < S; j++) {
        const b = cols[j]
        let r: number
        let n = 0
        let sx = 0
        let sy = 0
        let sxx = 0
        let syy = 0
        let sxy = 0
        for (let k = 0; k < G; k++) {
          const x = a[k]
          const y = b[k]
          if (Number.isNaN(x) || Number.isNaN(y)) continue
          n++
          sx += x
          sy += y
          sxx += x * x
          syy += y * y
          sxy += x * y
        }
        if (metric === 'ccc') {
          // Lin's concordance: 2·cov / (var x + var y + (mean x − mean y)²), population moments
          const mx = sx / n
          const my = sy / n
          const cov = sxy / n - mx * my
          const den = sxx / n - mx * mx + (syy / n - my * my) + (mx - my) ** 2
          r = n >= 2 && den > 0 ? (2 * cov) / den : 0
        } else {
          const cov = n * sxy - sx * sy
          const vx = n * sxx - sx * sx
          const vy = n * syy - sy * sy
          const denom = Math.sqrt(vx * vy)
          r = n >= 2 && denom > 0 ? cov / denom : 0
        }
        z[i][j] = r
        z[j][i] = r
        if (r < lo) lo = r
        if (r > hi) hi = r
      }
    }
    return {
      z,
      min: Number.isFinite(lo) ? lo : 0,
      max: Number.isFinite(hi) ? hi : self,
      // Clustered by their profile of scores so replicate groups sit together
      clustered:
        S > 2
          ? // each metric clustered on itself, as a distance, 1 − its value (1 − r, 1 − ρ,
            // 1 − CCC): identical samples at 0
            clusterRowOrder(
              z.map((row) => row.map((v) => 1 - v)),
              { precomputed: true }
            )
          : Array.from({ length: S }, (_, i) => i)
    }
  }
  const matrices: SampleCorrAll['matrices'] = {}
  for (const m of opts.metrics ?? CORR_METRICS) matrices[m] = scoreAll(m)
  return { labels, metas, ownMetas, matrices }
}

/** A correlation plot's matrix as drawn: one metric of a SampleCorrAll, its samples clustered
 *  (default) or, unclustered, in `order` (natural: by condition; original: the data's). */
export function arrangeSampleCorr(
  all: SampleCorrAll,
  metric: CorrMetric,
  opts: {
    cluster?: boolean
    /** the samples' order when they aren't clustered (unset: as they come in the data) */
    order?: SampleOrdering
  } = {}
): CorrData {
  const m = all.matrices[metric]
  const S = all.labels.length
  if (!m) return { metric, labels: [], metas: [], z: [], min: 0, max: 1 }
  const order =
    (opts.cluster ?? true) && S > 2
      ? m.clustered
      : opts.order
        ? sortSamples(
            Array.from({ length: S }, (_, i) => i),
            opts.order,
            (i) => all.ownMetas[i],
            true
          )
        : null
  return {
    metric,
    labels: order ? order.map((i) => all.labels[i]) : all.labels,
    metas: order ? order.map((i) => all.metas[i]) : all.metas,
    z: order ? order.map((i) => order.map((j) => m.z[i][j])) : m.z,
    min: m.min,
    max: m.max
  }
}

/** One metric's matrix of a standardized result, arranged (buildSampleCorrAll then
 *  arrangeSampleCorr) — the plot runs the two apart (the first in the worker). */
export function buildSampleCorr(
  std: Pick<StandardizeResult, 'rows' | 'activeConditions'>,
  /** `scale`: the scale abundance is shown on (see plotScaleOf); unset → the old guess (log₁₀
   *  when the values look like raw intensity). A log base doesn't change Pearson r; log vs linear
   *  does. */
  opts: {
    cluster?: boolean
    scale?: ValueScale
    /** the samples' order when they aren't clustered (unset: as they come in the data) */
    order?: SampleOrdering
    /** how each pair is scored (unset: Pearson r) */
    metric?: CorrMetric
  } = {}
): CorrData {
  const metric = opts.metric ?? 'pearson'
  return arrangeSampleCorr(
    buildSampleCorrAll(std, { scale: opts.scale, metrics: [metric] }),
    metric,
    opts
  )
}
