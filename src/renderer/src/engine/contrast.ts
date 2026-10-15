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
import { fromLog10, type ValueScale } from './scale'
import {
  condLabel,
  condsIn,
  customSlug,
  isCustomCond,
  type CompareResultRow,
  type ConditionKey,
  type CustomConditionKey
} from './types'

export interface ContrastInput {
  /** pooled primary rows (from one or more veh_norm / direct runs), sliced by `condition` */
  rows: CompareResultRow[]
  /** the condition contrasted over — becomes the result's `cmp_cond` axis */
  condition: ConditionKey
  /** the two levels of `condition`: [numerator → FC1, denominator → FC2] */
  pair: [string, string]
  /** correlated → OLS band; independent → marginal per-axis Gaussian */
  relationship?: 'correlated' | 'independent'
  /** the statistic's cutoffs (see ContrastStat) */
  stat?: ContrastStat
  /** keep a divergent call only where a side is itself significant. Off for abundance inputs
   *  (Standardize-fed split) which carry no per-side significance. Defaults to true. */
  driverMask?: boolean
}

/** The divergence statistic's confidence. Correlated: the OLS prediction band's level. Linear
 *  cutoff (independent): per-axis robust-z BH q ≤ 1 − confidence. One number, applied per model. */
/** Linear cutoff: the four tails — each axis (A = y, B = x) above and below its centre. */
export type AxisTail = 'aUp' | 'aDown' | 'bUp' | 'bDown'
export const AXIS_TAILS: AxisTail[] = ['aUp', 'aDown', 'bUp', 'bDown']

export interface ContrastStat {
  /** correlated only — what the band is centred on: 'linear' (default) a line fitted through the
   *  two sides (OLS; genes outside its prediction band diverge), 'identity' the line y = x itself
   *  ("the same response on both sides"; nothing fitted, the spread the residuals' RMS about it) */
  model?: 'linear' | 'identity'
  /** prediction band confidence, 0–1 (default 0.99); the UP tail (above the line) while
   *  `asymmetric` */
  bandConfidence?: number
  /** per-axis q cutoff (default 0.01 = 1 − 0.99); every tail unless overridden while
   *  `asymmetric` */
  cutoffQ?: number
  /** separate levels per tail. Correlated: the band below the line (`bandConfidenceDown`).
   *  Linear cutoff: each axis's up and down tails (`cutoffQTails`). Off (default): mirrored. */
  asymmetric?: boolean
  bandConfidenceDown?: number
  cutoffQTails?: Partial<Record<AxisTail, number>>
}
export const CONTRAST_STAT_DEFAULTS = { bandConfidence: 0.99, cutoffQ: 0.01 } as const

/** The cutoffs as the engine applies them (everything mirrors the primary unless asymmetric). */
export function statTails(stat: ContrastStat = {}): {
  confUp: number
  confDown: number
  q: Record<AxisTail, number>
} {
  const confUp = stat.bandConfidence ?? CONTRAST_STAT_DEFAULTS.bandConfidence
  const q0 = stat.cutoffQ ?? CONTRAST_STAT_DEFAULTS.cutoffQ
  const confDown = stat.asymmetric ? (stat.bandConfidenceDown ?? confUp) : confUp
  const q = {} as Record<AxisTail, number>
  for (const t of AXIS_TAILS) q[t] = stat.asymmetric ? (stat.cutoffQTails?.[t] ?? q0) : q0
  return { confUp, confDown, q }
}

/** What a Contrast compares on its two sides — picked on the results page's switcher row, which
 *  every plot of the Contrast follows. 'value' is the side's own value (a Compare's log₂FC — a
 *  curve fit's curve or peak fold change — or Clean data's abundance); the rest are further
 *  per-gene features of the same inputs: Clean data's replicate SD (log₁₀) and CV (%), a Compare's
 *  significance (−log₁₀ p or q, as it calls by), a curve fit's pEC50. */
export type ContrastFeatureId = 'value' | 'sd' | 'cv' | 'p' | 'pec50'

