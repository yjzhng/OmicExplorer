/**
 * The Clean data heatmap: genes × samples, the samples' order and hierarchy.
 * Plain data for the renderer to turn into Plotly traces (no Plotly dependency here).
 */
import { sampleLabel, sampleName } from '../data/sampleLabel'
import { clusterRowGroups } from '../stats/cluster'
import { isSampleIndex, labelGroups, type SampleIndex } from '../data/sampleIndex'
import { type ConditionKey, condsIn, type SampleConds, type StandardRow } from '../types'
import { metaValue } from './cluster'

// ── heatmap ────────────────────────────────────────────────────────────────────

/** Per-sample condition values, for the annotation tracks along the sample axis. */
export interface SampleMeta {
  cell: string
  cmpd: string
  dose: number | null
  time: number | null
  rep: number | null
  /** custom condition slug → value (categorical, so always a string) */
  extra?: Record<string, string>
}

export interface HeatmapData {
  /** z[geneIndex][sampleIndex] — log2 intensity, null for missing */
  z: Array<Array<number | null>>
  /** sample column labels */
  x: string[]
  /** gene row labels */
  y: string[]
  /** gene uniqIDs, aligned to `y` (for linked selection) */
  geneIds: string[]
  /** per-sample condition values, aligned with `x` (one entry per sample column) */
  samples: SampleMeta[]
  /** conditions present in the data (with values), shown as annotation tracks in this order */
  conds: ConditionKey[]
}

/** How a sample axis (heatmap columns, gene-bar conditions, QC groups) is ordered: 'natural' =
 *  by condition, in the hierarchy that groups the samples best (sampleHierarchy), then the
 *  replicate — with text in natural order (numbers in it numerically) and dose and time as
 *  numbers; 'original' = the data's own sample order. */
export type SampleOrder = 'natural' | 'original'

/** What orders a sample axis: the order, and — for 'original' — the data's samples in their
 *  order (StandardizeResult.samples). Without them 'original' keeps the rows' first-seen order. */
export interface SampleOrdering {
  by: SampleOrder
  samples?: readonly SampleConds[]
}

/** Whether a meta value is there (a custom condition's absent is ''). */
const present = (v: string | number | null): boolean => v !== '' && v != null

/**
 * The conditions a 'natural' sample axis sorts by, outermost first: those that don't vary, then
 * the varying ones in the order whose condition tracks break least (the replicate isn't one: it
 * always sorts last).
 *
 * Sorted by conditions c1, c2, …, the track of c_i breaks once per distinct combination of
 * c1 … c_i's values, a count that depends only on WHICH conditions sit at or above it — so the
 * fewest breaks over every order is found exactly over the subsets, not by trying sorts. A full
 * design comes out fewest levels outermost; an uneven one (a vehicle only at dose 0) is counted
 * as it is. Ties keep the usual order: cell, cmpd, dose, time, then the customs by name.
 */
export function sampleHierarchy(metas: readonly SampleMeta[]): ConditionKey[] {
  const all = condsIn(metas).filter((c) => metas.some((m) => present(metaValue(m, c))))
  const levels = (c: ConditionKey): number => new Set(metas.map((m) => metaValue(m, c))).size
  const fixed = all.filter((c) => levels(c) < 2)
  const vary = all.filter((c) => levels(c) >= 2)
  const n = vary.length
  // Past a dozen varying conditions (4096 subsets) keep the usual order.
  if (n < 2 || n > 12) return [...fixed, ...vary]
  const full = (1 << n) - 1
  // distinct[S] = how many distinct value combinations the conditions in S take
  const distinct = new Array<number>(1 << n).fill(1)
  for (let S = 1; S <= full; S++) {
    const keys = new Set<string>()
    for (const m of metas) {
      let k = ''
      for (let i = 0; i < n; i++) if (S & (1 << i)) k += `${metaValue(m, vary[i]) ?? ''}\u0001`
      keys.add(k)
    }
    distinct[S] = keys.size
  }
  // rest[S] = the fewest breaks below the conditions in S, placed outermost
  const rest = new Array<number>(1 << n).fill(0)
  for (let S = full - 1; S >= 0; S--) {
    let best = Infinity
    for (let i = 0; i < n; i++)
      if (!(S & (1 << i))) best = Math.min(best, distinct[S | (1 << i)] + rest[S | (1 << i)])
    rest[S] = best
  }
  // Walk down from the top, taking at each level the first condition (in the usual order) that
  // still finishes at the fewest breaks.
  const order: ConditionKey[] = []
  let S = 0
  while (S !== full)
    for (let i = 0; i < n; i++) {
      const T = S | (1 << i)
      if (T !== S && distinct[T] + rest[T] === rest[S]) {
        order.push(vary[i])
        S = T
        break
      }
    }
  return [...fixed, ...order]
}

