/**
 * Sample normalisation on the standardized long table (after clean-up, before imputation): median
 * centring. Each sample is scaled so its median log intensity meets the median across samples —
 * removing loading differences between samples, and between batches (TMT plexes) with them, since
 * every sample is brought to the same target.
 *
 * The median is taken over a reference set of genes. 'shared' (the default) uses only genes
 * measured in every sample, as MaxQuant, DIA-NN and Spectronaut normalise on features shared
 * across runs: a sample that detected more low-abundance genes otherwise reads as lower loaded
 * when it isn't. 'all' uses whatever each sample measured. Too few shared genes falls back to all.
 * 'protein' takes reference proteins (a housekeeping protein, a set of them, spike-ins): every
 * value is divided by the reference's level in its own sample — one protein's value, or a set's
 * median (default) or mean of logs (the geometric mean, as qPCR's multiple reference genes) — so
 * the reference reads 1 in every sample and each abundance becomes a fraction of it. Division on
 * the linear values is subtraction on log ones — Perseus's "Subtract row cluster" on log data,
 * DIA-NN's multiplicative normalisation factors — so Clean data's log transform then shows the
 * reference at 0 and every value as its log-ratio to it. A sample missing references can't be put
 * on the same footing as the rest; by `missing`, Clean data stops and names those samples
 * (ingest.ts), drops them, or — some references measured — uses the ones it has.
 *
 * Optionally the spread too, as Perseus's width adjustment (cox-labs.github.io/coxdocs/
 * widthadjustment.html): from each sample's quartiles, values above its median are scaled by
 * 1 / (q3 − q2) and values below by 1 / (q2 − q1). Perseus leaves the result unitless, centred on
 * 0; here each half is instead brought to the median of that half-width across samples, around the
 * median target — so the values stay abundances, on the scale every later step reads.
 */
import { sampleKey } from './impute'
import { sampleName } from './sampleLabel'
import type { StandardRow } from '../types'

export type NormalizeReference = 'shared' | 'all' | 'protein'

export interface NormalizeOptions {
  /** which genes each sample's median is taken over (absent = 'shared') */
  reference?: NormalizeReference
  /** also equalise each sample's spread (Perseus width adjustment); absent = medians only. Not
   *  with a reference protein: one value per sample has no spread. */
  spread?: boolean
  /** reference 'protein': the proteins' uniqIDs — one, or a set combined per sample */
  proteins?: string[]
  /** (older) one reference protein — `proteins` of one */
  protein?: string
  /** a set's level in a sample: the median of its logs (default), or their mean (geometric mean) */
  combine?: RefCombine
  /** a sample missing references: 'stop' (default; Clean data stops and names them), 'drop' it, or
   *  'available' — use the references it measured (one with none is dropped) */
  missing?: RefMissing
}

export type RefCombine = 'median' | 'mean'
export type RefMissing = 'stop' | 'drop' | 'available'

export const NORMALIZE_REFERENCE_LABEL: Record<NormalizeReference, string> = {
  shared: 'Common genes',
  all: 'All genes',
  protein: 'Reference proteins'
}

/** Fewer genes measured in every sample than this and 'shared' falls back to 'all': a median over
 *  a handful of genes is noisier than the bias it avoids. */
export const MIN_SHARED_GENES = 50

export interface NormalizeSummary {
  /** the reference asked for */
  reference: NormalizeReference
  /** the reference used: 'all' when 'shared' fell back for want of shared genes */
  used: NormalizeReference
  /** genes measured in every sample */
  sharedGenes: number
  /** samples normalised */
  samples: number
  /** the largest median correction applied, as a fold (≥ 1, either direction) */
  maxFold: number
  /** with the spread equalised: the range of half-width scale factors applied (1 = unchanged) */
  spread?: { min: number; max: number }
  /** reference 'protein': the proteins; under 'stop', how many samples lack any of them (nothing
   *  is divided then) and the first few by name */
  proteins?: string[]
  /** (results from before sets) the one reference protein */
  protein?: string
  /** several reference proteins: how their level was taken */
  combine?: RefCombine
  missingSamples?: number
  missingLabels?: string[]
  /** samples left out for want of references ('drop', or 'available' with none measured) */
  droppedSamples?: number
  droppedLabels?: string[]
  /** 'available': samples divided by only the references they measured */
  partialSamples?: number
  /** reference 'protein', nothing divided because there's no protein to divide by: none picked
   *  ('unpicked'), or the one picked is in no sample ('absent' — dropped in clean-up, or not in
   *  this data). Clean data stops with why (the run), not passing un-normalised values on. */
  refused?: 'unpicked' | 'absent'
}

