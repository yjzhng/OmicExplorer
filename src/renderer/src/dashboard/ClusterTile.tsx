/** Cluster (embedding) panel body: draws a sample embedding its plot's run computed (in the
 *  worker — see graph/plotRun.ts), so a large dataset's PCA / UMAP / t-SNE never runs on the UI
 *  thread. Colouring by a condition regroups the stored points here; colouring by cluster uses the
 *  groups the run computed (a different clustering is another run — the tile's staleOn). */
import { useMemo } from 'react'

import type { ClusterStyle } from '../graph/types'
import type { PlanOverrides } from '../ui/clusterPlan'

import {
  CLUSTER_COLOR,
  metaValue,
  type ClusterColorBy,
  type ClusterData,
  type ConditionKey,
  type NumericConds
} from '../engine'
import { ClusterView } from '../ui/ClusterView'
import { LoadingView } from '../ui/LoadingView'
import { ScreeView } from '../ui/ScreeView'

export function ClusterTile({
  cluster,
  colorBy,
  display,
  territory,
  plot,
  loadings,
  legend = 'simple',
  axisMode,
  look,
  schemeColor,
  schemeShade,
  schemeArrow,
  categorical,
  condTitle,
  numeric
}: {
  /** the dataset's numeric conditions (its schema; see ClusterView) */
  numeric: NumericConds
  /** a condition's legend heading, with its unit (see ClusterView) */
  condTitle?: (c: ConditionKey) => string
  /** the run's embedding */
  cluster: ClusterData
  colorBy: ClusterColorBy
  display: 'replicate' | 'centroid'
  territory?: 'hull' | 'gaussian' | 'none'
  /** which plot to draw: the embedding scatter, the feature loadings, or variance explained
   *  per component (the last two are PCA-only) */
  plot?: 'pc' | 'scree' | 'loadings'
  /** loadings plot only: how many features to show (the run keeps the most there can be) */
  loadings?: number
  legend?: 'simple' | 'complex'
  /** the embedding's full axes, or a minimal corner L (see ClusterConfig) */
  axisMode?: 'standard' | 'minimal'
  /** markers' and arrow trails' look (see ClusterStyle) */
  look?: ClusterStyle
  /** complex legend: the user's colour / shade / arrow choices (unset = automatic) */
  schemeColor?: PlanOverrides['color']
  schemeShade?: PlanOverrides['shade']
  schemeArrow?: PlanOverrides['arrow']
  /** the categorical palette its groups cycle (the plot's own, else the global one) */
  categorical?: readonly string[]
}) {
  // One object per actual change, so the view's memo keyed on it doesn't rebuild every render.
  const scheme = useMemo(
    (): PlanOverrides => ({ color: schemeColor, shade: schemeShade, arrow: schemeArrow }),
    [schemeColor, schemeShade, schemeArrow]
  )
  // The stored embedding, grouped by the colouring on show: a condition's values read off each
  // point (as the run would have), or the run's own clusters.
  const shown = useMemo((): ClusterData => {
    if (colorBy === CLUSTER_COLOR) return cluster
    // (no clusterK: the colours aren't clusters)
    return {
      ...cluster,
      clusterK: undefined,
      colorBy,
      points: cluster.points.map((pt) => ({
        ...pt,
        group: String(metaValue(pt.meta, colorBy) ?? '')
      }))
    }
  }, [cluster, colorBy])
  const withLoadings = useMemo(
    (): ClusterData =>
      cluster.loadings
        ? { ...cluster, loadings: cluster.loadings.slice(0, loadings ?? 10) }
        : cluster,
    [cluster, loadings]
  )
  if (plot === 'scree') return <ScreeView cluster={cluster} />
  if (plot === 'loadings') return <LoadingView cluster={withLoadings} />
  return (
    <ClusterView
      cluster={shown}
      display={display}
      territory={territory}
      legend={legend}
      axisMode={axisMode}
      look={look}
      scheme={scheme}
      categorical={categorical}
      condTitle={condTitle}
      numeric={numeric}
    />
  )
}
