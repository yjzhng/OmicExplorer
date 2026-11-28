import {
  type ConditionKey,
  type StandardizeResult,
  classifyConditions,
  numericConds,
  previewCompare,
  previewFactorAnova
} from '../../engine'
import { anovaFactorsOf, type CompareConfig } from '../../graph/config/compare'

/** How many comparisons the configured comparison would run (a dry-run count for the ready
 *  message): distinct num|den labels for an explicit compare; an ANOVA's overall comparisons and
 *  the terms it can test. Null if it can't be determined (not configured / incomplete). */
export function comparisonCount(
  std: StandardizeResult,
  config: CompareConfig
): { n: number; on: ConditionKey[] } | null {
  try {
    if (config.analysis === 'anova') {
      const factors = anovaFactorsOf(config, numericConds(std.numericConditions ?? []))
      if (!factors.length) return null
      const pv = previewFactorAnova({
        rows: std.rows,
        factors,
        activeConditions: std.activeConditions,
        num: config.num,
        den: config.den
      })
      return {
        n: new Set(pv.rows.map((r) => r[0])).size + pv.tested.length,
        on: factors.map((f) => f.condition)
      }
    }
    const stated =
      config.analysis === 'compare' ? { compared: config.compared, pool: config.pool } : {}
    const n = previewCompare({
      rows: std.rows,
      num: config.num,
      den: config.den,
      match: config.match,
      ...stated,
      activeConditions: std.activeConditions,
      numericConditions: std.numericConditions ?? [],
      curveAxis: config.analysis === 'curve_fit' ? (config.curveAxis ?? 'dose') : undefined
    }).labels.length
    const on = classifyConditions(
      std.rows,
      config.num,
      config.den,
      std.activeConditions,
      stated.compared
    ).axis
    return { n, on }
  } catch {
    return null
  }
}
