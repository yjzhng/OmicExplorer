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
  /** keep a divergent call only where a side is itself significant. Off for abundance inputs
   *  (Standardize-fed split) which carry no per-side significance. Defaults to true. */
  driverMask?: boolean
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
  /** standard error of each side's value (log2 scale): fold-change SE (Compare/two-way) or the mean
   *  abundance SE, SD/√n (Standardize). Drives the DR/TR error bands; null when < 2 reps. */
  FC1err?: number | null
  FC2err?: number | null
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
  /** What the FC1/FC2 side values represent: 'fc' = log2 fold-change (Compare-fed contrasts),
   *  'abundance' = log2 abundance (Standardize-fed pair). Drives axis labelling; defaults to 'fc'. */
  valueKind?: 'abundance' | 'fc'
}

/** One per-gene value on one side of a PAIRED contrast: a scalar keyed by uniqID + condition
 *  context. From a Compare it is the log2FC (with its significance); from a Standardize it is a
 *  per-sample log2 abundance (runContrastPair averages replicates + unmatched dims to the matched
 *  context). */
export interface ContrastSideRow {
  uniqID: string
  strain?: string | null
  cmpd?: string | null
  dose?: number | null
  time?: number | null
  value: number | null
  signf?: boolean
  effect?: string
  pP?: number | null
  pQ?: number | null
  /** uncertainty of `value` (log2 scale): fold-change SE (Compare) — for Standardize it's left
   *  null here and computed as the abundance SD across replicates in aggregateSide. */
  se?: number | null
}

/** A paired contrast: two independent value series (two datasets), joined side-by-side by
 *  uniqID + the matched context, then scored for divergence by the same band/outlier model as the
 *  single-input condition-split contrast. */
export interface ContrastPairInput {
  sideA: ContrastSideRow[]
  sideB: ContrastSideRow[]
  /** context dims to align the two sides on (joined with uniqID); unmatched dims are averaged. */
  match: ConditionKey[]
  relationship?: 'correlated' | 'independent'
  /** axis labels for the two sides (the two input tiles' names). */
  labelA?: string
  labelB?: string
  /** keep a divergent call only where a side is itself significant. Off when the sides carry no
   *  per-side significance (abundance / Standardize inputs). */
  driverMask?: boolean
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
      FC1err: a.fcSE ?? null,
      FC2err: b.fcSE ?? null,
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

  addGaussianOutliers(records, ctxConds, method, input.driverMask ?? true)
  return { rows: records, comparisons: records.length ? [comparison] : [] }
}

/** Read a condition value off a side row (numbers for dose/time), '' / null when absent. */
const csval = (r: ContrastSideRow, c: ConditionKey): string | number | null =>
  (r as unknown as Record<string, string | number | null>)[c] ?? null

/** Collapse a side to one row per (uniqID + matched context): mean of its values (pooling
 *  replicates and any unmatched dims), OR-ed significance, best (largest −log10) p per group. */
function aggregateSide(
  rows: ContrastSideRow[],
  ctx: ConditionKey[]
): Map<string, ContrastSideRow> {
  const groups = new Map<string, ContrastSideRow[]>()
  for (const r of rows) {
    const k = [r.uniqID, ...ctx.map((c) => String(csval(r, c)))].join('¦')
    let arr = groups.get(k)
    if (!arr) groups.set(k, (arr = []))
    arr.push(r)
  }
  const best = (grp: ContrastSideRow[], key: 'pP' | 'pQ'): number | null =>
    grp.reduce<number | null>((m, r) => {
      const v = r[key]
      return v != null && (m == null || v > m) ? v : m
    }, null)
  const out = new Map<string, ContrastSideRow>()
  for (const [k, grp] of groups) {
    const vals = grp.map((r) => r.value).filter((v): v is number => v != null && Number.isFinite(v))
    const rep = grp[0]
    const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
    // Standard error of the aggregated value: if the rows carry a per-row SE (Compare
    // fold-changes), the mean's SE is √(Σ seᵢ²)/n; otherwise (Standardize abundances) it's the
    // replicate SD / √n. null when there's nothing to estimate from.
    const ses = grp.map((r) => r.se).filter((v): v is number => v != null && Number.isFinite(v))
    let se: number | null = null
    if (ses.length) {
      se = Math.sqrt(ses.reduce((s, v) => s + v * v, 0)) / ses.length
    } else if (vals.length >= 2 && mean != null) {
      const varr = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1)
      se = Math.sqrt(varr) / Math.sqrt(vals.length)
    }
    out.set(k, {
      uniqID: rep.uniqID,
      strain: rep.strain,
      cmpd: rep.cmpd,
      dose: rep.dose,
      time: rep.time,
      value: mean,
      se,
      signf: grp.some((r) => r.signf),
      pP: best(grp, 'pP'),
      pQ: best(grp, 'pQ')
    })
  }
  return out
}

