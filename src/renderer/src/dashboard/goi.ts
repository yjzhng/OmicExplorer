import type { NodeKind } from '../graph/types'

/** Plot kinds that offer an "all genes ↔ GOI subset only" toggle. These draw all genes and
 *  merely highlight the GOI (focus) genes, and a subset-only view is meaningful. Volcano/MA/
 *  heatmap always show all genes (with GOI highlighted) — no subset toggle. Plots that are
 *  inherently GOI-only (geneBar, tdr) or ignore focus (scatter, pca) are excluded too. */
export const GOI_TOGGLE_KINDS = new Set<NodeKind>(['dr', 'bubble', 'dumbbell'])
