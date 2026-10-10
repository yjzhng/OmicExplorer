/**
 * SAM with a permutation-based FDR (Tusher et al., PNAS 2001; as Perseus runs it): each gene's
 * difference over its pooled standard error plus a fudge factor s0,
 *
 *   d = (m₁ − m₂) / (s + s0),   s = √((1/n₁ + 1/n₂) · pooled variance)
 *
 * and the false discovery rate of a cutoff on |d| estimated from the data itself: the sample
 * labels are shuffled between the two sides, d recomputed for every gene, and the expected number
 * of false calls at a cutoff is the permutations' average count above it. A gene's q-value is the
 * lowest FDR of any cutoff that still calls it. No π₀ estimate (taken as 1, conservative).
 *
 * On a volcano, a cutoff on |d| is a hyperbola: s0 sets its fold-change wall, the FDR how high it
 * sits. The p-value reported alongside is the matching pooled (Student) t-test, so the hyperbola
 * and the volcano agree.
 */
import { studentTTwoSided } from './stats'

/** One value of one gene in one sample. */
export interface SamValue {
  uniqID: string
  /** the sample it was measured in (any key unique within the comparison) */
  sample: string
  value: number
}

export interface SamGene {
  /** the moderated difference d */
  d: number
  /** the pooled t-test's p-value (s0 = 0), and its degrees of freedom n₁ + n₂ − 2 */
  pVal: number
  df: number
  /** permutation q-value of |d| */
  q: number
}

export interface SamOptions {
  /** the fudge factor added to every gene's standard error (Perseus default 0.1) */
  s0: number
  /** how many label shuffles; every distinct one is used instead when there are fewer */
  permutations: number
  /** seed for the shuffles, so a re-run reproduces the same q-values */
  seed?: number
}

/** Small seeded PRNG (mulberry32) — reproducible shuffles (and decoys, see curveFit). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** n choose k (as a float; only compared against small limits). */
function choose(n: number, k: number): number {
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}

/** Every k-subset of 0…n−1, as boolean masks. */
function allSubsets(n: number, k: number): boolean[][] {
  const out: boolean[][] = []
  const pick: number[] = []
  const rec = (start: number): void => {
    if (pick.length === k) {
      const m = new Array<boolean>(n).fill(false)
      for (const i of pick) m[i] = true
      out.push(m)
      return
    }
    for (let i = start; i <= n - (k - pick.length); i++) {
      pick.push(i)
      rec(i + 1)
      pick.pop()
    }
  }
  rec(0)
  return out
}

/** The label assignments to test under the null: every distinct relabelling when there are no
 *  more than `want` (the observed one excluded), otherwise `want` random ones. */
function relabellings(n: number, k: number, want: number, seed: number): boolean[][] {
  const observed = (m: boolean[]): boolean => m.every((v, i) => v === i < k)
  if (choose(n, k) - 1 <= want) return allSubsets(n, k).filter((m) => !observed(m))
  const rand = rng(seed)
  const out: boolean[][] = []
  const idx = Array.from({ length: n }, (_, i) => i)
  while (out.length < want) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    const m = new Array<boolean>(n).fill(false)
    for (let i = 0; i < k; i++) m[idx[i]] = true
    if (!observed(m)) out.push(m)
  }
  return out
}

/**
 * SAM over one comparison: `num` against `den`, values already on the scale to test (log₂).
 * Genes need two values on each side; the rest are left out. A sample measured more than once for
 * a gene counts once, at its mean.
 */