export interface ContrastResultRow {
  /** the feature this row contrasts and its name on the switcher and the value axes — absent
   *  when the inputs offer one feature only (then nothing is switched) */
  featureId?: ContrastFeatureId
  feature?: string
  uniqID: string
  cell?: string | null
  cmpd?: string | null
  dose: number | null
  time: number | null
  /** custom condition slug → value, carried as context like the preset columns */
  extra?: Record<string, string>
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
  /** each side's replicates on its value's scale — a Compare's per-replicate log2 ratio to the
   *  control mean, or a Standardize's per-sample log10 abundance. Drawn as the DR/TR points;
   *  absent when the side carried none (older results, a curve fit). Not a table column. */
  FC1reps?: number[] | null
  FC2reps?: number[] | null
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
  /** how the divergence calls were grouped (by comparison + these context conditions) and masked
   *  (by a side's own significance) — what reclassifyContrast needs to redo them under new
   *  cutoffs without a re-run. Absent on results from before it was kept. */
  classify?: { ctxConds: ConditionKey[]; driverMask: boolean }
  /** What the FC1/FC2 side values represent: 'fc' = log2 fold-change (Compare-fed contrasts),
   *  'abundance' = log10 abundance (Standardize-fed pair). Drives axis labelling; defaults to 'fc'. */
  valueKind?: 'abundance' | 'fc'
}

const onScale = new WeakMap<ContrastResultRow[], Map<ValueScale, ContrastResultRow[]>>()
/** An abundance contrast's rows (sides stored as log₁₀ abundance) with their side values, their
 *  errors and their difference put on `scale` — the scale the plots show Clean data on (see
 *  plotScaleOf). A log base is a plain rescale; linear takes the values back out of the log
 *  (geometric means), the errors by the delta method and the difference as linear A − B. The
 *  statistics are untouched. Cached per row array and scale. */
export function abundanceOnScale(
  rows: ContrastResultRow[],
  scale: ValueScale
): ContrastResultRow[] {
  if (scale === 'log10') return rows
  let byScale = onScale.get(rows)
  if (!byScale) onScale.set(rows, (byScale = new Map()))
  const hit = byScale.get(scale)
  if (hit) return hit
  const f = (v: number | null | undefined): number | null =>
    v == null || !Number.isFinite(v) ? null : fromLog10(v, scale)
  const out = rows.map((r): ContrastResultRow => {
    // only the abundance itself is rescaled — a spread (SD, CV) keeps its own units
    if (r.featureId && r.featureId !== 'value') return r
    if (scale === 'log2') {
      const k = 1 / Math.log10(2)
      const m = (v: number | null | undefined): number | null =>
        v == null || !Number.isFinite(v) ? (v ?? null) : v * k
      return {
        ...r,
        FC1: m(r.FC1),
        FC2: m(r.FC2),
        FC1err: m(r.FC1err),
        FC2err: m(r.FC2err),
        FC1reps: r.FC1reps?.map((v) => v * k),
        FC2reps: r.FC2reps?.map((v) => v * k),
        FCdiff: m(r.FCdiff)
      }
    }
    const a = f(r.FC1)
    const b = f(r.FC2)
    // d(10^v) = ln10 · 10^v · dv
    const err = (lin: number | null, e: number | null | undefined): number | null =>
      lin == null || e == null || !Number.isFinite(e) ? null : Math.LN10 * lin * e
    return {
      ...r,
      FC1: a,
      FC2: b,
      FC1err: err(a, r.FC1err),
      FC2err: err(b, r.FC2err),
      FC1reps: r.FC1reps?.map((v) => fromLog10(v, scale)),
      FC2reps: r.FC2reps?.map((v) => fromLog10(v, scale)),
      FCdiff: a != null && b != null ? a - b : null
    }
  })
  byScale.set(scale, out)
  return out
}

/** A contrast facet's value-axis title when it shows a feature other than the sides' own value
 *  (that one keeps its usual title — log₂FC, or abundance on the plots' scale); null otherwise. */
