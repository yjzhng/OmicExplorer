/**
 * The top-N gene pick every capped plot shares (bubble, response curves, dumbbell, fold-change
 * heatmap): candidates with a signed score each — its sign the direction (≥ 0 counts as up), its
 * size the rank — cut to N in one of three ways:
 *
 * - `size`: the N largest |score|, whichever direction.
 * - `proportional` (default): N split between up and down in proportion to how many candidates
 *   each side has (70 up, 30 down → 7:3), each side kept at least a quarter of the picks while it
 *   has them; a side that runs out hands its unused slots to the other.
 * - `fixed`: a declared count per side — up to `up` up and `down` down, no hand-off. N, when given,
 *   still caps the total (the largest kept).
 *
 * Within a side, largest |score| first; the result is ordered by |score|.
 */
export type TopSplit = 'size' | 'proportional' | 'fixed'
export interface TopSplitSpec {
  by: TopSplit
  /** fixed: how many up / down */
  up?: number
  down?: number
}
export interface TopCand {
  id: string
  signed: number
}

/** The smallest share of the picks either direction keeps under `proportional`. */
const MIN_SIDE_SHARE = 1 / 4
const byMag = (a: TopCand, b: TopCand): number => Math.abs(b.signed) - Math.abs(a.signed)

export function pickTop(
  cands: readonly TopCand[],
  n: number,
  split: TopSplitSpec = { by: 'proportional' }
): string[] {
  const ids = (cs: TopCand[]): string[] => cs.sort(byMag).map((c) => c.id)
  if (split.by === 'fixed') {
    const up = cands.filter((c) => c.signed >= 0).sort(byMag)
    const down = cands.filter((c) => c.signed < 0).sort(byMag)
    const both = ids([
      ...up.slice(0, Math.max(0, split.up ?? 0)),
      ...down.slice(0, Math.max(0, split.down ?? 0))
    ])
    return n > 0 ? both.slice(0, n) : both
  }
  if (n >= cands.length) return ids([...cands])
  if (split.by === 'size') return ids([...cands]).slice(0, n)
  return pickProportional(cands, n)
}

function pickProportional(cands: readonly TopCand[], n: number): string[] {
  const up = cands.filter((c) => c.signed >= 0).sort(byMag)
  const down = cands.filter((c) => c.signed < 0).sort(byMag)
  let nUp = Math.round((n * up.length) / cands.length)
  // Each side keeps at least a quarter of the picks (when it has that many), so a lopsided ratio
  // can't round the smaller side down to nothing. (A single pick can't be shared: it goes by
  // proportion alone.)
  const floor = n >= 2 ? Math.ceil(n * MIN_SIDE_SHARE) : 0
  if (up.length) nUp = Math.max(nUp, Math.min(floor, up.length))
  if (down.length) nUp = Math.min(nUp, n - Math.min(floor, down.length))
  let nDown = n - nUp
  if (nUp > up.length) [nUp, nDown] = [up.length, n - up.length]
  if (nDown > down.length) [nUp, nDown] = [n - down.length, down.length]
  return [...up.slice(0, nUp), ...down.slice(0, nDown)].sort(byMag).map((c) => c.id)
}
