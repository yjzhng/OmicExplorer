/**
 * Clean data QC: per-sample distributions, the gene × sample matrix view, and point thinning for dense residual plots.
 * Plain data for the renderer to turn into Plotly traces (no Plotly dependency here).
 */
import { condValue } from '../compare/compare'
import { labelGroups, sampleIndex } from '../data/sampleIndex'
import { fromLinear, quantityLabel, type ValueScale, valueUnitOf } from '../data/scale'
import { condLabel, type StandardizeResult, type StandardRow } from '../types'
import { type SampleMeta, type SampleOrdering, sortSamples } from './heatmap'

// ── point thinning ───────────────────────────────────────────────────────────────

/** The residual plot's point cap: its default, and the most its Max points box takes. One residual
 *  per gene per sample runs to 100k+, far past what the point plots' shared SVG path stays
 *  responsive with — so they're thinned (thinPoints: every extreme kept, the bulk evenly sampled)
 *  to about a volcano's count. The quartiles, medians, trend and axis fit still come from every
 *  residual. */
export const RESIDUAL_DOT_CAP = 10000

/** Thin `pts` to at most `cap` for drawing, keeping what a reader looks for: the most extreme
 *  (largest `mag`) — a fifth of the budget — then an evenly spaced sample of the rest, in their
 *  original order. Deterministic, so a redraw keeps the same points. Under the cap: all of them. */
export function thinPoints<T>(pts: T[], cap: number, mag: (t: T) => number): T[] {
  if (pts.length <= cap) return pts
  if (cap <= 0) return []
  const nTop = Math.min(pts.length, Math.ceil(cap / 5))
  const order = pts.map((_, i) => i).sort((a, b) => mag(pts[b]) - mag(pts[a]))
  const keep = new Set(order.slice(0, nTop))
  const rest = order.slice(nTop).sort((a, b) => a - b)
  const nRest = cap - keep.size
  for (let k = 0; k < nRest; k++) keep.add(rest[Math.floor((k * rest.length) / nRest)])
  return [...keep].sort((a, b) => a - b).map((i) => pts[i])
}

// ── standardize QC (per-sample distributions) ─────────────────────────────────────

export type QcMetric = 'intensity' | 'cv' | 'proteins'

export interface QcGroup {
  /** sample / condition-group label (x-axis category) */
  label: string
  /** the metric's values for this group (distribution for intensity/CV; a single count for
   *  proteins). `bar` renders their summary; violin/box render the distribution. */
  values: number[]
  /** proteins only: how many of the sample's proteins were filled in by imputation (not counted
   *  in `values`) — drawn stacked on top of the measured count */
  imputed?: number
  /** the group's condition values (for colouring by condition); a CV group's `rep` is moot */
  meta: SampleMeta
}

export interface QcData {
  groups: QcGroup[]
  /** y-axis title for the chosen metric */
  yLabel: string
  metric: QcMetric
  /** bar height uses a per-group summary: 'median' (intensity/CV) or 'count' (proteins). */
  summary: 'median' | 'count'
}

/**
 * Per-sample QC distributions for a standardized result, for the QC plot (violin/box/bar):
 *  - `intensity`: every protein's intensity in each sample (log10 when values look like raw
 *    intensity), so a box/violin per sample flags mis-normalised samples.
 *  - `proteins`: count of proteins identified (measured, not imputed) per sample (one value → a
 *    bar per sample).
 *  - `cv`: per-protein %CV across replicates within each condition group (replicates pooled),
 *    so each condition's reproducibility is a distribution.
 * A "sample" is the active-condition combo + replicate; a CV "group" drops the replicate.
 */
