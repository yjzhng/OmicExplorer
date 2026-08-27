/**
 * Direct comparison: symmetric Welch t-test between two levels of one condition,
 * matched like-to-like across the remaining active conditions.
 *
 * Reimplements omicViz scripts/stats/comparisons.py `_run_condition` + `_finalise`
 * (see [[omicviz-conceptual-reuse]]). Unlike veh_norm there is no asymmetric
 * dose-exclusion — both sides are grouped by every other active condition.
 */
import {
  condPresent,
  condValue,
  finaliseCompare,
  groupRowsBy,
  log2Pos,
  setCond,
  valEq,
  type RawStatRow
} from './compare'
import { DEFAULT_THRESHOLD, welchTTest, type ThresholdConfig } from './stats'
import type {
  CompareInput,
  CompareResultRow,
  CondSelector,
  ConditionKey,
  Pair,
  StandardRow
} from './types'

export interface DirectInput {
  rows: StandardRow[]
  /** condition being compared (strain | cmpd | dose | time) */
  condition: ConditionKey
  /** [numerator, denominator] level pairs, e.g. [["MutantA","WildType"]] */
  pairs: Pair[]
  activeConditions: ConditionKey[]
  /** 'ttest' only for now */
  method?: 'ttest'
  /** ttest only: log2-transform before testing (omicViz default true) */
  transform?: boolean
  threshold?: ThresholdConfig
  /** optional: restrict to rows whose named conditions match these values */
  filter?: Partial<Record<ConditionKey, Array<string | number>>>
}

/** A finalised comparison table (rows + the comparison labels present). */
export interface CompareTableResult {
  rows: CompareResultRow[]
  comparisons: string[]
}

export function runDirect(input: DirectInput): CompareTableResult {
  const { condition, pairs, activeConditions } = input
  const transform = input.transform ?? true
  const method = input.method ?? 'ttest'
  const threshold: ThresholdConfig = input.threshold ?? { ...DEFAULT_THRESHOLD, statType: 'pQ' }
  const transformed = transform && method === 'ttest'
  const statValue = (r: StandardRow): number => (transformed ? log2Pos(r.value) : (r.value ?? NaN))

  // Optional like-for-like filter on condition values.
  let data = input.rows
  if (input.filter) {
    for (const [col, vals] of Object.entries(input.filter) as Array<
      [ConditionKey, Array<string | number>]
    >) {
      data = data.filter((r) => vals.some((v) => valEq(condValue(r, col), v)))
    }
  }

  // Like-to-like grouping: every active condition except the compared one, if present.
  const otherDims = activeConditions.filter((c) => c !== condition && condPresent(data, c))

  const groups = groupRowsBy(data, otherDims)

  const raw: RawStatRow[] = []
  const comparisons: string[] = []

  for (const [numVal, denVal] of pairs as Pair[]) {
    const label = `${numVal} | ${denVal}`
    if (!comparisons.includes(label)) comparisons.push(label)

    for (const grp of groups.values()) {
      const rep = grp[0]
      const numRows = grp.filter((r) => valEq(condValue(r, condition), numVal))
      const denRows = grp.filter((r) => valEq(condValue(r, condition), denVal))
      if (numRows.length === 0 || denRows.length === 0) continue

      const numAgg = numRows.map((r) => ({ uniqID: r.uniqID, value: statValue(r) }))
      const denAgg = denRows.map((r) => ({ uniqID: r.uniqID, value: statValue(r) }))
      const res = welchTTest(numAgg, denAgg, transformed)

      for (const w of res) {
        const row: RawStatRow = {
          uniqID: w.uniqID,
          cmp_cond: condition,
          comparison: label,
          mean1: w.mean1,
          mean2: w.mean2,
          sd1: w.sd1,
          sd2: w.sd2,
          log2FC: w.log2FC,
          pVal: w.pVal
        }
        setCond(row, condition, numVal) // numerator condition value
        for (const d of otherDims) setCond(row, d, condValue(rep, d)) // context values
        raw.push(row)
      }
    }
  }

  return { rows: finaliseCompare(raw, threshold), comparisons }
}

/** A dry-run summary of what an explicit comparison would produce, for the config dialog:
 *  the distinct num|den labels, the context/faceting split, and any warnings — no stats. */
export interface ComparePreview {
  /** distinct numerator|denominator axis labels */
  labels: string[]
  /** table headers: ['numerator','denominator', ...facet/context dims] */
  columns: string[]
  /** table body, one row per context group actually run (aligned to `columns`) */
  rows: string[][]
  /** conditions faceting the numerator (context) */
  facets: ConditionKey[]
  /** of the facets, which are matched like-for-like vs pooled on the denominator */
  matched: ConditionKey[]
  pooled: ConditionKey[]
  /** number of (context × axis-value) groups that yield a non-empty comparison */
  groups: number
  warnings: string[]
}