export function contrastFeatureLabel(rows: ContrastResultRow[]): string | null {
  const r = rows.find((x) => x.featureId)
  return r && r.featureId !== 'value' ? (r.feature ?? null) : null
}

const byFeature = new WeakMap<ContrastResultRow[], Map<string, ContrastResultRow[]>>()
/** A contrast's rows of the feature `like` shows (all of them when it offers one) — what a plot
 *  scales over, so a global range never mixes features. Cached per row array, so it's stable. */
export function rowsOfFeature(
  rows: ContrastResultRow[],
  like: ContrastResultRow | undefined
): ContrastResultRow[] {
  const f = like?.featureId
  if (!f) return rows
  let m = byFeature.get(rows)
  if (!m) byFeature.set(rows, (m = new Map()))
  let hit = m.get(f)
  if (!hit) m.set(f, (hit = rows.filter((r) => r.featureId === f)))
  return hit
}

/** A contrast's rows of the feature named `label` — the switcher's pick, else its first (the
 *  sides' own value) — for a view that isn't faceted (the tables); all of them when it offers one.
 *  Cached as rowsOfFeature. */
export function rowsOfFeatureNamed(
  rows: ContrastResultRow[],
  label: string | undefined
): ContrastResultRow[] {
  const like = (label != null && rows.find((r) => r.feature === label)) || rows[0]
  return rowsOfFeature(rows, like)
}

/** One per-gene value on one side of a PAIRED contrast: a scalar keyed by uniqID + condition
 *  context. From a Compare it is the log2FC (with its significance); from a Standardize it is a
 *  per-sample log10 abundance (runContrastPair averages replicates + unmatched dims to the matched
 *  context). */
export interface ContrastSideRow {
  uniqID: string
  cell?: string | null
  cmpd?: string | null
  dose?: number | null
  time?: number | null
  /** custom condition slug → value */
  extra?: Record<string, string>
  value: number | null
  signf?: boolean
  effect?: string
  pP?: number | null
  pQ?: number | null
  /** uncertainty of `value` (log2 scale): fold-change SE (Compare) — for Standardize it's left
   *  null here and computed as the abundance SD across replicates in aggregateSide. */
  se?: number | null
  /** the replicates behind `value`, on its scale (a sample row: just its own value) — pooled by
   *  aggregateSide into the result's FC1reps / FC2reps */
  reps?: number[]
}

/** A paired contrast: two independent value series (two datasets), joined side-by-side by
 *  uniqID + the matched context, then scored for divergence by the same band/outlier model as the
 *  single-input condition-split contrast. */
/** Per side, the values each condition is narrowed to. A list is the side's explicit pick — on a
 *  matched condition the values it pairs on, on an unmatched one its slice, which must come to one
 *  value: nothing is ever pooled across a condition (a side with a single value needs no pin).
 *  Replicates are the only thing averaged. A bare string is a saved pin from before lists, which
 *  only ever fixed an UNMATCHED condition. */
export type PairPins = Partial<Record<ConditionKey, string | string[]>>
export interface PairFix {
  a: PairPins
  b: PairPins
}

export interface ContrastPairInput {
  sideA: ContrastSideRow[]
  sideB: ContrastSideRow[]
  /** context dims to align the two sides on (joined with uniqID) */
  match: ConditionKey[]
  /** the slice each unmatched condition is fixed to, per side (see PairFix) */
  fix?: PairFix
  relationship?: 'correlated' | 'independent'
  /** the statistic's cutoffs (see ContrastStat) */
  stat?: ContrastStat
  /** axis labels for the two sides (the two input tiles' names). */
  labelA?: string
  labelB?: string
  /** keep a divergent call only where a side is itself significant. Off when the sides carry no
   *  per-side significance (abundance / Standardize inputs). */
  driverMask?: boolean
}

const cval = (r: CompareResultRow, c: ConditionKey): string | number | null =>
  isCustomCond(c)
    ? (r.extra?.[customSlug(c)] ?? '')
    : ((r as unknown as Record<string, string | number | null>)[c] ?? null)

/** Copy the custom condition values `ctx` names off a source row onto a result row. Only the
 *  context conditions are kept, matching how the preset columns are gated below. */