export function buildQc(
  std: StandardizeResult,
  metric: QcMetric,
  /** the scale abundance is shown on (see plotScaleOf); unset → the old guess (log₁₀ when the
   *  values look like raw intensity) */
  scale?: ValueScale,
  /** the samples' / groups' order along the axis (default natural) */
  order: SampleOrdering = { by: 'natural' },
  /** intensity shown as plain values on a log axis (scale.ts LogDisplay): the title says so */
  plain = false
): QcData {
  const conds = std.activeConditions
  const parts = (r: StandardRow): string[] =>
    conds.map((c) => String(condValue(r, c) ?? '')).filter((x) => x !== '')
  const sampleLabel = (r: StandardRow): string => {
    const p = parts(r)
    if (r.rep != null) p.push(`r${r.rep}`)
    return p.join(' · ') || 'sample'
  }
  const condLabel = (r: StandardRow): string => parts(r).join(' · ') || 'all'
  // every row's sample and gene as ids (shared, built once per table): the labels above are made
  // once per sample, and the row loops below read only typed arrays
  const ix = sampleIndex(std)
  // Each group's condition values, from its first row.
  const metas = new Map<string, SampleMeta>()
  const noteMeta = (label: string, r: StandardRow): void => {
    if (!metas.has(label))
      metas.set(label, {
        cell: r.cell,
        cmpd: r.cmpd,
        dose: r.dose,
        time: r.time,
        rep: r.rep,
        ...(r.extra ? { extra: { ...r.extra } } : null)
      })
  }
  const metaOf = (label: string): SampleMeta =>
    metas.get(label) ?? { cell: '', cmpd: '', dose: null, time: null, rep: null }
  // Per-sample groups (intensity, # proteins) tell replicates apart; CV groups pool them.
  const sortGroups = (groups: QcGroup[], perSample: boolean): QcGroup[] =>
    sortSamples(groups, order, (g) => g.meta, perSample)
  const push = <K>(m: Map<K, number[]>, k: K, v: number): void => {
    const a = m.get(k)
    if (a) a.push(v)
    else m.set(k, [v])
  }

  if (metric === 'proteins') {
    // Proteins MEASURED in each sample: an imputed cell isn't an identification (with imputation
    // on, every sample would otherwise count every protein and the bars all come out level).
    // The imputed ones are counted apart, so the bar can show them stacked on top.
    const { of, labels } = labelGroups(ix, sampleLabel)
    const slot = new Int32Array(labels.length).fill(-1)
    const count: Array<{ label: string; measured: number; imputed: number }> = []
    for (let r = 0; r < ix.n; r++)
      if (!Number.isNaN(ix.value[r])) {
        const k = of[ix.sample[r]]
        if (slot[k] < 0) {
          slot[k] = count.length
          count.push({ label: labels[k], measured: 0, imputed: 0 })
          noteMeta(labels[k], ix.reps[ix.sample[r]])
        }
        const c = count[slot[k]]
        if (ix.imputed[r]) c.imputed++
        else c.measured++
      }
    const groups = count.map(({ label, ...c }) => ({
      label,
      values: [c.measured],
      ...(c.imputed ? { imputed: c.imputed } : null),
      meta: metaOf(label)
    }))
    sortGroups(groups, true)
    return { groups, yLabel: '# proteins', metric, summary: 'count' }
  }

  if (metric === 'intensity') {
    const map = new Map<string, number[]>()
    let min = Infinity
    let max = -Infinity
    const { of, labels } = labelGroups(ix, sampleLabel)
    const vals: Array<number[] | undefined> = new Array(labels.length)
    for (let r = 0; r < ix.n; r++) {
      const v = ix.value[r]
      if (Number.isNaN(v)) continue
      const k = of[ix.sample[r]]
      let a = vals[k]
      if (!a) {
        map.set(labels[k], (a = vals[k] = []))
        noteMeta(labels[k], ix.reps[ix.sample[r]])
      }
      a.push(v)
      if (v < min) min = v
      if (v > max) max = v
    }
    // On the scale every abundance plot shows Clean data on — or, unset, log₁₀ when the values
    // look like raw intensity (all positive, ≥2 decades).
    const sc: ValueScale = scale ?? (min > 0 && max / min >= 100 ? 'log10' : 'linear')
    const groups = [...map].map(([label, vals]) => ({
      label,
      values: vals.flatMap((v) => {
        const x = fromLinear(v, sc)
        return x == null ? [] : [x]
      }),
      meta: metaOf(label)
    }))
    sortGroups(groups, true)
    return {
      groups,
      yLabel: quantityLabel(sc, valueUnitOf(std), plain),
      metric,
      summary: 'median'
    }
  }

  // cv: per condition group, the %CV of each protein across its replicates.
  const byGroup = new Map<string, Map<number, number[]>>() // condLabel → gene id → replicate values
  const { of, labels } = labelGroups(ix, condLabel)
  const gms: Array<Map<number, number[]> | undefined> = new Array(labels.length)
  for (let r = 0; r < ix.n; r++) {
    const v = ix.value[r]
    if (Number.isNaN(v)) continue
    const k = of[ix.sample[r]]
    let gm = gms[k]
    if (!gm) {
      byGroup.set(labels[k], (gm = gms[k] = new Map()))
      noteMeta(labels[k], ix.reps[ix.sample[r]])
    }
    push(gm, ix.gene[r], v)
  }
  const groups = [...byGroup].map(([label, geneMap]) => {
    const cvs: number[] = []
    for (const vals of geneMap.values()) {
      if (vals.length < 2) continue // CV needs ≥2 replicates
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      if (mean <= 0) continue
      const sd = Math.sqrt(
        vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (vals.length - 1)
      )
      cvs.push((100 * sd) / mean)
    }
    return { label, values: cvs, meta: metaOf(label) }
  })
  sortGroups(groups, false)
  return { groups, yLabel: 'CV %', metric, summary: 'median' }
}

