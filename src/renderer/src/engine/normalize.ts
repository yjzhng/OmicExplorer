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
 * 'protein' takes one reference protein (a housekeeping protein): each sample is shifted so that
 * protein reads the same in every sample — the median of its values across samples. A sample that
 * didn't measure it is left as it is.
 *
 * Optionally the spread too, as Perseus's width adjustment (cox-labs.github.io/coxdocs/
 * widthadjustment.html): from each sample's quartiles, values above its median are scaled by
 * 1 / (q3 − q2) and values below by 1 / (q2 − q1). Perseus leaves the result unitless, centred on
 * 0; here each half is instead brought to the median of that half-width across samples, around the
 * median target — so the values stay abundances, on the scale every later step reads.
 */
import { sampleKey } from './impute'
import type { StandardRow } from './types'

export type NormalizeReference = 'shared' | 'all' | 'protein'

export interface NormalizeOptions {
  /** which genes each sample's median is taken over (absent = 'shared') */
  reference?: NormalizeReference
  /** also equalise each sample's spread (Perseus width adjustment); absent = medians only. Not
   *  with a reference protein: one value per sample has no spread. */
  spread?: boolean
  /** reference 'protein': the protein's uniqID */
  protein?: string
}

export const NORMALIZE_REFERENCE_LABEL: Record<NormalizeReference, string> = {
  shared: 'Common genes',
  all: 'All genes',
  protein: 'Reference protein'
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
  /** reference 'protein': the protein, and how many samples didn't measure it (left as they are) */
  protein?: string
  missingSamples?: number
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
  const protein = reference === 'protein' ? opts.protein : undefined
  const spread = !!opts.spread && reference !== 'protein'
  const measured = (r: StandardRow): boolean =>
    r.value != null && Number.isFinite(r.value) && r.value > 0

  // Samples, and the samples each gene was measured in.
  const samples = new Set<string>()
  const seenIn = new Map<string, Set<string>>()
  for (const r of rows) {
    const sk = sampleKey(r)
    samples.add(sk)
    if (!measured(r)) continue
    let s = seenIn.get(r.uniqID)
    if (!s) seenIn.set(r.uniqID, (s = new Set()))
    s.add(sk)
  }
  const shared = new Set<string>()
  for (const [g, s] of seenIn) if (s.size === samples.size) shared.add(g)
  const used: NormalizeReference =
    reference === 'protein'
      ? 'protein'
      : reference === 'shared' && shared.size >= MIN_SHARED_GENES
        ? 'shared'
        : 'all'
  const inReference = (r: StandardRow): boolean =>
    used === 'protein' ? r.uniqID === protein : used !== 'shared' || shared.has(r.uniqID)

  // Each sample's median log₂ over the reference genes (with a reference protein: its value).
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
  const base = {
    reference,
    used,
    sharedGenes: shared.size,
    samples: quart.size,
    ...(used === 'protein'
      ? { protein: protein ?? '', missingSamples: samples.size - quart.size }
      : null)
  }
  if (quart.size === 0) return { rows, summary: { ...base, maxFold: 1 } }

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