/** Sort a sample axis in place. `metaOf` reads a slot's condition values. `perSample` = slots are
 *  samples (the replicate tells them apart); otherwise they're conditions, replicates pooled, so
 *  the replicate plays no part. The sort is stable, so a slot 'original' can't place keeps its
 *  first-seen position after the placed ones. */
export function sortSamples<T>(
  items: T[],
  ordering: SampleOrdering,
  metaOf: (t: T) => SampleMeta,
  perSample: boolean
): T[] {
  if (ordering.by === 'original') {
    if (!ordering.samples?.length) return items
    const keyOf = (m: SampleMeta | SampleConds): string =>
      [
        m.cell,
        m.cmpd,
        m.dose ?? '',
        m.time ?? '',
        ...Object.keys(m.extra ?? {})
          .sort()
          .map((k) => `${k}=${m.extra![k]}`),
        perSample ? (m.rep ?? '') : ''
      ].join('\u0001')
    const rank = new Map<string, number>()
    ordering.samples.forEach((s, i) => {
      const k = keyOf(s)
      if (!rank.has(k)) rank.set(k, i)
    })
    const at = (t: T): number => rank.get(keyOf(metaOf(t))) ?? Infinity
    return items.sort((a, b) => {
      const ra = at(a)
      const rb = at(b)
      return ra === rb ? 0 : ra < rb ? -1 : 1
    })
  }
  const strCmp = (a: string, b: string): number =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  const numCmp = (a: number | null, b: number | null): number =>
    a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a - b
  // The conditions in the hierarchy that groups these slots best (sampleHierarchy), then the rep.
  const cmp = sampleHierarchy(items.map(metaOf)).map(
    (k): ((a: SampleMeta, b: SampleMeta) => number) =>
      k === 'dose' || k === 'time'
        ? (a, b) => numCmp(a[k], b[k])
        : (a, b) => strCmp(String(metaValue(a, k) ?? ''), String(metaValue(b, k) ?? ''))
  )
  return items.sort((a, b) => {
    const ma = metaOf(a)
    const mb = metaOf(b)
    for (const f of cmp) {
      const c = f(ma, mb)
      if (c !== 0) return c
    }
    return perSample ? numCmp(ma.rep, mb.rep) : 0
  })
}

export interface HeatmapOptions {
  /** the sample columns' order (default natural) */
  order?: SampleOrdering
  displayMap?: Record<string, string>
  /** log10-transform intensities for display (default true) */
  log10?: boolean
  /** cluster gene rows (average-linkage, euclidean) so similar genes are adjacent
   *  (default true; mirrors omicViz's clustered heatmap) */
  cluster?: boolean
  /** when clustering, cut the dendrogram into this many groups and order the GROUPS by their mean
   *  (log10) value, high→low, keeping the clustering within each group (default 8). */
  clusterGroups?: number
  /** focus genes (uniqIDs): when non-empty, show exactly these rows instead of all genes */
  focus?: string[]
}

/** Sample condition identity without the replicate — replicates of one condition
 *  share it, so the cluster can group them into a centroid. */
export function sampleCond(r: StandardRow): string {
  return [
    r.cell,
    r.cmpd,
    r.dose ?? '',
    r.time ?? '',
    ...Object.keys(r.extra ?? {})
      .sort()
      .map((k) => r.extra![k])
  ]
    .filter((p) => p !== '')
    .join(' · ')
}

