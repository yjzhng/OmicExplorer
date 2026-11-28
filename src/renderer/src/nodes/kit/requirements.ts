import { multiLevelAxes } from '../../graph/models/axisAvail'
import { type ConditionKey, condLabel, someNested } from '../../engine'
import type { UpstreamFacts } from '../contract'

export const needAxis = (u: UpstreamFacts, axis: ConditionKey): string | null =>
  u.axes.includes(axis) ? null : `Needs a numeric ${condLabel(axis)} condition in the data`
/** The upstream's conditions with a series (two levels or more): unknown before it has run, so
 *  then every numeric condition it has (custom ones too), never blocking on a guess. */
export const seriesIn = (u: UpstreamFacts): readonly ConditionKey[] =>
  u.result ? multiLevelAxes(u.result) : u.axes
/** Over one level there is no response to draw: a curve or a bubble row needs a series. */
export const needSeries = (u: UpstreamFacts, axis: ConditionKey): string | null =>
  needAxis(u, axis) ??
  (seriesIn(u).includes(axis)
    ? null
    : `Only one ${condLabel(axis)} level here — needs at least two to show a response`)
/** The most common taxon among the fetched annotations (0 = none). */
export function dominantTaxon(ann: Record<string, Record<string, string>>): number {
  const tally = new Map<number, number>()
  for (const rec of Object.values(ann)) {
    const t = parseInt((rec.taxon ?? '').trim(), 10)
    if (Number.isFinite(t) && t > 0) tally.set(t, (tally.get(t) ?? 0) + 1)
  }
  let best = 0
  let bestN = 0
  for (const [t, n] of tally) if (n > bestN) [best, bestN] = [t, n]
  return best
}
/** The organism STRING files the proteins under: the taxon their STRING ids carry
 *  ("511145.b0001" → 511145), the most common — else the annotations' own (dominantTaxon); 0 =
 *  none. STRING follows NCBI's reference genome, which can be a strain below the taxon UniProt
 *  names: E. coli K-12's proteome is UniProt's 83333, its STRING organism MG1655, 511145. */
export function stringTaxon(ann: Record<string, Record<string, string>>): number {
  const tally = new Map<number, number>()
  for (const rec of Object.values(ann))
    for (const id of (rec.stringId ?? '').split(/[;,\s]+/)) {
      const t = parseInt(id.slice(0, id.indexOf('.')), 10)
      if (id.includes('.') && Number.isFinite(t) && t > 0) tally.set(t, (tally.get(t) ?? 0) + 1)
    }
  let best = 0
  let bestN = 0
  for (const [t, n] of tally) if (n > bestN) [best, bestN] = [t, n]
  return best || dominantTaxon(ann)
}
/** stringTaxon of a result's annotations, kept by the map: the plot gates ask on every canvas
 *  render, and it walks every gene's annotations — half a second on a proteome. A result's map is
 *  never changed once made (a re-run makes a new one); maps built up in place (the import dialog's)
 *  call stringTaxon itself. */
const taxonOf = new WeakMap<object, number>()
export function resultStringTaxon(ann: Record<string, Record<string, string>>): number {
  let t = taxonOf.get(ann)
  if (t === undefined) taxonOf.set(ann, (t = stringTaxon(ann)))
  return t
}
// Which plots take a Curve fit is their `acceptsFrom` (a fitted curve has no per-dose rows or group
// means, so MA, Scatter, Bubble and Time & Dose-response don't; Potency and the residual plots take
// nothing else).
/** The residual plots are CurveCurator's QC of its 4PL fits. */
export const CC_ONLY =
  'Needs the CurveCurator method’s curves — set the Curve fit’s model to 4PL, over dose or time'
/** Dose × time surfaces are drawn by the Response plot, not as single curves. */
export const SURFACES =
  'A dose × time surface isn’t one curve — show it in a Dose & Time response plot (or fit curves over one axis)'
/** An ANOVA upstream: by its Compare's analysis when known (before it has run, too), else by its
 *  result (its rows carry their F-tests). */
export const anova = (u: UpstreamFacts): boolean =>
  u.analysis != null
    ? u.analysis === 'anova'
    : u.result?.kind === 'compare' && someNested(u.result.cmp, 'ftest', 'F', (on) => on)
export const NO_GROUP_MEANS =
  'An ANOVA has no two-group means to plot — show its results in a volcano, heatmap or table'
/** The factors plots read an ANOVA's model (its terms, per-gene shares and cell means). */
export const needsAnova = (u: UpstreamFacts): string | null => {
  const known = u.analysis != null || u.result?.kind === 'compare'
  if (known && !anova(u) && !(u.result?.kind === 'compare' && u.result.cmp.anova))
    return 'Needs an ANOVA — set the Compare’s analysis to ANOVA'
  if (u.result?.kind === 'compare' && !u.result.cmp.anova && anova(u))
    return 'Re-run the Compare — its ANOVA ran before this plot existed'
  return null
}
