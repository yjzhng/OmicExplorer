/** A bubble size key's levels (the bubble plot's; shaped as the enrichment plot's dot key). */

/**
 * The key's levels, as the enrichment plot's dot key picks them: ¼ and ¾ of the largest value,
 * rounded OUTWARD — the upper up, the lower down (never below one step) — to whole numbers, or to
 * halves where whole numbers would merge the two or lift the upper past the largest (no bubble
 * could match it). One level when even halves can't make two: the largest half at or under the
 * largest, else the largest itself.
 */
export function sizeKeyLevels(max: number): number[] {
  const q1 = max * 0.25
  const q3 = max * 0.75
  const upTo = (v: number, st: number): number => Math.max(st, Math.ceil(v / st) * st)
  const downTo = (v: number, st: number): number => Math.max(st, Math.floor(v / st) * st)
  for (const st of [1, 0.5]) {
    const hi = upTo(q3, st)
    const lo = downTo(q1, st)
    if (hi !== lo && hi <= max) return [lo, hi]
  }
  const half = Math.floor(max * 2) / 2
  return [half > 0 ? half : max]
}
