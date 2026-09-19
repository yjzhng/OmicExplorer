/** Cluster (embedding) panel body: embeds samples from a Standardize upstream. UMAP/t-SNE are
 *  iterative, so the embedding is memoized on the data + method + coloring; it recomputes only
 *  when those change. */
import { useMemo } from 'react'

import { buildCluster, type ClusterMethod, type StandardizeResult } from '../engine'
import { ClusterView } from '../ui/ClusterView'
import type { ConditionKey } from '../engine'

export function ClusterTile({
  std,
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
  std: StandardizeResult
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
      buildCluster(std.rows, { method, colorBy, scale, missing, center, topVar, transform, replicates }),
    [std, method, colorBy, scale, missing, center, topVar, transform, replicates]
  )
  return (
    <ClusterView cluster={cluster} display={display} legend={legend} />
  )
}
