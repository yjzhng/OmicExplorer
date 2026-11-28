/**
 * Plots offered in variants by their config: the Response plots, one per numeric condition (`dr`,
 * its `axis`) or one per pair of them (`tdr` / `response`, their `pair`). Each variant is its own
 * tile, so several can be on view at once; the variant names the tile ("Dose response",
 * "Dose & Time response").
 */
import { condLabel, type ConditionKey } from '../../engine'
import { type TdrConfig, tdrPair } from '../../graph/config/response'
import type { PlotVariants } from '../contract'

/** A numeric condition as a Response plot's title names it: capitalised (`Dose`, `Temperature`). */
const condTitle = (c: ConditionKey): string => {
  const l = condLabel(c)
  return l.charAt(0).toUpperCase() + l.slice(1)
}
/** A Response plot's name from the numeric conditions it's over: "Dose response",
 *  "Dose & Time response". */
export const responseLabel = (conds: readonly ConditionKey[]): string =>
  `${conds.map(condTitle).join(' & ')} response`

/** Over one condition (`dr`): one entry per numeric condition. */
export const responseAxisVariants: PlotVariants = {
  label: (config) => responseLabel([(config as { axis?: ConditionKey } | null)?.axis ?? 'dose']),
  entries: (kind, axes) =>
    axes.map((a) => ({ kind, label: responseLabel([a]), override: { axis: a } })),
  override: (config) => ({ axis: (config as { axis?: ConditionKey } | null)?.axis ?? 'dose' })
}

/** The pair a pair-variant plot's config is over: a `tdr`'s (tdrPair), a `response`'s `pair`. */
const pairOf = (config: unknown, tdr: boolean): [ConditionKey, ConditionKey] =>
  tdr
    ? tdrPair(config as TdrConfig | undefined)
    : ((config as { pair?: [ConditionKey, ConditionKey] } | undefined)?.pair ?? ['dose', 'time'])

/** Over a pair of conditions (`tdr`, `response`): one entry per pair, the earlier along x. */
const pairVariants = (tdr: boolean): PlotVariants => ({
  label: (config) => responseLabel(pairOf(config, tdr)),
  entries: (kind, axes) =>
    axes.flatMap((a, i) =>
      axes
        .slice(i + 1)
        .map((b) => ({ kind, label: responseLabel([a, b]), override: { pair: [a, b] } }))
    ),
  override: (config) => ({ pair: pairOf(config, tdr) })
})
export const tdrVariants = pairVariants(true)
export const responsePairVariants = pairVariants(false)
