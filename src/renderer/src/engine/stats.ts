/**
 * Statistical primitives for the analysis engine — pure functions, no I/O.
 *
 * Reproduces omicViz's Welch t-test (scripts/stats/ttest.py), Benjamini-Hochberg
 * FDR (via statsmodels multipletests fdr_bh), and linear/SAM thresholding
 * (scripts/stats/threshold.py). The p-value uses the regularized incomplete beta
 * function so it matches scipy's Student-t survival function to ~1e-12.
 */

// ── special functions ─────────────────────────────────────────────────────────

const LANCZOS_G = 7
const LANCZOS_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7
]

/** Natural log of the gamma function (Lanczos approximation). */
export function gammaln(x: number): number {
  if (x < 0.5) {
    // Reflection formula
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - gammaln(1 - x)
  }
  x -= 1
  let a = LANCZOS_C[0]
  const t = x + LANCZOS_G + 0.5
  for (let i = 1; i < LANCZOS_G + 2; i++) a += LANCZOS_C[i] / (x + i)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

/** Continued fraction for the incomplete beta function (Numerical Recipes betacf). */
function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300
  const EPS = 3e-12
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/** Regularized incomplete beta function I_x(a, b). */
export function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(
    gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x)
  )
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a
  return 1 - (bt * betacf(b, a, 1 - x)) / b
}

/**
 * Two-sided Student-t tail probability P(|T| > t) for `df` degrees of freedom.
 * Equals `2 * scipy.stats.t.sf(|t|, df)`.
 */
export function studentTTwoSided(t: number, df: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return NaN
  const x = df / (df + t * t)
  return betai(df / 2, 0.5, x)
}

/**
 * Inverse two-sided Student-t: returns t > 0 such that P(|T| > t) = p for `df`
 * degrees of freedom. Equals `scipy.stats.t.ppf(1 - p/2, df)`. Found by bisection
 * on the (monotone-decreasing) two-sided tail, so it inherits betai's precision.
 */
export function studentTppf(p: number, df: number): number {
  if (!(p > 0 && p < 1) || !Number.isFinite(df) || df <= 0) return NaN
  let lo = 0
  let hi = 1
  while (studentTTwoSided(hi, df) > p && hi < 1e8) hi *= 2
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (studentTTwoSided(mid, df) > p) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Complementary error function (Numerical Recipes erfcc; ~1.2e-7 fractional error). */
export function erfc(x: number): number {
  const z = Math.abs(x)
  const t = 1 / (1 + 0.5 * z)
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    )
  return x >= 0 ? ans : 2 - ans
}

/** Upper-tail probability of the standard normal, P(Z > z). */
export function normalSf(z: number): number {
  return 0.5 * erfc(z / Math.SQRT2)
}

/** Median of the finite values (NaN if none). */
export function median(vals: number[]): number {
  const a = vals.filter(Number.isFinite).sort((x, y) => x - y)
  const n = a.length
  if (n === 0) return NaN
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2
}

/** Normal-consistent median absolute deviation (matches scipy median_abs_deviation scale='normal'). */
export function madNormal(vals: number[]): number {
  const m = median(vals)
  const dev = vals.filter(Number.isFinite).map((v) => Math.abs(v - m))
  return median(dev) * 1.482602218505602 // 1 / norm.ppf(0.75)
}

/**
 * Eigen-decomposition of a symmetric matrix via the cyclic Jacobi method (Numerical Recipes
 * `jacobi`). Returns eigenvalues and eigenvectors as COLUMNS of `vectors` (vectors[i][k] is the
 * i-th component of eigenvector k). Used for the samples×samples Gram matrix in PCA.
 *
 * This uses the numerically-stable in-place rotation (updating only the entries a rotation touches,
 * with the tan/tau formulation) rather than a naive full matrix-multiply per rotation — the latter
 * accumulates error and fails to converge as n grows past a handful, silently returning wrong
 * eigenvalues (a dominant axis gets smeared across many components).
 */
