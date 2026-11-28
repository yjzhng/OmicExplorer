/**
 * The gene bar: one gene's standardized value across every condition.
 * Plain data for the renderer to turn into Plotly traces (no Plotly dependency here).
 */
import { isSampleIndex, labelGroups, type SampleIndex } from '../data/sampleIndex'
import { studentTppf } from '../stats/stats'
import type { StandardRow } from '../types'
import { sampleCond, type SampleMeta, type SampleOrdering, sortSamples } from './heatmap'

// ── gene bar: one gene's standardized value across every condition ───────────────

export interface GeneBarValue {
  cond: string
  gene: string
  uniqID: string
  /** central value (arithmetic mean, or geometric mean when log): the bar height. null when
   *  this condition has no finite value (missing → NaN). */
  mean: number | null
  /** spread on the working scale (linear sd, or log10 sd when log) — informational */
  sd: number
  /** error-bar lengths above/below `mean` in the data's native units. Symmetric (= sd) for
   *  linear; asymmetric for log (a symmetric log spread maps to unequal linear whiskers). */
  errUp: number
  errDown: number
  n: number
  /** the replicate values themselves (finite ones), in the data's units — for the dots */
  values: number[]
}
export interface GeneBarData {
  bars: GeneBarValue[]
  /** condition x-axis order */
  conds: string[]
  /** each condition slot's own condition values (cell, cmpd, dose, time, custom) — what a
   *  colour-by-condition reads (see metaValue) */
  condMeta: Record<string, SampleMeta>
  /** genes present (for the legend / series order) */
  genes: { uniqID: string; label: string }[]
}

/** Focus genes' standardized values across every condition (mean ± sd over replicates),
 *  one grouped series per gene. */
export function buildGeneBar(
  /** read once in order, none kept (an array, or scanRows' scan) — or a Clean data result's
   *  sample index (sampleIndex), read as ids */
  rows: Iterable<StandardRow> | SampleIndex,
  uniqIDs: string[],
  displayMap?: Record<string, string>,
  /** log-scaled data → compute the central value and spread in log10 space (geometric mean ±
   *  geometric sd), matching the log value axis / colour map. */
  log = false,
  /** what the error bars show: standard deviation, standard error of the mean, or the 95%
   *  confidence interval of the mean (t-based) */
  error: 'sd' | 'sem' | 'ci95' = 'sd',
  /** the conditions' order along the axis (default natural) */
  order: SampleOrdering = { by: 'natural' }
): GeneBarData {
  const { condOrder, condMeta, present, valuesAt } = isSampleIndex(rows)
    ? geneBarPivotIx(rows, uniqIDs)
    : geneBarPivot(rows, uniqIDs)
  sortSamples(condOrder, order, (c) => condMeta[c], false)
  const genes = uniqIDs
    .filter((id) => present.has(id))
    .map((id) => ({ uniqID: id, label: displayMap?.[id] ?? id }))
  const bars: GeneBarValue[] = []
  for (const { uniqID, label } of genes) {
    for (const cond of condOrder) {
      const vals = valuesAt(uniqID, cond)
      // No finite replicate here → a missing bar (mean null): the view leaves the position
      // empty and labels it NaN.
      if (!vals || vals.length === 0) {
        bars.push({
          cond,
          gene: label,
          uniqID,
          mean: null,
          sd: 0,
          errUp: 0,
          errDown: 0,
          n: 0,
          values: []
        })
        continue
      }
      // Log data: geometric mean ± geometric sd — compute in log10 space, then map back, so the
      // whiskers are symmetric on the log axis and the lower one never crosses zero. Linear data:
      // arithmetic mean ± sample sd (symmetric).
      const stat = log ? vals.map((v) => Math.log10(v)) : vals
      const m = stat.reduce((s, v) => s + v, 0) / stat.length
      const variance =
        stat.length > 1 ? stat.reduce((s, v) => s + (v - m) * (v - m), 0) / (stat.length - 1) : 0
      const sd = Math.sqrt(variance)
      if (log) {
        const center = Math.pow(10, m)
        bars.push({
          cond,
          gene: label,
          uniqID,
          mean: center,
          sd,
          errUp: Math.pow(10, m + sd) - center,
          errDown: center - Math.pow(10, m - sd),
          n: vals.length,
          values: vals
        })
      } else {
        const n = vals.length
        const sem = n > 0 ? sd / Math.sqrt(n) : 0
        const e =
          error === 'sem'
            ? sem
            : error === 'ci95'
              ? n > 1
                ? // two-sided: P(|T| > t) = 0.05
                  studentTppf(0.05, n - 1) * sem
                : 0
              : sd
        bars.push({
          cond,
          gene: label,
          uniqID,
          mean: m,
          sd,
          errUp: e,
          errDown: e,
          n,
          values: vals
        })
      }
    }
  }
  return { bars, conds: condOrder, condMeta, genes }
}

