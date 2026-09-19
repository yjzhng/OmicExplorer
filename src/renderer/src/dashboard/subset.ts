import type { NodeKind } from '../graph/types'

/** Plot kinds that offer an "all genes ↔ selected genes only" toggle. These draw all genes and
 *  merely emphasise the selected ones, so a subset-only view is meaningful. Volcano/MA/heatmap
 *  always show all genes (with the selection highlighted) — no subset toggle. Plots that are
 *  inherently per-selected-gene (geneBar, tdr) or ignore the selection (scatter, pca) are
 *  excluded too. */
export const SUBSET_TOGGLE_KINDS = new Set<NodeKind>(['dr', 'bubble', 'dumbbell'])
