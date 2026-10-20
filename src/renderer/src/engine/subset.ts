/**
 * Subset a standardized dataset to the samples whose conditions take the kept values — the Subset
 * tile's run. `keep` is a CondSelector (condition → the values kept); a condition absent or empty
 * is unfiltered, so an empty selector passes the dataset through unchanged (same reference).
 *
 * Values compare as strings ('' = the condition doesn't apply to that sample), so a numeric dose
 * of 0.1 is kept by '0.1' and a sample with no value for a condition can be kept by ''.
 */
import { condValue } from './compare'
import type {
  CondSelector,
  ConditionKey,
  HasExtra,
  SampleConds,
  StandardizeResult,
  StandardRow
} from './types'
import { condsIn, customCond, isNumericCond, numericOf } from './types'

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

/** One Subset's filter: the conditions' kept values (`keep`), the replicates kept (`reps`, as
 *  text: "1", "2"; unset or empty = every one) and the samples left out by name (`drop`) — a
 *  whole replicate set, or one bad sample of one condition. */
export interface SampleFilter {
  keep?: CondSelector
  reps?: string[]
  drop?: string[]
}

/** Whether a filter constrains anything. */
export const filterActive = (f: SampleFilter): boolean =>
  activeFilters(f.keep ?? {}).length > 0 || (f.reps?.length ?? 0) > 0 || (f.drop?.length ?? 0) > 0

/** Whether a sample passes a filter: its conditions, its replicate, its name. */
export function samplePasses(f: SampleFilter): (s: SampleConds) => boolean {
  const conds = keptBy(f.keep ?? {})
  const reps = f.reps?.length ? new Set(f.reps.map(String)) : null
  const drop = new Set(f.drop ?? [])
  return (s) => conds(s) && (!reps || reps.has(String(s.rep ?? ''))) && !drop.has(s.sample)
}

/** A sample's (or one of its gene rows') identity in a dataset: its conditions and replicate —
 *  how a row is matched to its sample, rows carrying no sample name. */
function sampleKey(r: StandardRow | SampleConds): string {
  const extra = Object.entries(r.extra ?? {})
    .filter(([, v]) => v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([r.cell ?? '', r.cmpd ?? '', r.dose, r.time, extra, r.rep])
}

/** The conditions a subset narrowed to a single value: several values among the samples `before`,
 *  one (or none) among those kept. They no longer tell anything downstream apart, so a subset takes
 *  them off the active conditions — a comparison of the one cell line kept isn't labelled with it
 *  ("Bortezomib (cell RPMI8226)"). One already constant before the subset is left as it was. */
export function narrowedConds(
  before: ReadonlyArray<StandardRow | HasExtra>,
  after: ReadonlyArray<StandardRow | HasExtra>,
  conds: readonly ConditionKey[]
): Set<ConditionKey> {
  const distinct = (src: ReadonlyArray<StandardRow | HasExtra>, c: ConditionKey): number =>
    new Set(src.map((r) => valueOf(r, c))).size
  return new Set(conds.filter((c) => distinct(before, c) > 1 && distinct(after, c) <= 1))
}

export function subsetStandardize(
  std: StandardizeResult,
  keep: CondSelector,
  /** the replicates kept and the samples left out (SampleFilter) */
  more: { reps?: string[]; drop?: string[] } = {}
): StandardizeResult {
  const f: SampleFilter = { keep, ...more }
  if (!filterActive(f)) return std
  // By sample where the result lists them (its rows are matched to theirs by conditions and
  // replicate); a result from before that by the rows' conditions and replicate alone — a sample
  // left out by name needs the list.
  const keptSamples = std.samples?.filter(samplePasses(f))
  const keys = keptSamples ? new Set(keptSamples.map(sampleKey)) : null
  const conds = keptBy(keep)
  const reps = f.reps?.length ? new Set(f.reps.map(String)) : null
  const rows = keys
    ? std.rows.filter((r) => keys.has(sampleKey(r)))
    : std.rows.filter((r) => conds(r) && (!reps || reps.has(String(r.rep ?? ''))))
  // Conditions are re-read from what's left: one that no kept sample carries is no longer active
  // (the same rule Clean data uses), so downstream tiles don't offer an axis with no data on it —
  // nor one the subset narrowed to a single value (narrowedConds).
  const narrowed = narrowedConds(std.samples ?? std.rows, keptSamples ?? rows, std.activeConditions)
  const activeConditions = std.activeConditions.filter(
    (c) => !narrowed.has(c) && rows.some((r) => valueOf(r, c) !== '')
  )
  const cmpds = new Set(rows.map((r) => r.cmpd))
  // Rows stay linear, so they carry over as-is. `inputScale` (and what was detected from it) is
  // dropped, as Merge drops it: the presented scale is then `scale`, the one Clean data ran with.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { inputScale, scaleEvidence, inputHistogram, ...rest } = std
  return {
    ...rest,
    rows,
    ...(keptSamples ? { samples: keptSamples } : {}),
    activeConditions,
    ...(std.numericConditions
      ? { numericConditions: std.numericConditions.filter((c) => activeConditions.includes(c)) }
      : {}),
    compounds: std.compounds.filter((c) => cmpds.has(c))
  }
}

/** Each condition's distinct values in a dataset ('' included when some sample lacks it), in a
 *  stable order: numeric conditions ascending, the rest naturally (A2 before A10). Read from the
 *  sample list when the result kept one — far smaller than the gene × sample rows. */
export function conditionLevels(std: StandardizeResult): Partial<Record<ConditionKey, string[]>> {
  const src: ReadonlyArray<StandardRow | HasExtra> = std.samples ?? std.rows
  return levelsOf(
    src,
    condsIn(src).filter((c) => std.activeConditions.includes(c)),
    numericOf(std)
  )
}

/** conditionLevels for samples read before any run (a samplesheet, for a Subset off Load data):
 *  every condition some sample carries a value for. `numeric` = the custom conditions declared
 *  numeric (their slugs). */
export function sampleLevels(
  samples: readonly HasExtra[],
  numeric: readonly string[] = []
): Partial<Record<ConditionKey, string[]>> {
  const conds = condsIn(samples).filter((c) => samples.some((r) => valueOf(r, c) !== ''))
  return levelsOf(samples, conds, numericOf({ numericConditions: numeric.map(customCond) }))
}

function levelsOf(
  src: ReadonlyArray<StandardRow | HasExtra>,
  conds: ConditionKey[],
  numeric: ReturnType<typeof numericOf>
): Partial<Record<ConditionKey, string[]>> {
  const out: Partial<Record<ConditionKey, string[]>> = {}
  for (const c of conds) {
    const seen = new Set<string>()
    for (const r of src) seen.add(valueOf(r, c))
    out[c] = [...seen].sort((a, b) => {
      if (a === '' || b === '') return a === '' ? 1 : -1
      return isNumericCond(c, numeric)
        ? Number(a) - Number(b)
        : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    })
  }
  return out
}
