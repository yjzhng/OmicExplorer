/** Cluster (embedding) panel body: draws a sample embedding its plot's run computed (in the
 *  worker — see graph/run/plotRun.ts), so a large dataset's PCA / UMAP / t-SNE never runs on the UI
 *  thread. Colouring by a condition — or by the condition groups (every combination of the chosen
 *  conditions) — regroups the stored points here; colouring by cluster uses the groups the run
 *  computed (a different clustering is another run — the tile's staleOn). */
import { useMemo } from 'react'

import type { ClusterStyle } from '../../graph/config/cluster'
import type { PlanOverrides } from '../../ui/plot/clusterPlan'

import {
  CLUSTER_COLOR,
  condLabel,
  GROUP_COLOR,
  metaValue,
  type ClusterColorBy,
  type ClusterData,
  type ConditionKey,
  type NumericConds
} from '../../engine'
import { ClusterView } from './ClusterView'
import { LoadingView } from './LoadingView'
import { ScreeView } from './ScreeView'

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
  schemeAsGiven,
  categorical,
  condTitle,
  groupConds,
  numeric
}: {
  /** the dataset's numeric conditions (its schema; see ClusterView) */
  numeric: NumericConds
  /** a condition's legend heading, with its unit (see ClusterView) */
  condTitle?: (c: ConditionKey) => string
  /** coloured by the condition groups: the conditions combined (see clusterGroupConds) */
  groupConds?: ConditionKey[]
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
  /** complex legend: colour by `schemeColor` exactly as picked (see PlanOverrides.colorAsGiven) */
  schemeAsGiven?: boolean
  /** the categorical palette its groups cycle (the plot's own, else the global one) */
  categorical?: readonly string[]
}) {
  // One object per actual change, so the view's memo keyed on it doesn't rebuild every render.
  // (the colours keyed as one string: the view hands a fresh array each render)
  const colorKey = schemeColor?.join('\u0001')
  const scheme = useMemo(
    (): PlanOverrides => ({
      color: colorKey ? (colorKey.split('\u0001') as ConditionKey[]) : undefined,
      shade: schemeShade,
      arrow: schemeArrow,
      colorAsGiven: schemeAsGiven
    }),
    [colorKey, schemeShade, schemeArrow, schemeAsGiven]
  )
  // The stored embedding, grouped by the colouring on show: a condition's values read off each
  // point (as the run would have), or the run's own clusters.
  // The groups' conditions as one string: the view hands a fresh array each render, and the memo
  // below must rebuild only when they change.
  const groupKey = colorBy === GROUP_COLOR ? (groupConds ?? []).join('\u0001') : ''
  const shown = useMemo((): ClusterData => {
    if (colorBy === CLUSTER_COLOR) return cluster
    const conds = groupKey ? (groupKey.split('\u0001') as ConditionKey[]) : []
    // A point's group: its value of the condition — or, by the condition groups, its values of
    // each of their conditions ("A · 24"), the ones a sample doesn't carry left out.
    const groupOf = (pt: ClusterData['points'][number]): string =>
      colorBy === GROUP_COLOR
        ? conds
            .map((c) => metaValue(pt.meta, c))
            .filter((v) => v != null && v !== '')
            .join(' · ')
        : String(metaValue(pt.meta, colorBy) ?? '')
    // (no clusterK: the colours aren't clusters)
    return {
      ...cluster,
      clusterK: undefined,
      colorBy,
      points: cluster.points.map((pt) => ({ ...pt, group: groupOf(pt) }))
    }
  }, [cluster, colorBy, groupKey])
  // the condition groups' legend heading: their conditions, "cmpd × time"
  const colorTitle =
    colorBy === GROUP_COLOR
      ? (groupConds ?? []).map((c) => (condTitle ?? condLabel)(c)).join(' × ')
      : undefined
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
      colorTitle={colorTitle}
      numeric={numeric}
    />
  )
}