// ── explicit comparison: numerator vs denominator cond-value selections ───────
// One unified path that subsumes direct and veh_norm. Nothing is inferred from names or dose:
// the two sides are exactly what the selectors say, and the `match` set (not a hardcoded
// dose-exclusion) decides which conditions the denominator must line up on.

const pinned = (sel: CondSelector, c: ConditionKey): boolean =>
  Array.isArray(sel[c]) && (sel[c] as string[]).length > 0

/** Row passes a selector when, for every pinned condition, its value is one of the chosen. */
function selectorMatch(sel: CondSelector, r: StandardRow, active: ConditionKey[]): boolean {
  for (const c of active) {
    if (!pinned(sel, c)) continue
    const v = condValue(r, c)
    if (!(sel[c] as string[]).some((want) => valEq(v, want))) return false
  }
  return true
}

const sameSet = (a?: string[], b?: string[]): boolean => {
  const A = new Set((a ?? []).map(String))
  const B = new Set((b ?? []).map(String))
  return A.size === B.size && [...A].every((x) => B.has(x))
}

/**
 * Run an explicit numerator-vs-denominator comparison. The comparison *axis* is whichever
 * condition(s) are pinned on BOTH sides with differing values (e.g. cmpd: drug vs dmso, or
 * dose: 100 vs 0) — that becomes `cmp_cond`, excluded from downstream faceting. Every other
 * present condition faceting the numerator is carried as context; matched context conditions
 * also constrain the denominator slice, unmatched ones let it pool.
 */
export function runCompare(input: CompareInput): CompareTableResult {
  const { num, den, activeConditions: active } = input
  const transform = input.transform ?? true
  const method = input.method ?? 'ttest'
  const threshold: ThresholdConfig = input.threshold ?? { ...DEFAULT_THRESHOLD, statType: 'pQ' }
  const transformed = transform && method === 'ttest'
  const statValue = (r: StandardRow): number => (transformed ? log2Pos(r.value) : (r.value ?? NaN))

  const numRows = input.rows.filter((r) => selectorMatch(num, r, active))
  const denRows = input.rows.filter((r) => selectorMatch(den, r, active))

  // Axis = conditions pinned on both sides with different value sets (what's being compared).
  const axisDims = active.filter((c) => pinned(num, c) && pinned(den, c) && !sameSet(num[c], den[c]))
  const axisSet = new Set(axisDims)
  // Facet the numerator by every present condition except the axis. A multi-value numerator pin
  // ON the axis also fans out (each level is its own comparison), so include those in grouping.
  const facetDims = active.filter((c) => !axisSet.has(c) && condPresent(numRows, c))
  const numMultiAxis = axisDims.filter((c) => (num[c]?.length ?? 0) > 1)
  const groupDims = [...facetDims, ...numMultiAxis]
  const contextDims = [...facetDims, ...axisDims] // values carried onto each result row
  const matchSet = new Set(input.match)

  // Label by the differing axis values; with no axis (degenerate overlap) fall back to each side's
  // full pin list so the comparison string is never blank.
  const hasAxis = axisDims.length > 0
  const pinLabel = (sel: CondSelector): string =>
    active.filter((c) => pinned(sel, c)).map((c) => (sel[c] as string[]).join('/')).join(' · ')
  const denAxisLabel = hasAxis ? axisDims.map((c) => (den[c] ?? []).join('/')).join(' · ') : pinLabel(den)

  const groups = groupRowsBy(numRows, groupDims)
  const raw: RawStatRow[] = []
  const comparisons: string[] = []
  const cmpCond = axisDims.length ? axisDims.join(':') : (active.find((c) => pinned(num, c)) ?? 'cmpd')

  for (const grp of groups.values()) {
    const rep = grp[0]
    // Denominator slice: the pre-filtered den rows, further matched on the MATCHED context dims
    // to this numerator group (unmatched dims are left free, so the reference pools over them).
    const denSlice = denRows.filter((d) =>
      groupDims.every((c) => {
        if (!matchSet.has(c)) return true
        const want = condValue(rep, c)
        return want == null ? condValue(d, c) == null : valEq(condValue(d, c), want)
      })
    )
    if (grp.length === 0 || denSlice.length === 0) continue

    const numAxisLabel = hasAxis
      ? axisDims.map((c) => String(condValue(rep, c) ?? '')).join(' · ')
      : pinLabel(num)
    const label = `${numAxisLabel || '(num)'} | ${denAxisLabel || '(den)'}`
    if (!comparisons.includes(label)) comparisons.push(label)

    const numAgg = grp.map((r) => ({ uniqID: r.uniqID, value: statValue(r) }))
    const denAgg = denSlice.map((r) => ({ uniqID: r.uniqID, value: statValue(r) }))
    const res = welchTTest(numAgg, denAgg, transformed)
    for (const w of res) {
      const row: RawStatRow = {
        uniqID: w.uniqID,
        cmp_cond: cmpCond,
        comparison: label,
        mean1: w.mean1,
        mean2: w.mean2,
        sd1: w.sd1,
        sd2: w.sd2,
        log2FC: w.log2FC,
        pVal: w.pVal
      }
      for (const c of contextDims) setCond(row, c, condValue(rep, c))
      raw.push(row)
    }
  }

  return { rows: finaliseCompare(raw, threshold), comparisons }
}