/** One sample's QC, as the Clean data table's QC view lists it (sampleQc). */
export interface SampleQc {
  /** the sample's conditions and replicate */
  meta: SampleMeta
  /** proteins measured in it, filled in by imputation, and neither — of every protein the table
   *  holds */
  measured: number
  imputed: number
  missing: number
  /** missing, as a % of every protein */
  missingPct: number
  /** its measured abundances' median and quartiles, on `scale`; null with none measured */
  median: number | null
  q1: number | null
  q3: number | null
  /** the median %CV across replicates of its condition group's proteins (as the QC plot's CV) —
   *  shared by the group's samples; null with fewer than two replicates */
  groupCv: number | null
}

/** A sorted list's p-quantile, interpolated between its neighbours. */
function quantileOf(sorted: number[], p: number): number | null {
  if (!sorted.length) return null
  const at = (sorted.length - 1) * p
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo)
}

/**
 * Per-sample QC for a Clean data result, one entry per sample in sample order: how many proteins
 * it measured, how many were imputed or missing, its measured abundances' median and quartiles
 * (on `scale`, the plots' abundance scale), and its condition group's median CV — the numbers
 * behind the QC plot's bars and boxes, as a table.
 */
export function sampleQc(std: StandardizeResult, scale: ValueScale): SampleQc[] {
  const ix = sampleIndex(std)
  const total = ix.genes.length
  const conds = std.activeConditions
  const groupOf = (r: StandardRow): string =>
    conds.map((c) => String(condValue(r, c) ?? '')).join('\u0000')
  const { of: groupId, labels } = labelGroups(ix, groupOf)
  const ns = ix.reps.length
  const measured = new Int32Array(ns)
  const imputed = new Int32Array(ns)
  const vals: number[][] = Array.from({ length: ns }, () => [])
  // per condition group: gene → its replicates' values (linear), for the CV
  const byGroup: Array<Map<number, number[]>> = labels.map(() => new Map())
  for (let r = 0; r < ix.n; r++) {
    const v = ix.value[r]
    if (Number.isNaN(v)) continue
    const s = ix.sample[r]
    if (ix.imputed[r]) imputed[s]++
    else {
      measured[s]++
      const x = fromLinear(v, scale)
      if (x != null) vals[s].push(x)
    }
    const gm = byGroup[groupId[s]]
    const a = gm.get(ix.gene[r])
    if (a) a.push(v)
    else gm.set(ix.gene[r], [v])
  }
  const groupCv = byGroup.map((gm) => {
    const cvs: number[] = []
    for (const a of gm.values()) {
      if (a.length < 2) continue
      const mean = a.reduce((x, y) => x + y, 0) / a.length
      if (mean <= 0) continue
      const sd = Math.sqrt(a.reduce((x, y) => x + (y - mean) * (y - mean), 0) / (a.length - 1))
      cvs.push((100 * sd) / mean)
    }
    return quantileOf(
      cvs.sort((a, b) => a - b),
      0.5
    )
  })
  const out = ix.reps.map((rep, s): SampleQc => {
    const sorted = vals[s].sort((a, b) => a - b)
    const missing = total - measured[s] - imputed[s]
    return {
      meta: {
        cell: rep.cell,
        cmpd: rep.cmpd,
        dose: rep.dose,
        time: rep.time,
        rep: rep.rep,
        ...(rep.extra ? { extra: { ...rep.extra } } : null)
      },
      measured: measured[s],
      imputed: imputed[s],
      missing,
      missingPct: total ? (100 * missing) / total : 0,
      median: quantileOf(sorted, 0.5),
      q1: quantileOf(sorted, 0.25),
      q3: quantileOf(sorted, 0.75),
      groupCv: groupCv[groupId[s]]
    }
  })
  return sortSamples(out, { by: 'natural' }, (q) => q.meta, true)
}

