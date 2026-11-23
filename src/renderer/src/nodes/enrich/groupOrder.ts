/** Every term group an annotation source has in the data, in a fixed order — what an enrichment
 *  plot's group colours are read from, so a group (a KEGG pathway category, a GO aspect, a COG
 *  area) is the same colour in every enrichment plot of the dataset: whatever comparison, facet,
 *  method or style, and whichever groups that plot happens to show. Before, the colours went by
 *  the order groups first appeared in each plot, so the same category changed colour between
 *  plots (and between a tile's conditions).
 *
 *  The order is the source's groups over the whole dataset (every gene's annotation, not just the
 *  enriched terms), alphabetical. Each source has its own: GO's first group and KEGG's first share
 *  a colour, which is fine — they're never in one plot. */
import { enrichTermGroups, type EnrichSource } from '../../engine'

// Derived once per annotation (and, for KEGG, its category map): walking every gene's terms is
// too slow to repeat on each render.
const byAnn = new WeakMap<object, Map<EnrichSource, string[]>>()

export function groupOrderOf(
  source: EnrichSource,
  ann: Record<string, Record<string, string>>,
  categories: Record<string, string>
): string[] {
  // KEGG's groups come from the category map, the others' from the annotation
  const key: object = source === 'kegg' ? categories : ann
  let bySource = byAnn.get(key)
  if (!bySource) byAnn.set(key, (bySource = new Map()))
  let order = bySource.get(source)
  if (!order) {
    const groups = enrichTermGroups(source, ann, categories) ?? {}
    order = [...new Set(Object.values(groups))].sort((a, b) => a.localeCompare(b))
    bySource.set(source, order)
  }
  return order
}

/** A group's colour index: its place in the source's order. A group the order doesn't have (data
 *  newer than the order, never expected) goes after every known one, in the plot's own order. */
export function groupIndexer(order: readonly string[]): (group: string, local: number) => number {
  const at = new Map(order.map((g, i) => [g, i]))
  return (group, local) => at.get(group) ?? order.length + local
}