export function jacobiEigenSymmetric(input: number[][]): { values: number[]; vectors: number[][] } {
  const n = input.length
  const a = input.map((row) => row.slice())
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  )
  const d = new Array<number>(n)
  const b = new Array<number>(n)
  const z = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    b[i] = d[i] = a[i][i]
    z[i] = 0
  }
  // In-place Givens rotation of the (i,j) and (k,l) entries (NR's ROTATE macro).
  const rot = (m: number[][], s: number, tau: number, i: number, j: number, k: number, l: number): void => {
    const g = m[i][j]
    const h = m[k][l]
    m[i][j] = g - s * (h + g * tau)
    m[k][l] = h + s * (g - h * tau)
  }
  for (let sweep = 0; sweep < 100; sweep++) {
    let sm = 0
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) sm += Math.abs(a[p][q])
    if (sm === 0) break // fully diagonal → converged
    const thresh = sweep < 4 ? (0.2 * sm) / (n * n) : 0
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const g = 100 * Math.abs(a[p][q])
        if (
          sweep > 4 &&
          Math.abs(d[p]) + g === Math.abs(d[p]) &&
          Math.abs(d[q]) + g === Math.abs(d[q])
        ) {
          a[p][q] = 0
        } else if (Math.abs(a[p][q]) > thresh) {
          let h = d[q] - d[p]
          let t: number
          if (Math.abs(h) + g === Math.abs(h)) {
            t = a[p][q] / h
          } else {
            const theta = (0.5 * h) / a[p][q]
            t = 1 / (Math.abs(theta) + Math.sqrt(1 + theta * theta))
            if (theta < 0) t = -t
          }
          const c = 1 / Math.sqrt(1 + t * t)
          const s = t * c
          const tau = s / (1 + c)
          h = t * a[p][q]
          z[p] -= h
          z[q] += h
          d[p] -= h
          d[q] += h
          a[p][q] = 0
          for (let j = 0; j < p; j++) rot(a, s, tau, j, p, j, q)
          for (let j = p + 1; j < q; j++) rot(a, s, tau, p, j, j, q)
          for (let j = q + 1; j < n; j++) rot(a, s, tau, p, j, q, j)
          for (let j = 0; j < n; j++) rot(v, s, tau, j, p, j, q)
        }
      }
    }
    for (let i = 0; i < n; i++) {
      b[i] += z[i]
      d[i] = b[i]
      z[i] = 0
    }
  }
  return { values: d, vectors: v }
}

// ── aggregation + Welch t-test ─────────────────────────────────────────────────

export interface GeneAgg {
  n: number
  mean: number
  /** sample variance (ddof=1); NaN when n < 2 */
  variance: number
}

/**
 * Per-gene count/mean/variance over finite values, mirroring pandas
 * groupby(uniqID)['value'].agg(count, mean, var(ddof=1)). Non-finite values are
 * dropped before aggregation.
 */
export function aggregatePerGene(rows: Array<{ uniqID: string; value: number }>): Map<string, GeneAgg> {
  const buckets = new Map<string, number[]>()
  for (const r of rows) {
    const v = r.value
    if (!Number.isFinite(v)) continue
    let arr = buckets.get(r.uniqID)
    if (!arr) {
      arr = []
      buckets.set(r.uniqID, arr)
    }
    arr.push(v)
  }
  const out = new Map<string, GeneAgg>()
  for (const [uniqID, arr] of buckets) {
    const n = arr.length
    const mean = arr.reduce((s, v) => s + v, 0) / n
    let variance = NaN
    if (n >= 2) {
      let ss = 0
      for (const v of arr) ss += (v - mean) * (v - mean)
      variance = ss / (n - 1)
    }
    out.set(uniqID, { n, mean, variance })
  }
  return out
}

export interface WelchResult {
  uniqID: string
  mean1: number
  mean2: number
  sd1: number
  sd2: number
  log2FC: number
  pVal: number
  /** Standard error of log2FC on the log2 scale — the fold-change's uncertainty. NaN when a side
   *  has < 2 replicates. */
  fcSE: number
}

