/**
 * Batch effects: samples measured in separate batches (merged datasets, TMT plexes) can sit at
 * different levels for reasons that have nothing to do with the conditions.
 *
 * A batch is a label each sample carries beside its conditions — never a condition itself: as one,
 * it would split every comparison by batch and stop merged datasets pooling as replicates. The
 * user defines the batches in Clean data (sampleLabel → batch name), and two things follow:
 *
 *  - Correction (correctBatches, in Clean data, after normalisation): per gene, on log₂ values, the
 *    additive model value = condition cell + batch is fitted — every combination of the active
 *    conditions its own cell, so no condition effect can be taken for a batch one — and the batch
 *    part is removed (as limma's removeBatchEffect). Every plot and analysis downstream reads the
 *    corrected values.
 *  - Blocking (blockedTTest, in Compare): each comparison's t-test fits the batch as a term (the
 *    same additive model over its two groups), so the batch's degrees of freedom are charged and a
 *    corrected dataset isn't tested as if the correction were free.
 *
 * A batch shift can only be told from a condition effect where batches share conditions: the
 * conditions and batches have to form one connected design (batch A and B both measured a DMSO
 * control, say). Where they don't, the batch is confounded with the conditions and no method can
 * separate them — correction refuses rather than remove a real effect. A gene whose own missing
 * values leave it disconnected is left as it is.
 */
import { condValue } from './compare'
import { sampleLabel } from './sampleLabel'
import { studentTTwoSided, type WelchResult } from './stats'
import type { ConditionKey, StandardizeResult, StandardRow } from './types'
import { condLabel, customCond } from './types'

/** The batches a Clean data step defines: each sample (by sampleLabel) → its batch. */
export interface BatchSpec {
  /** sampleLabel → batch name; a sample in none is left as it is (and fits nothing) */
  of: Record<string, string>
  /** the condition the batches were filled from, if any: it's the batch now, not a condition (it
   *  would be confounded with itself) */
  condition?: ConditionKey
  /** Batches filled from a condition or the Merge inputs and not moved by hand: worked out again
   *  from the data each run (resolveBatches) — so they follow the data above when it changes,
   *  where `of`'s sample names would go stale. `names`: a value's batch name, where renamed. */
  live?: { from: ConditionKey | 'source'; names: Record<string, string> }
}

/** `spec` with its batches as the data now has them: a live spec's (filled from a condition or the
 *  Merge inputs — `sources`, sampleLabel → input) worked out from each sample's value; a spec
 *  moved by hand as it is. */
export function resolveBatches(
  spec: BatchSpec,
  rows: readonly StandardRow[],
  sources?: Record<string, string>
): BatchSpec {
  const live = spec.live
  if (!live) return spec
  const of: Record<string, string> = {}
  for (const r of rows) {
    const label = sampleLabel(r)
    if (label in of) continue
    const v =
      live.from === 'source' ? (sources?.[label] ?? '') : String(condValue(r, live.from) ?? '')
    if (v) of[label] = live.names[v] ?? v
  }
  return { ...spec, of }
}

export interface BatchSummary {
  /** batches with samples in the data */
  batches: number
  /** samples assigned to one */
  samples: number
  /** genes corrected */
  genes: number
  /** genes left as they were: their measured samples don't connect the batches */
  skipped: number
}

/** Union–find over 0…n−1: whether the batches (and cells) a set of samples spans are connected. */
function components(n: number, edges: Iterable<[number, number]>): Int32Array {
  const parent = new Int32Array(n).map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  for (const [a, b] of edges) parent[find(a)] = find(b)
  return parent.map((_, i) => find(i))
}

/** Whether every batch in a design (sample → [cell, batch]) is in one connected piece with the
 *  others — what lets their shifts be told from the cells'. */
function batchesConnected(
  samples: Array<[number, number]>,
  cells: number,
  batches: number
): boolean {
  const comp = components(
    cells + batches,
    samples.map(([c, b]): [number, number] => [c, cells + b])
  )
  const seen = new Set<number>()
  for (const [, b] of samples) seen.add(comp[cells + b])
  return seen.size <= 1
}

