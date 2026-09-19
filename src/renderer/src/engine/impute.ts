/**
 * Missing-value imputation on the standardized long table (after clean-up): Perseus's
 * downshifted-normal model, which treats a gap as "below detection" and draws it from a
 * distribution shifted below (and narrower than) the sample's own. Values are stored linear; the
 * draw works in log2 and back-transforms, matching how the data is analysed downstream.
 * Deterministic: draws use a seeded PRNG keyed by (gene, sample), so a re-run on the same data
 * reproduces the same table.
 */
import type { StandardRow } from './types'

export type ImputeMethod = 'perseus'

export interface ImputeOptions {
  method: ImputeMethod
  /** perseus: how many sample-SDs below the sample mean the imputed distribution is centred
   *  (Perseus default 1.8) */
  shift?: number
  /** perseus: imputed distribution's SD as a fraction of the sample SD (Perseus default 0.3) */
  width?: number
}

export const IMPUTE_DEFAULTS = { shift: 1.8, width: 0.3 } as const

export const IMPUTE_LABEL: Record<ImputeMethod, string> = {
  perseus: 'Perseus (downshifted normal)'
}

export interface ImputeSummary {
  method: ImputeMethod
  /** cells filled in */
  imputed: number
  /** gene × sample cells in the table after imputation */
  total: number
}

/** Small deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
/** One standard-normal draw (Box–Muller) from a unit-uniform source. */
function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-12)
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const sampleKey = (r: StandardRow): string =>
  [r.cell, r.cmpd, r.dose ?? '', r.time ?? '', r.rep ?? ''].join('¦')

/**
 * Fill every missing (gene × sample) cell. Cells present as rows with a null value are filled in
 * place; combinations with no row at all (a long-format table only lists observed values) are
 * added. Rows that were filled carry `imputed: true`.
 */
export function imputeMissing(
  rows: StandardRow[],
  opts: ImputeOptions
): { rows: StandardRow[]; summary: ImputeSummary } {
  const shift = opts.shift ?? IMPUTE_DEFAULTS.shift
  const width = opts.width ?? IMPUTE_DEFAULTS.width

  // Sample roster (metadata by key) and the observed grid.
  const samples = new Map<string, StandardRow>()
  const genes: string[] = []
  const seenGene = new Set<string>()
  // Observed cells, keyed by gene + sample. The sample key itself contains '¦' separators (some
  // fields may be empty), so join with a tab, and keep the parts rather than re-splitting.
  const cellKey = (g: string, sk: string): string => `${g}\t${sk}`
  const observed = new Map<string, { g: string; sk: string; v: number }>()
  for (const r of rows) {
    const sk = sampleKey(r)
    if (!samples.has(sk)) samples.set(sk, r)
    if (!seenGene.has(r.uniqID)) {
      seenGene.add(r.uniqID)
      genes.push(r.uniqID)
    }
    if (r.value != null && Number.isFinite(r.value))
      observed.set(cellKey(r.uniqID, sk), { g: r.uniqID, sk, v: r.value })
  }

  // Per-sample log2 mean/sd of the observed (positive) values.
  const sampleStats = new Map<string, { mean: number; sd: number }>()
  {
    const bySample = new Map<string, number[]>()
    for (const { sk, v } of observed.values()) {
      if (v > 0) (bySample.get(sk) ?? bySample.set(sk, []).get(sk)!).push(Math.log2(v))
    }
    for (const [sk, logs] of bySample) {
      const mean = logs.reduce((a, b) => a + b, 0) / logs.length
      const sd =
        logs.length > 1
          ? Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / (logs.length - 1))
          : 0
      sampleStats.set(sk, { mean, sd })
    }
  }

  const fill = (gene: string, sk: string): number | null => {
    const st = sampleStats.get(sk)
    if (!st) return null
    const rand = mulberry32(hash(cellKey(gene, sk)))
    return Math.pow(2, st.mean - shift * st.sd + width * st.sd * gauss(rand))
  }

  let imputed = 0
  const out: StandardRow[] = []
  const emitted = new Set<string>()
  for (const r of rows) {
    const sk = sampleKey(r)
    emitted.add(cellKey(r.uniqID, sk))
    if (r.value != null && Number.isFinite(r.value)) {
      out.push(r)
      continue
    }
    const v = fill(r.uniqID, sk)
    if (v == null) out.push(r)
    else {
      imputed++
      out.push({ ...r, value: v, imputed: true })
    }
  }
  // Combinations with no row at all.
  for (const g of genes) {
    for (const [sk, meta] of samples) {
      if (emitted.has(cellKey(g, sk))) continue
      const v = fill(g, sk)
      if (v == null) continue
      imputed++
      out.push({
        uniqID: g,
        cell: meta.cell,
        cmpd: meta.cmpd,
        dose: meta.dose,
        time: meta.time,
        rep: meta.rep,
        value: v,
        imputed: true
      })
    }
  }
  return {
    rows: out,
    summary: { method: opts.method, imputed, total: genes.length * samples.size }
  }
}
