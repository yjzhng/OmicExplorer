/** The gene mask's identity (a leaf module, shared by the project file, its upgrades and the
 *  store). */
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