/** The p-quantile of sorted values, interpolated between order statistics. */
function quantile(sorted: number[], p: number): number {
  const h = (sorted.length - 1) * p
  const lo = Math.floor(h)
  return sorted[lo] + (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)] ?? 0) - sorted[lo])
}

function median(a: number[]): number {
  return quantile(
    [...a].sort((x, y) => x - y),
    0.5
  )
}

/** Median-centre every sample, and with `spread` equalise its quartile widths too (see the module
 *  note). Values are linear in and out; quartiles are taken on log₂. Missing and non-positive
 *  values are left as they are. */
export function normalizeSamples(
  rows: StandardRow[],
  opts: NormalizeOptions = {}
): { rows: StandardRow[]; summary: NormalizeSummary } {
  const reference = opts.reference ?? 'shared'
  const spread = !!opts.spread && reference !== 'protein'
  const measured = (r: StandardRow): boolean =>
    r.value != null && Number.isFinite(r.value) && r.value > 0

  // Samples, and the samples each gene was measured in.
  const samples = new Map<string, StandardRow>()
  const seenIn = new Map<string, Set<string>>()
  for (const r of rows) {
    const sk = sampleKey(r)
    if (!samples.has(sk)) samples.set(sk, r)
    if (!measured(r)) continue
    let s = seenIn.get(r.uniqID)
    if (!s) seenIn.set(r.uniqID, (s = new Set()))
    s.add(sk)
  }
  const shared = new Set<string>()
  for (const [g, s] of seenIn) if (s.size === samples.size) shared.add(g)
  if (reference === 'protein') return toReference(rows, opts, samples, shared.size, measured)
  const used: NormalizeReference =
    reference === 'shared' && shared.size >= MIN_SHARED_GENES ? 'shared' : 'all'
  const inReference = (r: StandardRow): boolean => used !== 'shared' || shared.has(r.uniqID)

  // Each sample's median log₂ over the reference genes.
  const logs = new Map<string, number[]>()
  for (const r of rows) {
    if (!measured(r) || !inReference(r)) continue
    const sk = sampleKey(r)
    ;(logs.get(sk) ?? logs.set(sk, []).get(sk)!).push(Math.log2(r.value!))
  }
  // Each sample's quartiles: q2 its median, q3 − q2 and q2 − q1 its upper and lower half-widths.
  const quart = new Map<string, { q2: number; up: number; lo: number }>()
  for (const [sk, l] of logs) {
    l.sort((x, y) => x - y)
    const q2 = quantile(l, 0.5)
    quart.set(sk, { q2, up: quantile(l, 0.75) - q2, lo: q2 - quantile(l, 0.25) })
  }
  const base = { reference, used, sharedGenes: shared.size, samples: quart.size }
  if (quart.size === 0) return { rows, summary: { ...base, samples: 0, maxFold: 1 } }

  // Every sample to the median of the sample medians, so the data keeps its overall level; with
  // `spread`, each half-width to the median of that half-width across samples. A sample whose
  // half-width is 0 (too few values to have one) keeps its spread.
  const qs = [...quart.values()]
  const target = median(qs.map((q) => q.q2))
  const upT = median(qs.map((q) => q.up))
  const loT = median(qs.map((q) => q.lo))
  const scale = new Map<string, { up: number; lo: number }>()
  let maxShift = 0
  let sMin = Infinity
  let sMax = -Infinity
  for (const [sk, q] of quart) {
    maxShift = Math.max(maxShift, Math.abs(target - q.q2))
    if (!spread) continue
    const s = { up: q.up > 0 ? upT / q.up : 1, lo: q.lo > 0 ? loT / q.lo : 1 }
    scale.set(sk, s)
    sMin = Math.min(sMin, s.up, s.lo)
    sMax = Math.max(sMax, s.up, s.lo)
  }
  const out = rows.map((r) => {
    if (!measured(r)) return r
    const sk = sampleKey(r)
    const q = quart.get(sk)
    if (!q) return r
    const d = Math.log2(r.value!) - q.q2
    const s = scale.get(sk)
    const y = target + (s ? d * (d > 0 ? s.up : s.lo) : d)
    return { ...r, value: Math.pow(2, y) }
  })
  return {
    rows: out,
    summary: {
      ...base,
      maxFold: Math.pow(2, maxShift),
      ...(spread ? { spread: { min: sMin, max: sMax } } : {})
    }
  }
}