/**
 * Vectorized Welch t-test per gene. Mirrors omicViz welch_ttest.
 *
 * When `transformed` is true the input values are assumed to already be in log2
 * space: the test runs on them, log2FC = mean(log2 num) − mean(log2 den), and
 * mean/sd are back-transformed to original space (2^mean; delta-method sd).
 * When false the input is raw: the test runs on raw values and
 * log2FC = log2(mean_num / mean_den).
 */
export function welchTTest(
  numRows: Array<{ uniqID: string; value: number }>,
  denRows: Array<{ uniqID: string; value: number }>,
  transformed: boolean
): WelchResult[] {
  const num = aggregatePerGene(numRows)
  const den = aggregatePerGene(denRows)
  const genes = new Set<string>([...num.keys(), ...den.keys()])
  const LN2 = Math.log(2)
  const out: WelchResult[] = []

  for (const uniqID of genes) {
    const a = num.get(uniqID)
    const b = den.get(uniqID)
    const n1 = a?.n ?? 0
    const n2 = b?.n ?? 0
    const m1 = a?.mean ?? NaN
    const m2 = b?.mean ?? NaN
    const v1 = a?.variance ?? NaN
    const v2 = b?.variance ?? NaN

    let mean1: number
    let mean2: number
    let sd1: number
    let sd2: number
    let log2FC: number

    if (transformed) {
      mean1 = Number.isFinite(m1) ? 2 ** m1 : NaN
      mean2 = Number.isFinite(m2) ? 2 ** m2 : NaN
      sd1 = Number.isFinite(v1) ? LN2 * mean1 * Math.sqrt(v1) : NaN
      sd2 = Number.isFinite(v2) ? LN2 * mean2 * Math.sqrt(v2) : NaN
      log2FC = m1 - m2
    } else {
      mean1 = m1
      mean2 = m2
      sd1 = Math.sqrt(v1)
      sd2 = Math.sqrt(v2)
      log2FC = mean1 > 0 && mean2 > 0 ? Math.log2(mean1 / mean2) : NaN
    }

    const canTest = n1 >= 2 && n2 >= 2 && Number.isFinite(v1) && Number.isFinite(v2)
    let pVal = NaN
    if (canTest) {
      const se1 = v1 / n1
      const se2 = v2 / n2
      const se = se1 + se2
      const tStat = (m1 - m2) / Math.sqrt(se)
      const dfW = (se * se) / ((se1 * se1) / (n1 - 1) + (se2 * se2) / (n2 - 1))
      if (Number.isFinite(tStat) && Number.isFinite(dfW) && dfW > 0) {
        pVal = studentTTwoSided(Math.abs(tStat), dfW)
      }
    }

    const hasNum = n1 >= 1
    const hasDen = n2 >= 1
    // SE of log2FC on the log2 scale. In log2 space it's √(v1/n1 + v2/n2); in raw space log2FC =
    // log2(m1/m2), so propagate via the delta method (÷ ln2 per mean).
    let fcSE = NaN
    if (n1 >= 2 && n2 >= 2 && Number.isFinite(v1) && Number.isFinite(v2)) {
      fcSE = transformed
        ? Math.sqrt(v1 / n1 + v2 / n2)
        : m1 > 0 && m2 > 0
          ? Math.sqrt(v1 / (n1 * m1 * m1) + v2 / (n2 * m2 * m2)) / LN2
          : NaN
    }
    out.push({
      uniqID,
      mean1: hasNum ? mean1 : NaN,
      mean2: hasDen ? mean2 : NaN,
      sd1: hasNum && n1 >= 2 ? sd1 : NaN,
      sd2: hasDen && n2 >= 2 ? sd2 : NaN,
      log2FC: hasNum && hasDen ? log2FC : NaN,
      pVal,
      fcSE
    })
  }
  return out
}

// ── multiple testing correction ────────────────────────────────────────────────

/**
 * Benjamini-Hochberg FDR. Returns q-values aligned to the input array; NaN
 * inputs pass through as NaN. Matches statsmodels multipletests(method='fdr_bh').
 * Groups with fewer than 2 valid p-values return the raw p-values unchanged
 * (mirrors omicViz _apply_fdr).
 */