export function samTest(num: SamValue[], den: SamValue[], opts: SamOptions): Map<string, SamGene> {
  // Columns: the numerator's samples, then the denominator's.
  const numSamples = [...new Set(num.map((v) => v.sample))]
  const denSamples = [...new Set(den.map((v) => v.sample))]
  const col = new Map<string, number>()
  numSamples.forEach((s, i) => col.set(`n\u0000${s}`, i))
  denSamples.forEach((s, i) => col.set(`d\u0000${s}`, numSamples.length + i))
  const nCols = numSamples.length + denSamples.length
  const k = numSamples.length

  // Gene × sample matrix (NaN = not measured), duplicates averaged.
  const genes: string[] = []
  const row = new Map<string, number>()
  const sums: Float64Array[] = []
  const counts: Uint16Array[] = []
  const put = (side: 'n' | 'd', v: SamValue): void => {
    if (!Number.isFinite(v.value)) return
    let r = row.get(v.uniqID)
    if (r === undefined) {
      r = genes.length
      row.set(v.uniqID, r)
      genes.push(v.uniqID)
      sums.push(new Float64Array(nCols))
      counts.push(new Uint16Array(nCols))
    }
    const c = col.get(`${side}\u0000${v.sample}`)!
    sums[r][c] += v.value
    counts[r][c]++
  }
  for (const v of num) put('n', v)
  for (const v of den) put('d', v)
  const X = sums.map((s, r) => s.map((x, c) => (counts[r][c] ? x / counts[r][c] : NaN)))

  // d (and the pooled t's pieces) for one gene under one labelling.
  const stat = (x: Float64Array, isNum: boolean[]): { d: number; t: number; df: number } | null => {
    let n1 = 0
    let n2 = 0
    let s1 = 0
    let s2 = 0
    for (let c = 0; c < nCols; c++) {
      const v = x[c]
      if (Number.isNaN(v)) continue
      if (isNum[c]) {
        n1++
        s1 += v
      } else {
        n2++
        s2 += v
      }
    }
    if (n1 < 2 || n2 < 2) return null
    const m1 = s1 / n1
    const m2 = s2 / n2
    let ss = 0
    for (let c = 0; c < nCols; c++) {
      const v = x[c]
      if (Number.isNaN(v)) continue
      const dv = v - (isNum[c] ? m1 : m2)
      ss += dv * dv
    }
    const df = n1 + n2 - 2
    const s = Math.sqrt((1 / n1 + 1 / n2) * (ss / df))
    const diff = m1 - m2
    return { d: diff / (s + opts.s0), t: s > 0 ? diff / s : NaN, df }
  }

  const observedLabels = Array.from({ length: nCols }, (_, c) => c < k)
  const obs: Array<{ g: number; d: number; t: number; df: number }> = []
  X.forEach((x, g) => {
    const r = stat(x, observedLabels)
    if (r && Number.isFinite(r.d)) obs.push({ g, ...r })
  })

  // Null: |d| of every gene under every relabelling, pooled and sorted.
  const perms = relabellings(nCols, k, opts.permutations, opts.seed ?? 1)
  const nullD: number[] = []
  for (const m of perms)
    for (const { g } of obs) {
      const r = stat(X[g], m)
      if (r && Number.isFinite(r.d)) nullD.push(Math.abs(r.d))
    }
  nullD.sort((a, b) => a - b)
  /** null values at or above c, per permutation */
  const nullAbove = (c: number): number => {
    let lo = 0
    let hi = nullD.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (nullD[mid] < c) lo = mid + 1
      else hi = mid
    }
    return perms.length ? (nullD.length - lo) / perms.length : 0
  }

  // FDR of the cutoff at each observed |d| (genes at or above it called), then q = the lowest FDR
  // of any cutoff that still calls the gene (any cutoff at or below its |d|).
  const order = [...obs].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)) // most extreme first
  const fdr = new Array<number>(order.length)
  for (let i = 0; i < order.length; i++) {
    const c = Math.abs(order[i].d)
    let called = i + 1
    while (called < order.length && Math.abs(order[called].d) === c) called++ // ties call together
    fdr[i] = perms.length ? Math.min(1, nullAbove(c) / called) : NaN
  }
  const out = new Map<string, SamGene>()
  let runMin = Infinity
  for (let i = order.length - 1; i >= 0; i--) {
    runMin = Math.min(runMin, fdr[i])
    const o = order[i]
    out.set(genes[o.g], {
      d: o.d,
      pVal: Number.isFinite(o.t) ? studentTTwoSided(Math.abs(o.t), o.df) : NaN,
      df: o.df,
      q: runMin
    })
  }
  return out
}

/** Where the SAM cutoff |d| = c sits on a volcano (−log₁₀ pooled-t p against log₂FC), for genes
 *  with `df` degrees of freedom: the p a gene at |log₂FC| needs. Infinity inside the wall
 *  |log₂FC| ≤ c·s0. */
export function samBoundary(absFC: number, c: number, s0: number, df: number): number {
  const s = absFC / c - s0 // the largest standard error still called
  if (!(s > 0) || !(df > 0)) return Infinity
  return -Math.log10(Math.max(studentTTwoSided(absFC / s, df), 1e-300))
}
