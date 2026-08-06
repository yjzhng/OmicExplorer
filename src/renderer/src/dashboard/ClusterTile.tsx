/** Cluster (embedding) panel body. Embeds samples from a Standardize upstream, or the
 *  responsome (genes × conditions log2FC) from a Compare upstream — omicViz's
 *  pca_response. UMAP/t-SNE are iterative, so the embedding is memoized on the
 *  data + method + coloring; it recomputes only when those change. */
import { useMemo } from 'react'

import {
  buildCluster,
  buildResponseCluster,
  type ClusterMethod,
  type CompareResultRow,
  type StandardizeResult
} from '../engine'
import { ClusterView } from '../ui/ClusterView'
import type { ConditionKey } from '../engine'

const LABEL: Record<ClusterMethod, string> = { pca: 'PCA', umap: 'UMAP', tsne: 't-SNE' }

export function ClusterTile({
  std,
  cmp,
  method,
  colorBy,
  display
}: {
  std?: StandardizeResult
  cmp?: CompareResultRow[]
  method: ClusterMethod
  colorBy: ConditionKey
  display: 'replicate' | 'centroid'
}) {
  const cluster = useMemo(
    () =>
      std
        ? buildCluster(std.rows, { method, colorBy })
        : buildResponseCluster(cmp ?? [], { method, colorBy }),
    [std, cmp, method, colorBy]
  )
  const unit = std ? 'samples' : 'conditions'
  // Use the cluster's effective colorBy (the responsome path may override a degenerate
  // choice) so the title always matches the legend.
  return (
    <ClusterView
      cluster={cluster}
      display={display}
      title={`${LABEL[method]} — ${unit} colored by ${cluster.colorBy}`}
    />
  )
}