/**
 * The additive fit y = cell + batch by back-fitting (alternating means — least squares for this
 * model, converging geometrically on a connected design). Returns each batch's effect, centred on
 * 0 over the batches present (as limma's sum-to-zero coding: the data keeps its overall level).
 */
function fitBatchEffects(
  y: ArrayLike<number>,
  cell: ArrayLike<number>,
  batch: ArrayLike<number>,
  nCells: number,
  nBatches: number
): Float64Array {
  const n = y.length
  const b = new Float64Array(nBatches)
  const c = new Float64Array(nCells)
  const cn = new Float64Array(nCells)
  const bn = new Float64Array(nBatches)
  for (let i = 0; i < n; i++) {
    cn[cell[i]]++
    bn[batch[i]]++
  }
  for (let it = 0; it < 1000; it++) {
    c.fill(0)
    for (let i = 0; i < n; i++) c[cell[i]] += y[i] - b[batch[i]]
    for (let g = 0; g < nCells; g++) if (cn[g]) c[g] /= cn[g]
    const next = new Float64Array(nBatches)
    for (let i = 0; i < n; i++) next[batch[i]] += y[i] - c[cell[i]]
    let mean = 0
    let k = 0
    for (let j = 0; j < nBatches; j++)
      if (bn[j]) {
        next[j] /= bn[j]
        mean += next[j]
        k++
      }
    mean /= k || 1
    let delta = 0
    for (let j = 0; j < nBatches; j++) {
      if (bn[j]) next[j] -= mean
      delta = Math.max(delta, Math.abs(next[j] - b[j]))
    }
    b.set(next)
    if (delta < 1e-12) break
  }
  return b
}

/**
 * Remove the batch effects from Clean data's rows (linear in and out; fitted on log₂), protecting
 * every combination of `conds` (see the module note). Throws when the batches are confounded with
 * the conditions. Rows of samples in no batch, and missing / non-positive values, are left as
 * they are.
 */
