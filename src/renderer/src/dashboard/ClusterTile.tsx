/** Cluster (embedding) panel body: embeds samples from a Standardize upstream. UMAP/t-SNE are
 *  iterative, so the embedding is memoized on the data + method + coloring; it recomputes only
 *  when those change. */
import { useMemo } from 'react'

import { buildCluster, type ClusterMethod, type StandardizeResult } from '../engine'
import { ClusterView } from '../ui/ClusterView'
import { LoadingView } from '../ui/LoadingView'
import { ScreeView } from '../ui/ScreeView'
import type { ClusterColorBy } from '../engine'

export function ClusterTile({
  std,
  method,
  colorBy,
  clusterOn,
  clusterCount,
  clusterK,
  scale,
  missing,
  center,
  topVar,
  transform,
  replicates,
  display,
  territory,
  plot,
  loadings,
  legend = 'simple'
}: {
  std: StandardizeResult
  method: ClusterMethod
  colorBy: ClusterColorBy
  clusterOn?: 'coords' | 'features'
  clusterCount?: 'fixed' | 'conditions' | 'auto'
  clusterK?: number
  scale?: 'unit' | 'none'
  missing?: 'impute' | 'complete'
  center?: 'median' | 'zscore' | 'quantile' | 'none'
  topVar?: number
  transform?: 'auto' | 'log2' | 'log10' | 'none'
  replicates?: 'individual' | 'mean'
  display: 'replicate' | 'centroid'
  territory?: 'hull' | 'gaussian' | 'none'
  /** which plot to draw: the embedding scatter, the feature loadings, or variance explained
   *  per component (the last two are PCA-only) */
  plot?: 'pc' | 'scree' | 'loadings'
  /** loadings plot only: how many features to show */
  loadings?: number
  legend?: 'simple' | 'complex'
}) {
  const cluster = useMemo(
    () =>
      buildCluster(std.rows, {
        method,
        colorBy,
        clusterOn,
        clusterCount,
        clusterK,
        // Only the loadings plot needs them, and computing them costs a pass over every feature.
        loadings: plot === 'loadings' ? (loadings ?? 10) : 0,
        // So the vectors are labelled with the gene/protein NAME rather than the raw uniqID.
        displayMap: std.displayMap,
        scale,
        missing,
        center,
        topVar,
        transform,
        replicates
      }),
    [
      std,
      method,
      colorBy,
      clusterOn,
      clusterCount,
      clusterK,
      plot,
      loadings,
      scale,
      missing,
      center,
      topVar,
      transform,
      replicates
    ]
  )
  if (plot === 'scree') return <ScreeView cluster={cluster} />
  if (plot === 'loadings') return <LoadingView cluster={cluster} />
  return <ClusterView cluster={cluster} display={display} territory={territory} legend={legend} />
}