const ctxExtra = (
  r: { extra?: Record<string, string> },
  ctx: ConditionKey[]
): { extra?: Record<string, string> } => {
  const keys = ctx.filter(isCustomCond) as CustomConditionKey[]
  if (keys.length === 0) return {}
  const extra: Record<string, string> = {}
  for (const k of keys) extra[customSlug(k)] = r.extra?.[customSlug(k)] ?? ''
  return { extra }
}

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
  // Custom conditions belong in the dedupe key too — two rows differing only in one are distinct
  // measurements, and dropping one as a duplicate would silently discard a whole context.
  const allConds = condsIn(input.rows)
  for (const r of input.rows) {
    const k = [r.uniqID, ...allConds.map((c) => String(cval(r, c)))].join('¦')
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
  const ctxConds = condsIn(input.rows).filter(
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
  // canonical label. For cell/dose/time both sides usually share a compound, so that
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
      cell: ctxConds.includes('cell') ? (cval(a, 'cell') as string) : undefined,
      cmpd: ctxConds.includes('cmpd') ? (cval(a, 'cmpd') as string) : undefined,
      dose: ctxConds.includes('dose') ? (cval(a, 'dose') as number | null) : null,
      time: ctxConds.includes('time') ? (cval(a, 'time') as number | null) : null,
      ...ctxExtra(a, ctxConds),
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

  const driverMask = input.driverMask ?? true
  addGaussianOutliers(records, ctxConds, method, driverMask, input.stat)
  return {
    rows: records,
    comparisons: records.length ? [comparison] : [],
    classify: { ctxConds, driverMask }
  }
}

/** Read a condition value off a side row (numbers for dose/time), '' / null when absent. */
const csval = (r: ContrastSideRow, c: ConditionKey): string | number | null =>
  isCustomCond(c)
    ? (r.extra?.[customSlug(c)] ?? '')
    : ((r as unknown as Record<string, string | number | null>)[c] ?? null)

/** Collapse a side to one row per (uniqID + matched context): mean of its values (pooling
 *  replicates and any unmatched dims), OR-ed significance, best (largest −log10) p per group. */
function aggregateSide(rows: ContrastSideRow[], ctx: ConditionKey[]): Map<string, ContrastSideRow> {
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
    const reps = grp.flatMap((r) => r.reps ?? []).filter((v) => Number.isFinite(v))
    out.set(k, {
      uniqID: rep.uniqID,
      cell: rep.cell,
      cmpd: rep.cmpd,
      dose: rep.dose,
      time: rep.time,
      ...ctxExtra(rep, ctx),
      value: mean,
      se,
      signf: grp.some((r) => r.signf),
      pP: best(grp, 'pP'),
      pQ: best(grp, 'pQ'),
      ...(reps.length ? { reps } : null)
    })
  }
  return out
}

