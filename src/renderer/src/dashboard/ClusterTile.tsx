/** Cluster (embedding) panel body: embeds samples from a Standardize upstream. UMAP/t-SNE are
 *  iterative, so the embedding is memoized on the data + method + coloring; it recomputes only
 *  when those change. */
import { useMemo } from 'react'

import type { ClusterStyle } from '../graph/types'
import type { PlanOverrides } from '../ui/clusterPlan'

import {
  buildCluster,
  type ClusterMethod,
  type StandardizeResult,
  type ValueScale
} from '../engine'
import { ClusterView } from '../ui/ClusterView'
import { LoadingView } from '../ui/LoadingView'
import { ScreeView } from '../ui/ScreeView'
import type { ClusterColorBy } from '../engine'

export function ClusterTile({
  std,
  autoScale,
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
  legend = 'simple',
  look,
  schemeColor,
  schemeShade,
  schemeArrow
}: {
  std: StandardizeResult
  /** what the 'auto' transform follows: the scale the plots show Clean data on (plotScaleOf) */
  autoScale?: ValueScale
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
  /** markers' and arrow trails' look (see ClusterStyle) */
  look?: ClusterStyle
  /** complex legend: the user's colour / shade / arrow choices (unset = automatic) */
  schemeColor?: PlanOverrides['color']
  schemeShade?: PlanOverrides['shade']
  schemeArrow?: PlanOverrides['arrow']
}) {
  // One object per actual change, so the view's memo keyed on it doesn't rebuild every render.
  const scheme = useMemo(
    (): PlanOverrides => ({ color: schemeColor, shade: schemeShade, arrow: schemeArrow }),
    [schemeColor, schemeShade, schemeArrow]
  )
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
        autoScale,
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
      autoScale,
      replicates
    ]
  )
  if (plot === 'scree') return <ScreeView cluster={cluster} />
  if (plot === 'loadings') return <LoadingView cluster={cluster} />
  return (
    <ClusterView
      cluster={cluster}
      display={display}
      territory={territory}
      legend={legend}
      look={look}
      scheme={scheme}
    />
  )
}
