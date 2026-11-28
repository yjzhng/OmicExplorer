/** A Contrast over several features at once (Contrast's run, `stack`): each feature's pair
 *  contrasted alike and their rows stacked, each tagged with its feature — the results page's
 *  switcher picks one. Done here in the engine so the tagged rows go back as a table: tagging
 *  them on the UI thread built every row there and then packed them all again. */
import { runContrastPair, type ContrastFeatureId, type ContrastPairInput } from './contrast'
import type { ContrastResult } from './contrast'

export interface ContrastStackPart {
  input: ContrastPairInput
  /** the feature each row is tagged with (absent: the one feature, untagged) */
  tag?: { featureId: ContrastFeatureId; feature: string }
}

export function stackContrasts(parts: ContrastStackPart[]): ContrastResult {
  const done = parts.map(({ input, tag }) => ({ tag, ctr: runContrastPair(input) }))
  const tagged = ({ tag, ctr }: (typeof done)[number]): ContrastResult['rows'] =>
    tag ? ctr.rows.map((r) => ({ ...r, featureId: tag.featureId, feature: tag.feature })) : ctr.rows
  if (done.length === 1) return { ...done[0].ctr, rows: tagged(done[0]) }
  const classify = done[0].ctr.classify
  return {
    ...done[0].ctr,
    // every feature's linear cutoffs from its inputs, for re-calling in place
    ...(classify
      ? {
          classify: {
            ...classify,
            cutoffDefaults: Object.assign({}, ...done.map((p) => p.ctr.classify?.cutoffDefaults))
          }
        }
      : null),
    rows: done.flatMap(tagged)
  }
}
