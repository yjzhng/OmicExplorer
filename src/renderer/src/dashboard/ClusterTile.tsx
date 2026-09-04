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

export function ClusterTile({
  std,
  cmp,
  method,
  colorBy,
  scale,
  missing,
  center,
  topVar,
  transform,
  replicates,
  display,
  legend = 'simple'
}: {
  std?: StandardizeResult
  cmp?: CompareResultRow[]
  method: ClusterMethod
  colorBy: ConditionKey
  scale?: 'unit' | 'none'
  missing?: 'impute' | 'complete'
  center?: 'median' | 'zscore' | 'quantile' | 'none'
  topVar?: number
  transform?: 'auto' | 'log2' | 'log10' | 'none'
  replicates?: 'individual' | 'mean'
  display: 'replicate' | 'centroid'
  legend?: 'simple' | 'complex'
}) {
  const cluster = useMemo(
    () =>
      std
        ? buildCluster(std.rows, { method, colorBy, scale, missing, center, topVar, transform, replicates })
        : buildResponseCluster(cmp ?? [], { method, colorBy, scale, missing, center, topVar, transform }),
    [std, cmp, method, colorBy, scale, missing, center, topVar, transform, replicates]
  )
  return (
    <ClusterView cluster={cluster} display={display} legend={legend} />
  )
}
