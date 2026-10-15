/** log₂FC heatmap panel body. Gene clustering is O(n²) on the render thread, so the pivot +
 *  cluster is memoized on the comparison rows + display options (not every parent re-render). */
import { useMemo } from 'react'

import { buildFcHeatmap, type CompareResultRow, type LeafOrder } from '../engine'
import type { HeatmapLinkage } from '../graph/types'
import { FcHeatmapView, type ClusterSide } from '../ui/FcHeatmapView'
import type { PaletteRef } from '../ui/palettes'
import { CATEGORICAL } from '../ui/theme'

export function FcHeatmapTile({
  rows,
  displayMap,
  maxGenes,
  focus = [],
  orient,
  palette,
  linkage,
  leafOrder,
  geneMax = 0,
  geneModules = false,
  geneTree = false,
  geneColors = CATEGORICAL,
  condMax = 0,
  condModules = false,
  condTree = false,
  condColors = CATEGORICAL
}: {
  rows: CompareResultRow[]
  displayMap: Record<string, string>
  maxGenes: number
  /** selected genes (uniqIDs); when non-empty, show exactly these rows */
  focus?: string[]
  orient?: 'landscape' | 'portrait'
  /** the fold-change palette (the plot's own, else the global one) */
  palette?: PaletteRef
  /** clustering linkage and leaf order (see buildFcHeatmap) */
  linkage?: HeatmapLinkage
  leafOrder?: LeafOrder
  /** the genes' clustering look: the tree cut into at most `geneMax` clusters, a bar per cluster
   *  (modules), the tree, the bars' colours (see ClusterSide) */
  geneMax?: number
  geneModules?: boolean
  geneTree?: boolean
  geneColors?: readonly string[]
  /** …and the conditions' (comparison columns') */
  condMax?: number
  condModules?: boolean
  condTree?: boolean
  condColors?: readonly string[]
}) {
  const focusKey = focus.join(',')
  const data = useMemo(
    // Only genes differential (significant) in ≥1 comparison are shown — a focus pick overrides.
    () =>
      buildFcHeatmap(rows, {
        displayMap,
        maxGenes,
        focus,
        differentialOnly: true,
        linkage,
        leafOrder
      }),
    // focusKey stands in for the focus array's contents (stable across renders)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, displayMap, maxGenes, focusKey, linkage, leafOrder]
  )
  // Each side's look, kept while its settings hold (so the view's layout isn't redone per render).
  const geneSide = useMemo<ClusterSide>(
    () => ({ max: geneMax, modules: geneModules, tree: geneTree, colors: geneColors }),
    [geneMax, geneModules, geneTree, geneColors]
  )
  const condSide = useMemo<ClusterSide>(
    () => ({ max: condMax, modules: condModules, tree: condTree, colors: condColors }),
    [condMax, condModules, condTree, condColors]
  )
  const scope =
    focus.length > 0
      ? `${data.geneIds.length} selected genes`
      : maxGenes && maxGenes > 0
        ? `top ${Math.min(maxGenes, data.geneIds.length)} differential genes`
        : `${data.geneIds.length} differential genes`
  return (
    <FcHeatmapView
      data={data}
      title={`${scope}, clustered`}
      orient={orient}
      palette={palette}
      geneSide={geneSide}
      condSide={condSide}
    />
  )
}
