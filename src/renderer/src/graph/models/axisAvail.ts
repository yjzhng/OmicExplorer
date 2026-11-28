import {
  contextOf,
  customSlug,
  distinctOf,
  isCustomCond,
  type ContextRow,
  ConditionKey
} from '../../engine'
import { NodeResult, numericOfResult } from '../types'

/** The numeric conditions assumed where the data isn't known (no upstream, Settings' defaults). */
export const DEFAULT_AXES: ConditionKey[] = ['dose', 'time']
/** Which numeric conditions the upstream data actually carries, in the schema's order (dose, time,
 *  then the declared custom ones) — the Response plots are offered one per condition and one per
 *  pair of them. */
export type AxisAvail = ConditionKey[]
/** Derive it from the plot's upstream result: a Standardize's `activeConditions` is authoritative;
 *  Compare/Contrast are read from their rows. Unknown upstream (not yet run) ⇒ dose and time, so we
 *  never hide an option we can't rule out. */
export function axisAvailFromResult(r: NodeResult | undefined): AxisAvail {
  if (!r) return DEFAULT_AXES
  const hit = availByResult.get(r)
  if (hit) return [...hit]
  const avail = scanAxisAvail(r)
  availByResult.set(r, avail)
  return [...avail]
}
/** A result's response axes, scanned once: a result is never changed once made (a re-run makes a
 *  new one), and the scan walks every row — on a million-row Contrast, ~0.4 s. It runs inside
 *  store selectors (useUpstreamFacts), which re-run on every store change, once per tile asking. */
export const availByResult = new WeakMap<NodeResult, AxisAvail>()
/** A Compare's or a Contrast's context tuples (one per distinct condition context), else null. */
export const contextRowsOf = (r: NodeResult): readonly ContextRow[] | null =>
  r.kind === 'compare'
    ? contextOf(r.cmp).rows
    : r.kind === 'contrast'
      ? contextOf(r.ctr).rows
      : null
export function scanAxisAvail(r: NodeResult): AxisAvail {
  const numeric = numericOfResult(r)
  if (r.kind === 'standardize') {
    const ac = r.std.activeConditions ?? []
    return [...numeric].filter((c) => ac.includes(c))
  }
  const h = holderOf(r)
  if (!h) return DEFAULT_AXES
  return [...numeric].filter((c) => levelsOf(h, c, 1).size > 0)
}

/** A Compare's or a Contrast's rows' holder, else null. */
const holderOf = (r: NodeResult): { rows: readonly object[] } | null =>
  r.kind === 'compare' ? r.cmp : r.kind === 'contrast' ? r.ctr : null

/** The numeric levels a condition takes over a result's rows (ctxNum's reading: null, '' or not
 *  a finite number is none), up to `enough` of them — off the column's distinct values (distinctOf,
 *  cached per table), not the context index: the canvas asks this of every result as a project
 *  opens, and indexing a million-row Contrast's contexts is most of a second. */
function levelsOf(h: { rows: readonly object[] }, c: ConditionKey, enough: number): Set<number> {
  const out = new Set<number>()
  const add = (v: unknown): void => {
    if (v == null || v === '') return
    const n = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(n)) out.add(n)
  }
  if (isCustomCond(c)) {
    const slug = customSlug(c)
    for (const e of distinctOf(h, 'extra')) {
      add((e as Record<string, unknown> | null | undefined)?.[slug])
      if (out.size >= enough) break
    }
  } else
    for (const v of distinctOf(h, c)) {
      add(v)
      if (out.size >= enough) break
    }
  return out
}
/**
 * The numeric conditions this result actually varies over: at least TWO distinct levels.
 *
 * A single-dose experiment (one concentration plus its vehicle, say) has `dose` as a condition but
 * no dose *series*, so a dose–response curve or a bubble plot over it has nothing to show — one
 * point per gene, and a category axis with a single level. Kept apart from `axisAvailFromResult`,
 * which answers the different question of which conditions are present at all (plots read it to
 * label and facet, and a one-level condition still belongs there).
 *
 * Unknown when the rows aren't in hand (not run yet, or a kind without per-level rows): every
 * available axis is returned, so a plot is never blocked on a guess.
 */
export const multiByResult = new WeakMap<NodeResult, AxisAvail>()
export function multiLevelAxes(r: NodeResult | undefined): AxisAvail {
  if (!r) return DEFAULT_AXES
  const hit = multiByResult.get(r)
  if (hit) return [...hit]
  const h = holderOf(r)
  const avail = axisAvailFromResult(r)
  const found = !h ? avail : avail.filter((c) => levelsOf(h, c, 2).size > 1)
  multiByResult.set(r, found)
  return [...found]
}