/** Dry-run the grouping of an explicit comparison (no t-tests) for live config feedback. */
export function previewCompare(input: CompareInput): ComparePreview {
  const { num, den, activeConditions: active } = input
  const numRows = input.rows.filter((r) => selectorMatch(num, r, active))
  const denRows = input.rows.filter((r) => selectorMatch(den, r, active))
  const anyPin = (sel: CondSelector): boolean => active.some((c) => pinned(sel, c))
  const warnings: string[] = []
  if (!anyPin(num)) warnings.push('Numerator is empty — pin at least one condition.')
  if (!anyPin(den)) warnings.push('Denominator is empty — pin at least one condition.')
  if (anyPin(num) && numRows.length === 0) warnings.push('No rows match the numerator selection.')
  if (anyPin(den) && denRows.length === 0) warnings.push('No rows match the denominator selection.')

  const axisDims = active.filter((c) => pinned(num, c) && pinned(den, c) && !sameSet(num[c], den[c]))
  const axisSet = new Set(axisDims)
  const facetDims = active.filter((c) => !axisSet.has(c) && condPresent(numRows, c))
  const numMultiAxis = axisDims.filter((c) => (num[c]?.length ?? 0) > 1)
  const groupDims = [...facetDims, ...numMultiAxis]
  const matchSet = new Set(input.match)
  // With a real axis, label by the differing values; with none (degenerate overlap), fall back to
  // each side's full pin list so the string is never blank.
  const hasAxis = axisDims.length > 0
  const pinLabel = (sel: CondSelector): string =>
    active.filter((c) => pinned(sel, c)).map((c) => (sel[c] as string[]).join('/')).join(' · ')
  const denAxisLabel = hasAxis ? axisDims.map((c) => (den[c] ?? []).join('/')).join(' · ') : pinLabel(den)

  const groups = groupRowsBy(numRows, groupDims)
  const labels = new Set<string>()
  const columns = ['comparison', 'numerator', 'denominator', ...facetDims]
  const tableRows: string[][] = []
  let ok = 0
  let emptyDen = 0
  for (const grp of groups.values()) {
    const rep = grp[0]
    const denSlice = denRows.filter((d) =>
      groupDims.every((c) => {
        if (!matchSet.has(c)) return true
        const want = condValue(rep, c)
        return want == null ? condValue(d, c) == null : valEq(condValue(d, c), want)
      })
    )
    const numAxisLabel = hasAxis
      ? axisDims.map((c) => String(condValue(rep, c) ?? '')).join(' · ')
      : pinLabel(num)
    labels.add(`${numAxisLabel || '(num)'} | ${denAxisLabel || '(den)'}`)
    if (denSlice.length === 0) {
      emptyDen++
      continue
    }
    ok++
    // One comparison per context combination: the num|den label, the axis num/den split,
    // then each facet dim's value.
    const num1 = numAxisLabel || '—'
    const den1 = denAxisLabel || '—'
    tableRows.push([
      `${num1} | ${den1}`,
      num1,
      den1,
      ...facetDims.map((c) => String(condValue(rep, c) ?? ''))
    ])
  }
  if (emptyDen > 0)
    warnings.push(
      `${emptyDen} of ${emptyDen + ok} context group(s) have no denominator rows — un-match a condition?`
    )
  // No axis at all (both sides pinned but no condition takes different values) = a degenerate
  // overlap, e.g. "drugA (any dose)" vs "drugA · dose=5". Not a real comparison.
  if (!hasAxis && anyPin(num) && anyPin(den))
    warnings.push(
      'Numerator and denominator don’t differ on any condition — set a different value on some condition to define what’s being compared.'
    )

  const facets = facetDims
  return {
    labels: [...labels],
    columns,
    rows: tableRows,
    facets,
    matched: facets.filter((c) => matchSet.has(c)),
    pooled: facets.filter((c) => !matchSet.has(c)),
    groups: ok,
    warnings
  }
}
