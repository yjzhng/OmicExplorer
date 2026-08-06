/**
 * Contrast: join two primary comparison tables side-by-side (FC1/FC2/FCdiff) and
 * flag divergent genes with a Gaussian-outlier model. No new statistical test —
 * per-side significance (signf1/signf2) comes from the primary step.
 *
 * Reimplements omicViz scripts/stats/comparisons.py `_compare_from_norm`,
 * `_add_gaussian_outliers` (ols / marginal), and `_mask_by_driver_signf`
 * (see [[omicviz-conceptual-reuse]]). relationship: correlated → OLS prediction
 * band; independent → marginal robust per-axis Gaussian.
 */
import { benjaminiHochberg, madNormal, median, normalSf, studentTppf } from './stats'
import { VALID_CONDITIONS, type CompareResultRow, type ConditionKey } from './types'

export interface ContrastInput {
  /** pooled primary rows (from one or more veh_norm / direct runs), sliced by `condition` */
  rows: CompareResultRow[]
  /** the condition contrasted over — becomes the result's `cmp_cond` axis */
  condition: ConditionKey
  /** the two levels of `condition`: [numerator → FC1, denominator → FC2] */
  pair: [string, string]
  /** correlated → OLS band; independent → marginal per-axis Gaussian */
  relationship?: 'correlated' | 'independent'
}

export interface ContrastResultRow {
  uniqID: string
  strain?: string | null
  cmpd?: string | null
  dose: number | null
  time: number | null
  cmp_cond: string
  cmp1: string
  cmp2: string
  comparison: string
  FC1: number | null
  FC2: number | null
  FCdiff: number | null
  P1: number | null
  P2: number | null
  Pdiff: number | null
  Q1: number | null
  Q2: number | null
  Qdiff: number | null
  signf1: boolean
  signf2: boolean
  effect1: string
  effect2: string
  thrsh: string
  signf: boolean
  effect: string
}

export interface ContrastResult {
  rows: ContrastResultRow[]
  comparisons: string[]
}

const Q_THRESH = 0.01

const cval = (r: CompareResultRow, c: ConditionKey): string | number | null =>
  (r as unknown as Record<string, string | number | null>)[c] ?? null

const sub = (a: number | null, b: number | null): number | null =>
  a != null && b != null ? a - b : null

/** Distinct comparison label of a slice, or null if ambiguous/empty. Value rows carry no
 *  label at all, so blanks are ignored rather than collapsing to a "" label. */
function uniqueComparison(rows: CompareResultRow[]): string | null {
  const labels = new Set(rows.map((r) => r.comparison).filter((l) => l != null && l !== ''))
  return labels.size === 1 ? [...labels][0] : null
}

const numeratorOf = (label: string): string => label.split(' | ')[0].trim()

/** Numeric-aware level match (dose 10 vs "10"), mirroring omicViz `_match_series`. */
function matchLevel(v: string | number | null, want: string): boolean {
  if (v == null || v === '') return false
  const a = Number(v)
  const b = Number(want)
  if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) < 1e-9
  return String(v) === String(want)
}

export function runContrast(input: ContrastInput): ContrastResult {
  const { condition, pair } = input
  const method = input.relationship === 'independent' ? 'marginal' : 'ols'
  if (!input.rows.length) return { rows: [], comparisons: [] }
  const [numVal, denVal] = pair

  // Pool + dedupe on the full condition key first: overlapping primary runs would
  // otherwise fan out into cartesian-product rows on the join (omicViz drop_duplicates).
  const seen = new Set<string>()
  const pooled: CompareResultRow[] = []
  for (const r of input.rows) {
    const k = [r.uniqID, ...VALID_CONDITIONS.map((c) => String(cval(r, c)))].join('¦')
    if (seen.has(k)) continue
    seen.add(k)
    pooled.push(r)
  }

  const present = (rows: CompareResultRow[], c: ConditionKey): boolean =>
    rows.some((r) => cval(r, c) !== null && cval(r, c) !== '')

  // Slice the pooled primaries by the two levels of the contrasted condition.
  const sideA = pooled.filter((r) => matchLevel(cval(r, condition), numVal))
  const sideB = pooled.filter((r) => matchLevel(cval(r, condition), denVal))
  if (!sideA.length || !sideB.length) return { rows: [], comparisons: [] }

  // Context the result carries: every OTHER condition present in both slices — the
  // contrasted condition is the axis, exactly as omicViz drops `spec.condition`.
  const ctxConds = VALID_CONDITIONS.filter(
    (c) => c !== condition && present(sideA, c) && present(sideB, c)
  )
  // Join on the context the two sides actually share. A condition whose levels don't
  // overlap at all — a vehicle recorded only at dose 0 while the drug sits at 2.5/5/10 —
  // can never pair, so joining on it would match nothing. Drop it from the key (its value
  // is still carried through as context from side A), mirroring how veh_norm matches its
  // vehicle on the context *minus* dose.
  const joinConds = ctxConds.filter((c) => {
    const levels = new Set(sideA.map((r) => String(cval(r, c))))
    return sideB.some((r) => levels.has(String(cval(r, c))))
  })

  // Slice labels: for a cmpd contrast the primary `comparison` ("X | DMSO") is the
  // canonical label. For strain/dose/time both sides usually share a compound, so that
  // label would read "X | X" — use the condition value itself (mirrors omicViz).
  const cmp1 = condition === 'cmpd' ? (uniqueComparison(sideA) ?? String(numVal)) : String(numVal)
  const cmp2 = condition === 'cmpd' ? (uniqueComparison(sideB) ?? String(denVal)) : String(denVal)
  const comparison = `${numeratorOf(cmp1)} | ${numeratorOf(cmp2)}`
  const cmpCond: string = condition

  const keyStr = (r: CompareResultRow): string =>
    [r.uniqID, ...joinConds.map((c) => String(cval(r, c)))].join('¦')
  const bIdx = new Map<string, CompareResultRow>()
  for (const b of sideB) if (!bIdx.has(keyStr(b))) bIdx.set(keyStr(b), b)

  const records: ContrastResultRow[] = []
  for (const a of sideA) {
    const b = bIdx.get(keyStr(a))
    if (!b) continue
    records.push({
      uniqID: a.uniqID,
      strain: ctxConds.includes('strain') ? (cval(a, 'strain') as string) : undefined,
      cmpd: ctxConds.includes('cmpd') ? (cval(a, 'cmpd') as string) : undefined,
      dose: ctxConds.includes('dose') ? (cval(a, 'dose') as number | null) : null,
      time: ctxConds.includes('time') ? (cval(a, 'time') as number | null) : null,
      cmp_cond: cmpCond,
      cmp1,
      cmp2,
      comparison,
      FC1: a.log2FC,
      FC2: b.log2FC,
      FCdiff: sub(a.log2FC, b.log2FC),
      P1: a.pP,
      P2: b.pP,
      Pdiff: sub(a.pP, b.pP),
      Q1: a.pQ,
      Q2: b.pQ,
      Qdiff: sub(a.pQ, b.pQ),
      signf1: a.signf,
      signf2: b.signf,
      effect1: a.effect,
      effect2: b.effect,
      thrsh: '',
      signf: false,
      effect: 'none'
    })
  }

  addGaussianOutliers(records, ctxConds, method)
  return { rows: records, comparisons: records.length ? [comparison] : [] }
}