/**
 * Paired contrast: join two value series (two datasets) on uniqID + the shared matched context, and
 * score divergence with the same band/outlier model as the single-input path. FC1 = side A's value,
 * FC2 = side B's. Values are fold-changes (Compare inputs) or mean log10 abundances (Standardize
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
  const baseA = input.labelA || 'A'
  const baseB = input.labelB || 'B'
  const present = (rows: ContrastSideRow[], c: ConditionKey): boolean =>
    rows.some((r) => csval(r, c) !== null && csval(r, c) !== '')
  // Align only on the requested dims that both sides actually carry.
  const ctxConds = input.match.filter((c) => present(input.sideA, c) && present(input.sideB, c))
  // Every other condition must be pinned to one slice per side — never averaged across.
  const sideA = applyFix(input.sideA, input.fix?.a ?? {}, ctxConds)
  const sideB = applyFix(input.sideB, input.fix?.b ?? {}, ctxConds)
  const unpinned = unpinnedConditions(sideA, sideB, ctxConds)
  if (unpinned.length > 0)
    throw new Error(
      `Pick one ${unpinned.map((u) => `${u.cond} on ${u.side === 'a' ? baseA : baseB}`).join(', ')} — a condition is matched or fixed to one slice, never pooled.`
    )
  // Names carry the fixed slices ("KO vs WT (dose 5)") so axis titles say what was contrasted.
  const fixedConds = condsIn([...input.sideA, ...input.sideB]).filter(
    (c) => !ctxConds.includes(c) && (present(sideA, c) || present(sideB, c))
  )
  const labelA = `${baseA}${sliceSuffix(sideA, fixedConds, baseA)}`
  const labelB = `${baseB}${sliceSuffix(sideB, fixedConds, baseB)}`
  const comparison = `${labelA} | ${labelB}`

  const A = aggregateSide(sideA, ctxConds)
  const B = aggregateSide(sideB, ctxConds)

  const records: ContrastResultRow[] = []
  for (const key of new Set([...A.keys(), ...B.keys()])) {
    const a = A.get(key)
    const b = B.get(key)
    const rep = (a ?? b)! // one side is always present for a key drawn from either map
    records.push({
      uniqID: rep.uniqID,
      cell: ctxConds.includes('cell') ? ((rep.cell ?? null) as string | null) : undefined,
      cmpd: ctxConds.includes('cmpd') ? ((rep.cmpd ?? undefined) as string | undefined) : undefined,
      dose: ctxConds.includes('dose') ? (rep.dose ?? null) : null,
      time: ctxConds.includes('time') ? (rep.time ?? null) : null,
      ...ctxExtra(rep, ctxConds),
      cmp_cond: 'dataset',
      cmp1: labelA,
      cmp2: labelB,
      comparison,
      FC1: a?.value ?? null,
      FC2: b?.value ?? null,
      FC1err: a?.se ?? null,
      FC2err: b?.se ?? null,
      FC1reps: a?.reps ?? null,
      FC2reps: b?.reps ?? null,
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

  const driverMask = input.driverMask ?? true
  addGaussianOutliers(records, ctxConds, method, driverMask, input.stat)
  return {
    rows: records,
    comparisons: records.length ? [comparison] : [],
    classify: { ctxConds, driverMask }
  }
}

/** How one condition's values line up across the two sides of a PAIRED contrast (drives the
 *  selector's chip colours): `both` pair, `onlyA`/`onlyB` never will; `a`/`b` are each side's
 *  full value lists (for pinning a slice when the condition isn't matched). */
export interface PairValueAlignment {
  both: string[]
  onlyA: string[]
  onlyB: string[]
  a: string[]
  b: string[]
}

export interface ContrastPairPreview {
  /** every condition with values on either side (matchable when on both) */
  conditions: ConditionKey[]
  /** conditions both sides carry — the candidates to match on */
  candidates: ConditionKey[]
  /** per condition, how its values align across the sides */
  values: Partial<Record<ConditionKey, PairValueAlignment>>
  /** unmatched conditions still needing one slice picked on a side (blocks the run) */
  unpinned: { cond: ConditionKey; side: 'a' | 'b' }[]
  /** the requested match dims both sides actually carry (what the run aligns on) */
  matched: ConditionKey[]
  /** context groups (one per combination of matched values present on both sides) */
  groups: number
  columns: string[]
  /** one row per context group: dataset A (name · fixed slices), "vs", dataset B, its matched
   *  values, then "paired (A genes vs B genes)" */
  rows: string[][]
  warnings: string[]
}

const valueSet = (rows: ContrastSideRow[], c: ConditionKey): Set<string> => {
  const out = new Set<string>()
  for (const r of rows) {
    const v = csval(r, c)
    if (v !== null && v !== '') out.add(String(v))
  }
  return out
}
const numAware = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true })

/** " (dose 5 · cell K2)": the one slice a side sits at for each of `conds` (skipping conditions
 *  the side doesn't carry, or that still vary there). Appended to the dataset's name so labels and
 *  axis titles say which slices were contrasted; the preview table renders a trailing
 *  parenthetical faint, like its "vs" separator. */
