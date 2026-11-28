/** The order a new plot tile's plots are added in (so laid out in on the results page) — set per
 *  step in Settings › Plot defaults, else the plot menu's. Pure. */
import { entryKey, type PlotMenuEntry } from '../registry'

/** Every key of `all` in the stored order: the stored ones it has first, as stored, then the rest
 *  as they come (a plot added to the app since the order was set). */
export function orderedKeys(all: string[], stored: string[] | undefined): string[] {
  if (!stored) return all
  const have = new Set(all)
  const kept = stored.filter((k) => have.has(k))
  const placed = new Set(kept)
  return [...kept, ...all.filter((k) => !placed.has(k))]
}

/** `entries` in the stored order. An entry the order doesn't name — a Response plot over a
 *  condition of your own, say — goes where its kind's first entry is (beside its Dose and Time
 *  response), else after the rest; ties keep the given order. */
export function inPlotOrder(
  entries: PlotMenuEntry[],
  stored: string[] | undefined
): PlotMenuEntry[] {
  if (!stored?.length) return entries
  const rank = new Map(stored.map((k, i) => [k, i]))
  const kindRank = new Map<string, number>()
  stored.forEach((k, i) => {
    const kind = k.split(':')[0]
    if (!kindRank.has(kind)) kindRank.set(kind, i + 0.5)
  })
  const at = (e: PlotMenuEntry): number =>
    rank.get(entryKey(e)) ?? kindRank.get(e.kind) ?? stored.length
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => at(a.e) - at(b.e) || a.i - b.i)
    .map(({ e }) => e)
}