/** Reference proteins (see the module note): each value over its sample's reference level — one
 *  protein's log (its median, should a sample hold it twice), or a set's median or mean of those.
 *  A sample missing references goes by `missing`: under 'stop' nothing is divided and the summary
 *  names the samples (Clean data stops, ingest.ts); 'drop' leaves them out; 'available' divides by
 *  the ones measured, leaving out only samples with none. */
function toReference(
  rows: StandardRow[],
  opts: NormalizeOptions,
  samples: Map<string, StandardRow>,
  sharedGenes: number,
  measured: (r: StandardRow) => boolean
): { rows: StandardRow[]; summary: NormalizeSummary } {
  const refs = [...new Set(opts.proteins ?? (opts.protein ? [opts.protein] : []))]
  const policy = opts.missing ?? 'stop'
  const base = {
    reference: 'protein' as const,
    used: 'protein' as const,
    sharedGenes,
    proteins: refs,
    ...(refs.length > 1 ? { combine: opts.combine ?? 'median' } : null)
  }
  if (!refs.length)
    return { rows, summary: { ...base, samples: 0, maxFold: 1, refused: 'unpicked' } }

  // each sample's logs of each reference
  const want = new Set(refs)
  const logs = new Map<string, Map<string, number[]>>()
  for (const r of rows) {
    if (!want.has(r.uniqID) || !measured(r)) continue
    const sk = sampleKey(r)
    let m = logs.get(sk)
    if (!m) logs.set(sk, (m = new Map()))
    ;(m.get(r.uniqID) ?? m.set(r.uniqID, []).get(r.uniqID)!).push(Math.log2(r.value!))
  }
  if (!logs.size) return { rows, summary: { ...base, samples: 0, maxFold: 1, refused: 'absent' } }

  // each sample's level, from the references it measured — all of them, or under 'available' any
  const level = new Map<string, number>()
  const lacking: string[] = []
  let partial = 0
  for (const sk of samples.keys()) {
    const m = logs.get(sk)
    const vals = refs.flatMap((g) => {
      const l = m?.get(g)
      return l ? [median(l)] : []
    })
    const whole = vals.length === refs.length
    if (!vals.length || (!whole && policy !== 'available')) {
      lacking.push(sk)
      continue
    }
    if (!whole) partial++
    level.set(
      sk,
      opts.combine === 'mean' ? vals.reduce((a, b) => a + b, 0) / vals.length : median(vals)
    )
  }
  const labels = (sks: string[]): string[] =>
    sks.slice(0, 5).map((sk) => sampleName(samples.get(sk)!))
  // stop — or nothing left to normalise: nothing divided, the samples named
  if (lacking.length && (policy === 'stop' || !level.size))
    return {
      rows,
      summary: {
        ...base,
        samples: 0,
        maxFold: 1,
        missingSamples: lacking.length,
        missingLabels: labels(lacking)
      }
    }
  let maxLog = 0
  for (const v of level.values()) maxLog = Math.max(maxLog, Math.abs(v))
  const out: StandardRow[] = []
  for (const r of rows) {
    const v = level.get(sampleKey(r))
    if (v == null) continue // a sample left out
    out.push(measured(r) ? { ...r, value: Math.pow(2, Math.log2(r.value!) - v) } : r)
  }
  return {
    rows: out,
    summary: {
      ...base,
      samples: level.size,
      maxFold: Math.pow(2, maxLog),
      ...(lacking.length
        ? { droppedSamples: lacking.length, droppedLabels: labels(lacking) }
        : null),
      ...(partial ? { partialSamples: partial } : null)
    }
  }
}