export function sliceSuffix(
  rows: ContrastSideRow[],
  conds: ConditionKey[],
  /** the name the suffix qualifies: a slice value it already spells out (a select-mode side
   *  named after its pinned cmpd) isn't repeated — "CmpdA" rather than "CmpdA (cmpd CmpdA)" */
  base = ''
): string {
  const parts: string[] = []
  for (const c of conds) {
    const v = [...valueSet(rows, c)]
    if (v.length === 1 && !base.includes(v[0])) parts.push(`${condLabel(c)} ${v[0]}`)
  }
  return parts.length ? ` (${parts.join(' · ')})` : ''
}

/** Keep only the rows at each condition's picked values. A saved single-value pin on a MATCHED
 *  condition is ignored: it dates from before picks were lists, when a pin only ever fixed an
 *  unmatched condition — a stale one (fixed, then switched back to matched) would filter the two
 *  sides to different values and leave nothing to pair. A list applies either way. */
export function applyFix(
  rows: ContrastSideRow[],
  fix: PairPins,
  matched: ConditionKey[] = []
): ContrastSideRow[] {
  const pins: [ConditionKey, Set<string>][] = []
  for (const [c, v] of Object.entries(fix) as [ConditionKey, string | string[] | undefined][]) {
    if (Array.isArray(v)) {
      if (v.length > 0) pins.push([c, new Set(v.map(String))])
    } else if (v != null && v !== '' && !matched.includes(c)) pins.push([c, new Set([v])])
  }
  if (pins.length === 0) return rows
  return rows.filter((r) => pins.every(([c, vs]) => vs.has(String(csval(r, c) ?? ''))))
}

/** Conditions that would still be pooled: more than one value on a side, and neither matched nor
 *  (after `applyFix`) reduced to one value there. */
export function unpinnedConditions(
  sideA: ContrastSideRow[],
  sideB: ContrastSideRow[],
  matched: ConditionKey[]
): { cond: ConditionKey; side: 'a' | 'b' }[] {
  const out: { cond: ConditionKey; side: 'a' | 'b' }[] = []
  for (const c of condsIn([...sideA, ...sideB])) {
    if (matched.includes(c)) continue
    if (valueSet(sideA, c).size > 1) out.push({ cond: c, side: 'a' })
    if (valueSet(sideB, c).size > 1) out.push({ cond: c, side: 'b' })
  }
  return out
}