export function correctBatches(
  rows: StandardRow[],
  spec: BatchSpec,
  conds: ConditionKey[]
): { rows: StandardRow[]; summary: BatchSummary } {
  const keep = conds.filter((c) => c !== spec.condition)
  // Each sample once: its cell (the tuple of the protected conditions) and batch — or null.
  const cellIds = new Map<string, number>()
  const batchIds = new Map<string, number>()
  const sampleAt = new Map<string, { cell: number; batch: number; label: string } | null>()
  const at = rows.map((r) => {
    const label = sampleLabel(r)
    let s = sampleAt.get(label)
    if (s === undefined) {
      const name = spec.of[label]
      if (name == null) s = null
      else {
        const ck = JSON.stringify(keep.map((c) => String(condValue(r, c) ?? '')))
        let cell = cellIds.get(ck)
        if (cell == null) cellIds.set(ck, (cell = cellIds.size))
        let batch = batchIds.get(name)
        if (batch == null) batchIds.set(name, (batch = batchIds.size))
        s = { cell, batch, label }
      }
      sampleAt.set(label, s)
    }
    return s
  })
  const assigned = [...sampleAt.values()].filter((s) => s != null)
  // A batch none of whose samples is in the data: its list names samples the data above no longer
  // has (its conditions or replicates changed since the batches were set) — said, not silently
  // left uncorrected.
  const gone = [...new Set(Object.values(spec.of))].filter((b) => !batchIds.has(b))
  if (gone.length)
    throw new Error(
      `${gone.length === 1 ? 'Batch' : 'Batches'} ${gone.map((b) => `“${b}”`).join(', ')}: none ` +
        'of the samples listed is in the data any more — the data above changed since the ' +
        'batches were set. Fill the batches again.'
    )
  const summary: BatchSummary = {
    batches: batchIds.size,
    samples: assigned.length,
    genes: 0,
    skipped: 0
  }
  if (batchIds.size < 2) return { rows, summary }

  // The design as a whole: batches that share no condition with the rest can't be corrected.
  if (
    !batchesConnected(
      assigned.map((s) => [s.cell, s.batch]),
      cellIds.size,
      batchIds.size
    )
  ) {
    const by = keep.length ? keep.map(condLabel).join(' × ') : 'the conditions'
    throw new Error(
      `The batches can't be told apart from ${by}: no condition was measured in more than one ` +
        'batch, so a batch shift and a condition effect look the same. Correct within batches ' +
        'that share a condition (a common control), or leave batch correction off.'
    )
  }

  // Per gene: its measured, assigned rows.
  const byGene = new Map<string, number[]>()
  rows.forEach((r, i) => {
    if (!at[i] || r.value == null || !Number.isFinite(r.value) || r.value <= 0) return
    let list = byGene.get(r.uniqID)
    if (!list) byGene.set(r.uniqID, (list = []))
    list.push(i)
  })
  const out = rows.slice()
  for (const idx of byGene.values()) {
    // local ids for this gene's cells and batches
    const cellLocal = new Map<number, number>()
    const batchLocal = new Map<number, number>()
    const n = idx.length
    const y = new Float64Array(n)
    const cell = new Int32Array(n)
    const batch = new Int32Array(n)
    idx.forEach((ri, k) => {
      const s = at[ri]!
      y[k] = Math.log2(rows[ri].value!)
      let c = cellLocal.get(s.cell)
      if (c == null) cellLocal.set(s.cell, (c = cellLocal.size))
      let b = batchLocal.get(s.batch)
      if (b == null) batchLocal.set(s.batch, (b = batchLocal.size))
      cell[k] = c
      batch[k] = b
    })
    if (batchLocal.size < 2) continue
    const pairs: Array<[number, number]> = []
    for (let k = 0; k < n; k++) pairs.push([cell[k], batch[k]])
    if (!batchesConnected(pairs, cellLocal.size, batchLocal.size)) {
      summary.skipped++
      continue
    }
    const eff = fitBatchEffects(y, cell, batch, cellLocal.size, batchLocal.size)
    idx.forEach((ri, k) => {
      out[ri] = { ...rows[ri], value: Math.pow(2, y[k] - eff[batch[k]]) }
    })
    summary.genes++
  }
  return { rows: out, summary }
}

/**
 * A blocked two-group t-test per gene: value = group + batch, fitted by least squares, the group
 * difference tested against the residual with the batch's degrees of freedom charged — rather
 * than Welch's, which can't take a block. `batch` of a value: its sample's batch ('' = none, its
 * own block). A gene whose values are all in one batch has nothing to block, and takes `fallback`
 * (the Welch result) as it is; one whose two groups share no batch can't be tested (p NaN).
 *
 * `transformed` (log₂ values): log2FC is the blocked difference, its SE the test's. On the values
 * as they are (a linear Clean data), log2FC is the ratio of the blocked group levels.
 */
