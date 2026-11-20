/** The gene mask's identity (a leaf module, shared by the project file, its upgrades and the
 *  store). */
import { type GraphState } from './store'
import type { GeneSet } from './types'

/** Identifies the gene mask — the genes of every HIDDEN geneset — so a workflow can tell whether
 *  its results were classified under the project's current one. '' = nothing masked. */
export function geneMaskKey(sets: GeneSet[]): string {
  const ids = new Set<string>()
  for (const g of sets) if (g.hidden) for (const gene of g.genes) ids.add(gene.id)
  if (ids.size === 0) return ''
  // FNV-1a over the sorted ids: short enough to save per workflow.
  let h = 0x811c9dc5
  for (const ch of [...ids].sort().join('\n')) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193)
  }
  return `${ids.size}:${(h >>> 0).toString(36)}`
}
/** Union of every HIDDEN geneset's gene uniqIDs — the project-wide significance mask. */
export const hiddenGeneIds = (s: GraphState): Set<string> => {
  const ids = new Set<string>()
  for (const g of s.geneSets) if (g.hidden) for (const gene of g.genes) ids.add(gene.id)
  return ids
}
/** Force the masked genes non-significant on a result's rows (leaves everything else untouched). */
export function maskSignf<T extends { uniqID: string; signf: boolean; effect: string }>(
  rows: T[],
  hidden: Set<string>
): T[] {
  if (hidden.size === 0) return rows
  return rows.map((r) => (hidden.has(r.uniqID) ? { ...r, signf: false, effect: 'none' } : r)) as T[]
}