/** Dry run of a paired contrast: what would align, and the context groups it would produce. */
export function previewContrastPair(
  rawA: ContrastSideRow[],
  rawB: ContrastSideRow[],
  match: ConditionKey[],
  labels: { a: string; b: string } = { a: 'A', b: 'B' },
  fix: PairFix = { a: {}, b: {} }
): ContrastPairPreview {
  const conditions = condsIn([...rawA, ...rawB]).filter(
    (c) => valueSet(rawA, c).size > 0 || valueSet(rawB, c).size > 0
  )
  const candidates = conditions.filter(
    (c) => valueSet(rawA, c).size > 0 && valueSet(rawB, c).size > 0
  )
  // Alignment is reported on the RAW sides (so the selector can show every value to pin); the
  // groups below use the fixed slices.
  const values: ContrastPairPreview['values'] = {}
  for (const c of conditions) {
    const a = valueSet(rawA, c)
    const b = valueSet(rawB, c)
    values[c] = {
      both: [...a].filter((v) => b.has(v)).sort(numAware),
      onlyA: [...a].filter((v) => !b.has(v)).sort(numAware),
      onlyB: [...b].filter((v) => !a.has(v)).sort(numAware),
      a: [...a].sort(numAware),
      b: [...b].sort(numAware)
    }
  }
  const matched = match.filter((c) => candidates.includes(c))
  const sideA = applyFix(rawA, fix.a, matched)
  const sideB = applyFix(rawB, fix.b, matched)
  const unpinned = unpinnedConditions(sideA, sideB, matched)
  // Context groups: one per combination of matched values, counting genes per side and paired.
  const ctxKey = (r: ContrastSideRow): string =>
    matched.map((c) => String(csval(r, c) ?? '')).join('¦')
  const genesBy = (rows: ContrastSideRow[]): Map<string, Set<string>> => {
    const m = new Map<string, Set<string>>()
    for (const r of rows) {
      const k = ctxKey(r)
      let s = m.get(k)
      if (!s) m.set(k, (s = new Set()))
      s.add(r.uniqID)
    }
    return m
  }
  const A = genesBy(sideA)
  const B = genesBy(sideB)
  const keys = [...new Set([...A.keys(), ...B.keys()])].sort(numAware)
  // Unmatched conditions are pinned per side: the slice becomes part of the dataset's name
  // ("KO vs WT (dose 5)") so the table states exactly which slices are contrasted.
  const fixedConds = conditions.filter((c) => !matched.includes(c))
  const nameA = `${labels.a}${sliceSuffix(sideA, fixedConds)}`
  const nameB = `${labels.b}${sliceSuffix(sideB, fixedConds)}`
  const rows: string[][] = []
  let paired = 0
  for (const k of keys) {
    const a = A.get(k)
    const b = B.get(k)
    if (!a || !b) continue // present on one side only — nothing to pair there
    let n = 0
    for (const g of a) if (b.has(g)) n++
    paired += n
    rows.push([
      nameA,
      'vs',
      nameB,
      ...(matched.length ? k.split('¦') : []),
      `${n} (${a.size} vs ${b.size})`
    ])
  }
  // The '' column is a UI-only "vs" between the two datasets (rendered muted by the table).
  const columns = ['dataset A', '', 'dataset B', ...matched.map(condLabel), 'paired genes']
  const warnings: string[] = []
  for (const u of unpinned)
    warnings.push(
      `Pick one ${u.cond} on ${u.side === 'a' ? labels.a : labels.b} — or match on it. Values are never pooled across a condition.`
    )
  if (rows.length === 0)
    warnings.push('The two datasets share no combination of the matched values.')
  else if (paired === 0) warnings.push('No gene is present on both sides in any context group.')
  return {
    conditions,
    candidates,
    values,
    unpinned,
    matched,
    groups: rows.length,
    columns,
    rows,
    warnings
  }
}

/** Add thrsh/signf/effect via OLS or marginal outlier detection, then (when `driverMask`) keep a
 *  divergent call only where a side is itself significant. */