/** What a gene bar's pivot hands the layout: the conditions in first-appearance order with their
 *  condition values, the wanted genes present in the data, and a gene's values in a condition. */
interface GeneBarPivot {
  condOrder: string[]
  condMeta: Record<string, SampleMeta>
  present: Set<string>
  valuesAt: (uniqID: string, cond: string) => number[] | undefined
}

/** The gene bar's pivot off the rows. */
function geneBarPivot(rows: Iterable<StandardRow>, uniqIDs: string[]): GeneBarPivot {
  const want = new Set(uniqIDs)
  const byKey = new Map<string, number[]>() // `${uniqID}\u0000${cond}` → values
  const condOrder: string[] = []
  const condSeen = new Set<string>()
  const condMeta: Record<string, SampleMeta> = {}
  const present = new Set<string>()
  for (const r of rows) {
    const cond = sampleCond(r)
    // The axis shows every condition in the data, so a gene missing a value in some condition
    // still keeps that slot on the axis (drawn as an empty NaN position).
    if (!condSeen.has(cond)) {
      condSeen.add(cond)
      condOrder.push(cond)
      condMeta[cond] = {
        cell: r.cell,
        cmpd: r.cmpd,
        dose: r.dose,
        time: r.time,
        rep: r.rep,
        ...(r.extra ? { extra: { ...r.extra } } : null)
      }
    }
    if (!want.has(r.uniqID)) continue
    present.add(r.uniqID) // gene is in the data (listed even if every value is missing)
    if (r.value == null || !Number.isFinite(r.value)) continue
    const k = `${r.uniqID}\u0000${cond}`
    let arr = byKey.get(k)
    if (!arr) {
      arr = []
      byKey.set(k, arr)
    }
    arr.push(r.value)
  }
  return { condOrder, condMeta, present, valuesAt: (g, c) => byKey.get(`${g}\u0000${c}`) }
}

/** The gene bar's pivot off a sample index: each condition label made once per sample, the
 *  wanted genes' values gathered by gene and condition id. */
function geneBarPivotIx(ix: SampleIndex, uniqIDs: string[]): GeneBarPivot {
  // every row is read for the axis, so conditions first appear in sample id order
  const { of, labels: condOrder } = labelGroups(ix, sampleCond)
  const condMeta: Record<string, SampleMeta> = {}
  const metaSeen = new Set<string>()
  ix.reps.forEach((r, s) => {
    const cond = condOrder[of[s]]
    if (metaSeen.has(cond)) return
    metaSeen.add(cond)
    condMeta[cond] = {
      cell: r.cell,
      cmpd: r.cmpd,
      dose: r.dose,
      time: r.time,
      rep: r.rep,
      ...(r.extra ? { extra: { ...r.extra } } : null)
    }
  })
  const C = condOrder.length
  // wanted gene id → its slot; values by slot × condition
  const slot = new Int32Array(ix.genes.length).fill(-1)
  const wanted: number[] = []
  for (const id of uniqIDs) {
    const g = ix.geneOf.get(id)
    if (g !== undefined && slot[g] < 0) slot[g] = wanted.push(g) - 1
  }
  const vals: Array<number[] | undefined> = new Array(wanted.length * C)
  const seen = new Uint8Array(wanted.length)
  for (let r = 0; r < ix.n; r++) {
    const w = slot[ix.gene[r]]
    if (w < 0) continue
    seen[w] = 1 // gene is in the data (listed even if every value is missing)
    const v = ix.value[r]
    if (Number.isNaN(v)) continue
    ;(vals[w * C + of[ix.sample[r]]] ??= []).push(v)
  }
  const present = new Set(wanted.filter((_, w) => seen[w]).map((g) => ix.genes[g]))
  const condAt = new Map(condOrder.map((c, i) => [c, i]))
  return {
    condOrder: [...condOrder],
    condMeta,
    present,
    valuesAt: (g, c) => {
      const w = slot[ix.geneOf.get(g) ?? -1]
      return w === undefined || w < 0 ? undefined : vals[w * C + condAt.get(c)!]
    }
  }
}
