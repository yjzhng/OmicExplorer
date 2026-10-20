/** A result's large row tables kept columnar (engine/lazyRows.ts): its Clean data table, its
 *  Compare's or its Contrast's rows. Their rows are then built when read and let go when nothing
 *  holds them; the result object and every field on it stay as they were. */
import { compactRows } from '../engine/lazyRows'
import type { NodeResult } from './types'

/** The objects of a result holding a `rows` table. */
function holders(r: NodeResult): Record<string, unknown>[] {
  if (r.kind === 'standardize') return [r.std as unknown as Record<string, unknown>]
  if (r.kind === 'compare') return [r.cmp as unknown as Record<string, unknown>]
  if (r.kind === 'contrast') return [r.ctr as unknown as Record<string, unknown>]
  return []
}

/** Compact one result's tables of at least `minRows` rows. `keep`: hand out the existing rows array
 *  until it's released (something on screen may hold it). */
export function compactResult(
  r: NodeResult | undefined,
  opts: { keep?: boolean; minRows?: number } = {}
): void {
  if (!r) return
  for (const h of holders(r)) {
    const rows = Object.getOwnPropertyDescriptor(h, 'rows')
    if (!rows || !('value' in rows) || !Array.isArray(rows.value)) continue
    if (rows.value.length < (opts.minRows ?? 0)) continue
    compactRows(h, opts.keep)
  }
}

/** Compact every result of a map (fresh from a file or the undo history: nothing holds them yet),
 *  in place; returns the map. */
export function compactResults(results: Record<string, NodeResult>): Record<string, NodeResult> {
  for (const r of Object.values(results)) compactResult(r)
  return results
}