function addGaussianOutliers(
  rows: ContrastResultRow[],
  ctxCols: ConditionKey[],
  method: 'ols' | 'marginal',
  driverMask = true,
  stat: ContrastStat = {}
): void {
  const { confUp, confDown, q } = statTails(stat)
  const pct = (c: number): string => `${Math.round(c * 1000) / 10}%`
  const qSame = AXIS_TAILS.every((t) => q[t] === q.aUp)
  // The label carries the cutoffs (per tail when they differ): the scatter guide parses it to
  // draw the matching boundary.
  const identity = method === 'ols' && stat.model === 'identity'
  const label =
    method === 'ols'
      ? `${identity ? 'identity' : 'ols'} prediction, ${pct(confUp)}${confDown !== confUp ? `/${pct(confDown)}` : ''}`
      : qSame
        ? `marginal gaussian (robust), per-axis q < ${q.aUp}`
        : `marginal gaussian (robust), per-axis q < A ${q.aUp}/${q.aDown}, B ${q.bUp}/${q.bDown}`
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

    if (identity) {
      // Identity: FC1 = FC2 + ε — the band centred on y = x, nothing fitted, so each gene's
      // residual is FC1 − FC2 and the spread their RMS about the line (n degrees of freedom).
      const resid = fc1.map((v, i) => v - fc2[i])
      const s = Math.sqrt(resid.reduce((acc, e) => acc + e * e, 0) / n)
      if (s === 0) continue
      const tUp = studentTppf(1 - confUp, n)
      const tDown = studentTppf(1 - confDown, n)
      valid.forEach((r, i) => {
        const signf = resid[i] > 0 ? resid[i] > tUp * s : -resid[i] > tDown * s
        r.signf = signf
        r.effect = signf ? (resid[i] > 0 ? 'up' : 'down') : 'none'
      })
    } else if (method === 'ols') {
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
      // Two-sided critical t per tail: t.ppf(1 − (1−conf)/2, n−2). Above the line uses the up
      // tail's confidence, below it the down tail's.
      const tUp = studentTppf(1 - confUp, n - 2)
      const tDown = studentTppf(1 - confDown, n - 2)
      valid.forEach((r, i) => {
        const lever = s * Math.sqrt(1 + 1 / n + (x[i] - xMean) ** 2 / Sxx)
        const signf = resid[i] > 0 ? resid[i] > tUp * lever : -resid[i] > tDown * lever
        r.signf = signf
        // The direction follows the model: above the fitted line (A higher than the fit predicts
        // from B) is up, below it down — the side of the band the gene broke out of. (omicViz
        // takes the sign of FC1 − FC2, the side of y = x, which disagrees with the band wherever
        // the fit runs off the diagonal.)
        r.effect = signf ? (resid[i] > 0 ? 'up' : 'down') : 'none'
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
      // Per axis, a value above its centre is judged against that axis's up tail, below → down.
      valid.forEach((r, i) => {
        const sig1 = q1[i] < (fc1[i] >= mu1 ? q.aUp : q.aDown)
        const sig2 = q2[i] < (fc2[i] >= mu2 ? q.bUp : q.bDown)
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

/** Redo a Contrast's divergence calls under new cutoffs, from its stored rows — the per-side values
 *  and calls don't depend on them, so no re-run (as a Compare re-classifies on a threshold drag).
 *  Each feature's rows are called apart, as the run calls them. Null for a result that didn't keep
 *  how it was called (`classify`): that one needs a re-run. */
export function reclassifyContrast(
  ctr: ContrastResult,
  relationship: 'correlated' | 'independent' | undefined,
  stat: ContrastStat
): ContrastResult | null {
  if (!ctr.classify) return null
  const { ctxConds, driverMask } = ctr.classify
  const method = relationship === 'independent' ? 'marginal' : 'ols'
  const rows = ctr.rows.map((r) => ({ ...r, signf: false, effect: 'none' }))
  const byFeature = new Map<string, ContrastResultRow[]>()
  for (const r of rows) {
    const k = r.featureId ?? ''
    let arr = byFeature.get(k)
    if (!arr) byFeature.set(k, (arr = []))
    arr.push(r)
  }
  for (const part of byFeature.values())
    addGaussianOutliers(part, ctxConds, method, driverMask, stat)
  return { ...ctr, rows }
}

/** A dragged scatter guide as a stat patch, written the way the Statistic panel writes it: the
 *  primary level (the band's top edge, A's up line) sets both models' fields, so switching model
 *  keeps it; under `asymmetric`, any other edge sets its own tail. Not asymmetric, every edge sets
 *  the primary (the edges mirror). `value` is a band confidence or an axis q. */
export function contrastStatDrag(
  stat: ContrastStat | undefined,
  edge: 'bandUp' | 'bandDown' | AxisTail,
  value: number
): Partial<ContrastStat> {
  const asym = stat?.asymmetric ?? false
  const round3 = (v: number): number => Math.round(v * 1000) / 1000
  const conf = (c: number): number => round3(Math.min(0.999, Math.max(0.5, c)))
  // up, not to nearest: a q just above the passing genes' must stay above them once stored
  const q = (v: number): number => Math.min(0.5, Math.max(0.001, Math.ceil(v * 1000 - 1e-9) / 1000))
  if (edge === 'bandUp' || edge === 'bandDown') {
    const c = conf(value)
    if (edge === 'bandDown' && asym) return { bandConfidenceDown: c }
    return { bandConfidence: c, cutoffQ: round3(1 - c) }
  }
  const v = q(value)
  if (edge === 'aUp' || !asym) return { cutoffQ: v, bandConfidence: round3(1 - v) }
  return { cutoffQTails: { ...stat?.cutoffQTails, [edge]: v } }
}

function mean(a: number[]): number {
  return a.reduce((s, v) => s + v, 0) / a.length
}