export function blockedTTest(
  num: Array<{ uniqID: string; value: number; batch: string }>,
  den: Array<{ uniqID: string; value: number; batch: string }>,
  transformed: boolean,
  fallback: WelchResult[]
): WelchResult[] {
  const byGene = new Map<string, { y: number[]; g: number[]; b: string[] }>()
  const add = (rows: typeof num, g: number): void => {
    for (const r of rows) {
      if (!Number.isFinite(r.value)) continue
      let e = byGene.get(r.uniqID)
      if (!e) byGene.set(r.uniqID, (e = { y: [], g: [], b: [] }))
      e.y.push(r.value)
      e.g.push(g)
      e.b.push(r.batch)
    }
  }
  add(num, 1)
  add(den, 0)
  return fallback.map((w) => {
    const e = byGene.get(w.uniqID)
    if (!e) return w
    const names = [...new Set(e.b)]
    if (names.length < 2) return w
    const n = e.y.length
    const batch = Int32Array.from(e.b, (x) => names.indexOf(x))
    const cell = Int32Array.from(e.g)
    // Frisch–Waugh: the group coefficient's information is the group indicator's spread within
    // batches; none (each batch holds one group only) = the groups can't be told from the batches.
    const gm = new Float64Array(names.length)
    const gc = new Float64Array(names.length)
    for (let i = 0; i < n; i++) {
      gm[batch[i]] += cell[i]
      gc[batch[i]]++
    }
    let info = 0
    for (let i = 0; i < n; i++) info += (cell[i] - gm[batch[i]] / gc[batch[i]]) ** 2
    const df = n - 2 - (names.length - 1)
    if (!(info > 1e-12) || df < 1) return { ...w, pVal: NaN, fcSE: NaN }
    const eff = fitBatchEffects(e.y, cell, batch, 2, names.length)
    // the blocked group levels and the residual about them
    const lv = [0, 0]
    const ln = [0, 0]
    const adj = e.y.map((v, i) => v - eff[batch[i]])
    adj.forEach((v, i) => {
      lv[cell[i]] += v
      ln[cell[i]]++
    })
    const m1 = lv[1] / ln[1]
    const m0 = lv[0] / ln[0]
    let rss = 0
    adj.forEach((v, i) => (rss += (v - (cell[i] ? m1 : m0)) ** 2))
    const se = Math.sqrt(rss / df / info)
    const diff = m1 - m0
    const t = diff / se
    const pVal = Number.isFinite(t) ? studentTTwoSided(Math.abs(t), df) : NaN
    if (transformed) return { ...w, log2FC: diff, pVal, fcSE: se }
    return {
      ...w,
      log2FC: m1 > 0 && m0 > 0 ? Math.log2(m1 / m0) : NaN,
      pVal,
      // the ratio's SE by the delta method, as Welch's on raw values — the difference's variance
      // split evenly between the two levels (the blocked fit doesn't give each its own)
      fcSE:
        m1 > 0 && m0 > 0 ? (se * Math.sqrt((1 / (m1 * m1) + 1 / (m0 * m0)) / 2)) / Math.LN2 : NaN
    }
  })
}

/** The batch, as a condition a Contrast can pick sides by (and a Compare run per batch splits
 *  by) — a custom condition under a reserved name, so it can't meet one of the data's own. Only
 *  on rows made for those (withBatchCond): Clean data's own rows never carry it. */
export const BATCH_COND = customCond('(batch)')

/** Each sample's batch (sampleLabel → batch): the batches Clean data defined, else the Merge
 *  inputs the samples came from. Undefined when the data has neither. */
export function batchesOf(
  std: Pick<StandardizeResult, 'batches' | 'sources'>
): Record<string, string> | undefined {
  return std.batches ?? std.sources
}

/** Rows with each sample's batch (`of`, by sample label) as the BATCH_COND condition (a sample in
 *  no batch keeps its rows as they are). */
export function tagBatch<
  T extends Pick<StandardRow, 'cell' | 'cmpd' | 'dose' | 'time' | 'rep' | 'extra'>
>(rows: readonly T[], of: Record<string, string>): T[] {
  const slug = BATCH_COND.slice(1)
  return rows.map((r) => {
    const b = of[sampleLabel(r)]
    return b == null ? r : { ...r, extra: { ...r.extra, [slug]: b } }
  })
}

const withBatch = new WeakMap<StandardizeResult, StandardizeResult>()
/** `std` with each sample's batch as the BATCH_COND condition on its rows and samples (a sample in
 *  no batch carries none) — the same object when the data has no batches. Cached per result. */
export function withBatchCond(std: StandardizeResult): StandardizeResult {
  const of = batchesOf(std)
  if (!of) return std
  const hit = withBatch.get(std)
  if (hit) return hit
  const out: StandardizeResult = {
    ...std,
    rows: tagBatch(std.rows, of),
    ...(std.samples ? { samples: tagBatch(std.samples, of) } : null)
  }
  withBatch.set(std, out)
  return out
}
