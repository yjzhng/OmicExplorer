/**
 * Subset a standardized dataset to the samples whose conditions take the kept values — the Subset
 * tile's run. `keep` is a CondSelector (condition → the values kept); a condition absent or empty
 * is unfiltered, so an empty selector passes the dataset through unchanged (same reference).
 *
 * Values compare as strings ('' = the condition doesn't apply to that sample), so a numeric dose
 * of 0.1 is kept by '0.1' and a sample with no value for a condition can be kept by ''.
 */
import { condValue } from './compare'
import type { CondSelector, ConditionKey, HasExtra, StandardizeResult, StandardRow } from './types'
import { condsIn, isNumericCond } from './types'

const valueOf = (r: StandardRow | HasExtra, c: ConditionKey): string =>
  String(condValue(r, c) ?? '')

/** The filters that actually constrain: conditions with at least one kept value. */
function activeFilters(keep: CondSelector): [ConditionKey, Set<string>][] {
  return (Object.entries(keep) as [ConditionKey, string[] | undefined][])
    .filter(([, vs]) => (vs?.length ?? 0) > 0)
    .map(([c, vs]) => [c, new Set(vs!.map(String))])
}

/** Whether a sample (or a gene × sample row) passes every filter. */
export function keptBy(keep: CondSelector): (r: StandardRow | HasExtra) => boolean {
  const filters = activeFilters(keep)
  return (r) => filters.every(([c, vs]) => vs.has(valueOf(r, c)))
}

export function subsetStandardize(std: StandardizeResult, keep: CondSelector): StandardizeResult {
  if (activeFilters(keep).length === 0) return std
  const pass = keptBy(keep)
  const rows = std.rows.filter(pass)
  // Conditions are re-read from what's left: one that no kept sample carries is no longer active
  // (the same rule Clean data uses), so downstream tiles don't offer an axis with no data on it.
  const activeConditions = std.activeConditions.filter((c) =>
    rows.some((r) => valueOf(r, c) !== '')
  )
  const cmpds = new Set(rows.map((r) => r.cmpd))
  // Rows stay linear, so they carry over as-is. `inputScale` (and what was detected from it) is
  // dropped, as Merge drops it: the presented scale is then `scale`, the one Clean data ran with.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { inputScale, scaleEvidence, inputHistogram, ...rest } = std
  return {
    ...rest,
    rows,
    ...(std.samples ? { samples: std.samples.filter(pass) } : {}),
    activeConditions,
    compounds: std.compounds.filter((c) => cmpds.has(c))
  }
}

/** Each condition's distinct values in a dataset ('' included when some sample lacks it), in a
 *  stable order: numeric conditions ascending, the rest naturally (A2 before A10). Read from the
 *  sample list when the result kept one — far smaller than the gene × sample rows. */
export function conditionLevels(std: StandardizeResult): Partial<Record<ConditionKey, string[]>> {
  const src: ReadonlyArray<StandardRow | HasExtra> = std.samples ?? std.rows
  const conds = condsIn(src).filter((c) => std.activeConditions.includes(c))
  const out: Partial<Record<ConditionKey, string[]>> = {}
  for (const c of conds) {
    const seen = new Set<string>()
    for (const r of src) seen.add(valueOf(r, c))
    out[c] = [...seen].sort((a, b) => {
      if (a === '' || b === '') return a === '' ? 1 : -1
      return isNumericCond(c)
        ? Number(a) - Number(b)
        : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    })
  }
  return out
}
