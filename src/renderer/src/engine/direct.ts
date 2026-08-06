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
import type { CompareResultRow, ConditionKey, Pair, StandardRow } from './types'

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
