import type { NodeKind } from '../graph/types'

/** Plot kinds that draw all genes and merely highlight the GOI (focus) genes — so an
 *  "all genes ↔ GOI subset only" toggle is meaningful. Plots that are inherently GOI-only
 *  (geneBar, tdr) or ignore focus (scatter, pca) are excluded. */
export const GOI_TOGGLE_KINDS = new Set<NodeKind>([
  'volcano',
  'ma',
  'dr',
  'bubble',
  'dumbbell',
  'heatmap'
])