export function benjaminiHochberg(pvals: number[]): number[] {
  const q = pvals.slice()
  const idx = pvals.map((p, i) => i).filter((i) => Number.isFinite(pvals[i]))
  const m = idx.length
  if (m < 2) return q // pass-through (raw p) — matches omicViz behaviour
  // Sort valid indices by p ascending
  const order = idx.slice().sort((i, j) => pvals[i] - pvals[j])
  // BH step-up with monotonicity enforced from largest rank down
  let prev = 1
  for (let rank = m; rank >= 1; rank--) {
    const i = order[rank - 1]
    const val = Math.min(prev, (pvals[i] * m) / rank)
    q[i] = val
    prev = val
  }
  return q
}

// ── thresholding ───────────────────────────────────────────────────────────────

export interface ThresholdConfig {
  type: 'linear' | 'non-linear'
  fcLow: number
  fcHigh: number
  statMin: number
  b: number
  s0: number
  /** which significance column drives calls: raw −log10 p ('pP') or FDR −log10 q ('pQ') */
  statType: 'pP' | 'pQ'
}

export const DEFAULT_THRESHOLD: ThresholdConfig = {
  type: 'linear',
  fcLow: -1.0,
  fcHigh: 1.0,
  statMin: 1.3,
  // SAM curve, stored as a hyperbola with a positive FC asymptote FC_lim = −s0 (see applyThreshold).
  // Defaults: P_lim (statMin) = 1.3, FC_lim = 0.5 (s0 = −0.5), b = 1.
  b: 1,
  s0: -0.5,
  statType: 'pQ'
}

/** Format a number the way Python's float repr does (integers get a trailing .0). */
function pyFloat(x: number): string {
  return Number.isInteger(x) ? x.toFixed(1) : String(x)
}

/** Human-readable threshold description — matches omicViz ThresholdConfig.label(). */
export function thresholdLabel(cfg: ThresholdConfig): string {
  const sc = cfg.statType
  if (cfg.type === 'linear') {
    return `linear, log2FC ∉ (${pyFloat(cfg.fcLow)}, ${pyFloat(cfg.fcHigh)}) and ${sc} > ${pyFloat(cfg.statMin)}`
  }
  // SAM hyperbola with a positive FC asymptote FC_lim = −s0 and P asymptote P_lim = statMin.
  return `non-linear (SAM), ${sc} > P_lim + b/(|FC| − FC_lim)  [P_lim=${pyFloat(cfg.statMin)}, FC_lim=${pyFloat(-cfg.s0)}, b=${pyFloat(cfg.b)}]`
}

export type Effect = 'up' | 'down' | 'none'

export interface ThresholdCall {
  signf: boolean
  effect: Effect
}

/** Apply linear or SAM-curve thresholding to one row. `stat` is pP or pQ per config. */
export function applyThreshold(log2FC: number, stat: number, cfg: ThresholdConfig): ThresholdCall {
  let signf = false
  if (Number.isFinite(log2FC) && Number.isFinite(stat)) {
    if (cfg.type === 'linear') {
      signf = (log2FC < cfg.fcLow || log2FC > cfg.fcHigh) && stat >= cfg.statMin
    } else {
      // SAM boundary as a hyperbola with a positive FC asymptote: stat = statMin + b/(|FC| − FC_lim),
      // stored with s0 = −FC_lim. Genes at/inside the FC floor (|FC| ≤ FC_lim ⇒ denom ≤ 0) are never
      // significant, however significant — the required stat there is infinite. (For the legacy
      // s0 ≥ 0 form the denominator is always positive, so this is unchanged.)
      const denom = Math.abs(log2FC) + cfg.s0
      signf = denom > 0 && stat >= cfg.statMin + cfg.b / denom
    }
  }
  const effect: Effect = signf && log2FC > 0 ? 'up' : signf && log2FC < 0 ? 'down' : 'none'
  return { signf, effect }
}