/** Pivot the standardized long table into a genes × samples matrix for a heatmap. */
export function buildHeatmap(rows: Iterable<StandardRow>, opts: HeatmapOptions = {}): HeatmapData {
  const gen = buildHeatmapSteps(rows, opts)
  let r = gen.next()
  while (!r.done) r = gen.next(clusterRowGroups(r.value.matrix, r.value.k))
  return r.value
}

/** What buildHeatmapSteps hands out: the gene rows to cluster (missing cells imputed) and how
 *  many groups to cut the tree into — answered with clusterRowGroups' groups. */
export interface HeatmapClusterJob {
  matrix: number[][]
  k: number
  /** each matrix row's gene (uniqID) — so groups clustered elsewhere (a run's) can be matched */
  genes: string[]
}

/** buildHeatmap as steps: the pivot and layout here, the row clustering (O(n²) in time and
 *  memory — the slow part for a full proteome) handed out, so the dashboard can run it off the UI
 *  thread. Same result either way. */
export function* buildHeatmapSteps(
  /** the rows, read once in order and none kept (an array, or scanRows' scan) — or a Clean data
   *  result's sample index (sampleIndex), read as ids */
  rows: Iterable<StandardRow> | SampleIndex,
  opts: HeatmapOptions = {}
): Generator<HeatmapClusterJob, HeatmapData, number[][]> {
  const log10 = opts.log10 ?? true
  const { sampleOrder, sampleMeta, geneOrder, cell } = isSampleIndex(rows)
    ? heatmapPivotIx(rows, log10)
    : heatmapPivot(rows, log10)

  // Order the sample columns — by default naturally by condition (sampleHierarchy, then the
  // replicate), so samples sharing a condition block together.
  const ordering = opts.order ?? { by: 'natural' }
  sortSamples(sampleOrder, ordering, (s) => sampleMeta.get(s) as SampleMeta, true)

  // The intensity heatmap shows the full proteome — no top-N cap (that's the FC heatmap's
  // job). Focus genes (when set) narrow it to exactly those rows.
  const focus = opts.focus ?? []
  let genes = geneOrder
  if (focus.length > 0) {
    const present = new Set(geneOrder)
    genes = focus.filter((g) => present.has(g))
  }

  let z = genes.map((g) => sampleOrder.map((s) => cell(g, s)))
  // Cluster gene rows so similar profiles sit together (omicViz's clustered heatmap).
  // Impute missing cells with the sample-column mean before clustering, matching
  // omicViz's `fillna(pivot.mean())`; the displayed z keeps its real nulls.
  if ((opts.cluster ?? true) && genes.length > 2) {
    const colMean = sampleOrder.map((_, c) => {
      let sum = 0
      let cnt = 0
      for (let r = 0; r < z.length; r++) {
        const v = z[r][c]
        if (v != null && Number.isFinite(v)) {
          sum += v
          cnt++
        }
      }
      return cnt > 0 ? sum / cnt : 0
    })
    const imputed = z.map((row) =>
      row.map((v, c) => (v != null && Number.isFinite(v) ? v : colMean[c]))
    )
    // Cluster, then cut into groups and order the GROUPS by mean (log10) value, high→low — the
    // within-group clustering (leaf order) is preserved. Each gene's value = mean of its real cells.
    const geneVal = (row: (number | null)[]): number => {
      let sum = 0
      let cnt = 0
      for (const v of row)
        if (v != null && Number.isFinite(v)) {
          sum += v
          cnt++
        }
      return cnt > 0 ? sum / cnt : -Infinity // all-missing genes sink to the bottom
    }
    const groups: number[][] = yield { matrix: imputed, k: opts.clusterGroups ?? 8, genes }
    groups.sort((ga, gb) => {
      const va = ga.reduce((s, i) => s + geneVal(z[i]), 0) / ga.length
      const vb = gb.reduce((s, i) => s + geneVal(z[i]), 0) / gb.length
      return vb - va // descending: highest-value group first (top)
    })
    const order = groups.flat()
    genes = order.map((i) => genes[i])
    z = order.map((i) => z[i])
  }

  const y = genes.map((g) => opts.displayMap?.[g] ?? g)
  const samples = sampleOrder.map(
    (s) => sampleMeta.get(s) ?? { cell: '', cmpd: '', dose: null, time: null, rep: null }
  )
  // Conditions that actually carry values become annotation tracks (a value neither null nor ''
  // — a custom condition's "absent" — in some sample); empty conditions are skipped. Stacked as
  // the columns were sorted: the outermost condition on top.
  const conds = (ordering.by === 'natural' ? sampleHierarchy(samples) : condsIn(samples)).filter(
    (c) => samples.some((m) => present(metaValue(m, c)))
  )
  // the columns named on screen as every list of conditions is (" · "); sampleLabel keys the pivot
  return { z, x: samples.map(sampleName), y, geneIds: genes, samples, conds }
}