// ── standardize matrix view (gene × sample table) ─────────────────────────────────

/** One sample column of the Clean data matrix: its key (`s0`, `s1`, …), header label and header
 *  lines (each condition the sample carries, then its replicate, by name). */
export interface StdMatrixSample {
  key: string
  label: string
  lines: Array<{ key: string; value: string }>
}

/** Pivot the tidy standardized rows into a gene × sample matrix: one row per uniqID (in first
 *  appearance), one column per sample (its condition combination + replicate), off the shared
 *  sample index — each sample's label and lines made once, the rows read as ids. */
export function buildStdMatrix(std: StandardizeResult): {
  samples: StdMatrixSample[]
  rows: Record<string, unknown>[]
} {
  const dm = std.displayMap
  const conds = std.activeConditions
  const combo = (r: StandardRow): string =>
    [...conds.map((c) => String(condValue(r, c) ?? '')), `r${r.rep ?? ''}`].join('\x01')
  const label = (r: StandardRow): string => {
    const parts = conds.map((c) => String(condValue(r, c) ?? '')).filter((x) => x !== '')
    if (r.rep != null) parts.push(`r${r.rep}`)
    return parts.join(' · ') || 'sample'
  }
  const lines = (r: StandardRow): StdMatrixSample['lines'] => {
    const out = conds
      .map((c) => ({ key: condLabel(c), value: String(condValue(r, c) ?? '') }))
      .filter((l) => l.value !== '')
    if (r.rep != null) out.push({ key: 'rep', value: String(r.rep) })
    return out
  }
  const ix = sampleIndex(std)
  // every row is read, so the columns (and genes) first appear in sample (gene) id order
  const { of } = labelGroups(ix, combo)
  const samples: StdMatrixSample[] = []
  const colKey: string[] = []
  ix.reps.forEach((r, s) => {
    if (of[s] < samples.length) return
    const key = `s${samples.length}`
    samples.push({ key, label: label(r), lines: lines(r) })
    colKey.push(key)
  })
  const rows = ix.genes.map((u): Record<string, unknown> => ({ uniqID: u, gene: dm[u] ?? '' }))
  for (let r = 0; r < ix.n; r++) {
    const v = ix.value[r]
    rows[ix.gene[r]][colKey[of[ix.sample[r]]]] = Number.isNaN(v) ? ix.rawValue(r) : v
  }
  return { samples, rows }
}