/** Add thrsh/signf/effect via OLS or marginal outlier detection, then mask by driver signf. */
function addGaussianOutliers(
  rows: ContrastResultRow[],
  ctxCols: ConditionKey[],
  method: 'ols' | 'marginal'
): void {
  const label =
    method === 'ols'
      ? 'ols prediction, 99%'
      : `marginal gaussian (robust), per-axis q < ${Q_THRESH}`
  for (const r of rows) r.thrsh = label

  // group by comparison + context columns
  const groups = new Map<string, ContrastResultRow[]>()
  for (const r of rows) {
    const k = [
      r.comparison,
      ...ctxCols.map((c) => String((r as unknown as Record<string, unknown>)[c]))
    ].join('¦')
    let arr = groups.get(k)
    if (!arr) {
      arr = []
      groups.set(k, arr)
    }
    arr.push(r)
  }

  for (const grp of groups.values()) {
    const valid = grp.filter((r) => r.FC1 != null && r.FC2 != null)
    const n = valid.length
    if (n < 3) continue
    const fc1 = valid.map((r) => r.FC1 as number)
    const fc2 = valid.map((r) => r.FC2 as number)

    if (method === 'ols') {
      // OLS: FC1 = β0 + β1·FC2 + ε  (x = FC2, y = FC1); 99% prediction band.
      const x = fc2
      const y = fc1
      const xMean = mean(x)
      const yMean = mean(y)
      const Sxx = x.reduce((s, xi) => s + (xi - xMean) ** 2, 0)
      if (Sxx === 0) continue
      const beta1 = x.reduce((s, xi, i) => s + (xi - xMean) * (y[i] - yMean), 0) / Sxx
      const beta0 = yMean - beta1 * xMean
      const resid = x.map((xi, i) => y[i] - (beta0 + beta1 * xi))
      const s = Math.sqrt(resid.reduce((acc, e) => acc + e * e, 0) / (n - 2))
      if (s === 0) continue
      const tCrit = studentTppf(0.01, n - 2) // t.ppf(0.995, n-2)
      valid.forEach((r, i) => {
        const predHw = tCrit * s * Math.sqrt(1 + 1 / n + (x[i] - xMean) ** 2 / Sxx)
        const signf = Math.abs(resid[i]) > predHw
        const d = (r.FC1 as number) - (r.FC2 as number)
        r.signf = signf
        r.effect = signf && d > 0 ? 'up' : signf && d < 0 ? 'down' : 'none'
      })
    } else {
      // marginal: robust per-axis 1-D normal tests (median + MAD), BH-corrected.
      const mu1 = median(fc1)
      const mu2 = median(fc2)
      const s1 = madNormal(fc1)
      const s2 = madNormal(fc2)
      if (s1 === 0 || s2 === 0) continue
      const p1 = fc1.map((v) => 2 * normalSf(Math.abs((v - mu1) / s1)))
      const p2 = fc2.map((v) => 2 * normalSf(Math.abs((v - mu2) / s2)))
      const q1 = benjaminiHochberg(p1)
      const q2 = benjaminiHochberg(p2)
      valid.forEach((r, i) => {
        const sig1 = q1[i] < Q_THRESH
        const sig2 = q2[i] < Q_THRESH
        const dir1 = fc1[i] >= 0 ? 'up' : 'down'
        const dir2 = fc2[i] >= 0 ? 'up' : 'down'
        r.signf = sig1 || sig2
        r.effect =
          sig1 && sig2
            ? `${dir1}, ${dir2}`
            : sig1 && !sig2
              ? `${dir1}, —`
              : !sig1 && sig2
                ? `—, ${dir2}`
                : 'none'
      })
    }
  }

  // mask: keep signf only if at least one side is itself norm-significant.
  for (const r of rows) {
    r.signf = r.signf && (r.signf1 || r.signf2)
    if (!r.signf) r.effect = 'none'
  }
}

function mean(a: number[]): number {
  return a.reduce((s, v) => s + v, 0) / a.length
}