/** What a heatmap's pivot hands the layout: the samples and genes in first-appearance order, each
 *  sample's condition values, and a cell's value (null = none). */
interface HeatmapPivot {
  sampleOrder: string[]
  sampleMeta: Map<string, SampleMeta>
  geneOrder: string[]
  cell: (gene: string, sample: string) => number | null
}

/** A heatmap cell's value: log10 when asked (a non-positive one → null); a non-finite one → null. */
function heatCell(v: number | null, log10: boolean): number | null {
  if (v != null && Number.isFinite(v) && log10) v = v > 0 ? Math.log10(v) : null
  else if (v != null && !Number.isFinite(v)) v = null
  return v
}

/** The heatmap's pivot off the rows. */
function heatmapPivot(rows: Iterable<StandardRow>, log10: boolean): HeatmapPivot {
  const sampleOrder: string[] = []
  const sampleSeen = new Set<string>()
  const sampleMeta = new Map<string, SampleMeta>()
  const geneOrder: string[] = []
  const geneSeen = new Set<string>()
  const cells = new Map<string, number | null>() // `${gene}\u0000${sample}` → value

  for (const r of rows) {
    const s = sampleLabel(r)
    if (!sampleSeen.has(s)) {
      sampleSeen.add(s)
      sampleOrder.push(s)
      sampleMeta.set(s, {
        cell: r.cell,
        cmpd: r.cmpd,
        dose: r.dose,
        time: r.time,
        rep: r.rep,
        ...(r.extra ? { extra: { ...r.extra } } : null)
      })
    }
    if (!geneSeen.has(r.uniqID)) {
      geneSeen.add(r.uniqID)
      geneOrder.push(r.uniqID)
    }
    cells.set(`${r.uniqID}\u0000${s}`, heatCell(r.value, log10))
  }
  return {
    sampleOrder,
    sampleMeta,
    geneOrder,
    cell: (g, s) => cells.get(`${g}\u0000${s}`) ?? null
  }
}

/** The heatmap's pivot off a sample index: each label made once per sample, the cells a dense
 *  genes × samples grid (the last row for a cell wins, as in the rows' pivot). */
function heatmapPivotIx(ix: SampleIndex, log10: boolean): HeatmapPivot {
  // every row is read, so labels (and genes) first appear in sample (gene) id order
  const { of, labels } = labelGroups(ix, sampleLabel)
  const sampleMeta = new Map<string, SampleMeta>()
  ix.reps.forEach((r, s) => {
    const label = labels[of[s]]
    if (!sampleMeta.has(label))
      sampleMeta.set(label, {
        cell: r.cell,
        cmpd: r.cmpd,
        dose: r.dose,
        time: r.time,
        rep: r.rep,
        ...(r.extra ? { extra: { ...r.extra } } : null)
      })
  })
  const S = labels.length
  const grid = new Float64Array(ix.genes.length * S).fill(NaN) // NaN = null
  for (let r = 0; r < ix.n; r++) {
    const v = ix.value[r]
    grid[ix.gene[r] * S + of[ix.sample[r]]] = Number.isNaN(v) ? NaN : (heatCell(v, log10) ?? NaN)
  }
  const col = new Map(labels.map((l, i) => [l, i]))
  return {
    sampleOrder: [...labels],
    sampleMeta,
    geneOrder: [...ix.genes],
    cell: (g, s) => {
      const v = grid[ix.geneOf.get(g)! * S + col.get(s)!]
      return Number.isNaN(v) ? null : v
    }
  }
}