/**
 * Paired contrast: join two value series (two datasets) on uniqID + the shared matched context, and
 * score divergence with the same band/outlier model as the single-input path. FC1 = side A's value,
 * FC2 = side B's. Values are fold-changes (Compare inputs) or mean log2 abundances (Standardize
 * inputs) — the caller decides which.
 *
 * The join is a FULL OUTER join: every (gene × matched context) present on EITHER side becomes a
 * row, with the absent side's FC left null. So a point measured at only one side's dose/time (e.g.
 * one dataset has fewer doses) is still carried — the table and the DR/TR response plots show it,
 * while the divergence model, scatter, and dumbbell (which all require both FCs) naturally skip it,
 * staying matched-only.
 */
export function runContrastPair(input: ContrastPairInput): ContrastResult {
  const method = input.relationship === 'independent' ? 'marginal' : 'ols'
  const labelA = input.labelA || 'A'
  const labelB = input.labelB || 'B'
  const comparison = `${labelA} | ${labelB}`
  const present = (rows: ContrastSideRow[], c: ConditionKey): boolean =>
    rows.some((r) => csval(r, c) !== null && csval(r, c) !== '')
  // Align only on the requested dims that both sides actually carry.
  const ctxConds = input.match.filter((c) => present(input.sideA, c) && present(input.sideB, c))

  const A = aggregateSide(input.sideA, ctxConds)
  const B = aggregateSide(input.sideB, ctxConds)

  const records: ContrastResultRow[] = []
  for (const key of new Set([...A.keys(), ...B.keys()])) {
    const a = A.get(key)
    const b = B.get(key)
    const rep = (a ?? b)! // one side is always present for a key drawn from either map
    records.push({
      uniqID: rep.uniqID,
      strain: ctxConds.includes('strain') ? ((rep.strain ?? null) as string | null) : undefined,
      cmpd: ctxConds.includes('cmpd') ? ((rep.cmpd ?? undefined) as string | undefined) : undefined,
      dose: ctxConds.includes('dose') ? (rep.dose ?? null) : null,
      time: ctxConds.includes('time') ? (rep.time ?? null) : null,
      cmp_cond: 'dataset',
      cmp1: labelA,
      cmp2: labelB,
      comparison,
      FC1: a?.value ?? null,
      FC2: b?.value ?? null,
      FC1err: a?.se ?? null,
      FC2err: b?.se ?? null,
      FCdiff: sub(a?.value ?? null, b?.value ?? null),
      P1: a?.pP ?? null,
      P2: b?.pP ?? null,
      Pdiff: sub(a?.pP ?? null, b?.pP ?? null),
      Q1: a?.pQ ?? null,
      Q2: b?.pQ ?? null,
      Qdiff: sub(a?.pQ ?? null, b?.pQ ?? null),
      signf1: a?.signf ?? false,
      signf2: b?.signf ?? false,
      effect1: a?.effect ?? 'none',
      effect2: b?.effect ?? 'none',
      thrsh: '',
      signf: false,
      effect: 'none'
    })
  }

  addGaussianOutliers(records, ctxConds, method, input.driverMask ?? true)
  return { rows: records, comparisons: records.length ? [comparison] : [] }
}

/** Add thrsh/signf/effect via OLS or marginal outlier detection, then (when `driverMask`) keep a
 *  divergent call only where a side is itself significant. */
function addGaussianOutliers(
  rows: ContrastResultRow[],
  ctxCols: ConditionKey[],
  method: 'ols' | 'marginal',
  driverMask = true
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

  // mask: keep signf only if at least one side is itself norm-significant. Skipped when the sides
  // carry no per-side significance (abundance / Standardize pairs), where the band is the only call.
  if (driverMask) {
    for (const r of rows) {
      r.signf = r.signf && (r.signf1 || r.signf2)
      if (!r.signf) r.effect = 'none'
    }
  }
}

function mean(a: number[]): number {
  return a.reduce((s, v) => s + v, 0) / a.length
}
