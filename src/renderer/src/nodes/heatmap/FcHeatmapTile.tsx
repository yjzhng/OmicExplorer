/** log₂FC heatmap panel body. Clustering the genes is O(n²) — seconds for thousands of them — so
 *  it runs in the UI worker lane (engineUi), off the UI thread: the tile pivots the comparison,
 *  hands each clustering out, and draws when they're back, keeping the previous heatmap up
 *  meanwhile. The result is cached on the comparison rows + display options (not every parent
 *  re-render, nor every mount). */
import { useEffect, useMemo, useState } from 'react'

import {
  buildFcHeatmapSteps,
  clusterRowTree,
  type CompareResultRow,
  type FcHeatmapData,
  type LeafOrder,
  type NumericConds
} from '../../engine'
import { engineUi } from '../../engine/client'
import { topSplitOf, type HeatmapLinkage } from '../../graph/types'
import type { TopSplit } from '../../engine'
import { FcHeatmapView, type ClusterSide } from './FcHeatmapView'
import type { PaletteRef } from '../../ui/palettes'
import { Spinner } from '../../ui/Spinner'
import { CATEGORICAL } from '../../ui/theme'
import { useRolePalette } from '../../ui/useAppSettings'

/** Built heatmaps by rows, display map and options key, app-wide: a remount (a tab, facet or
 *  show switch back) shows the heatmap at once rather than clustering again. */
const built = new WeakMap<
  readonly CompareResultRow[],
  WeakMap<Record<string, string>, Map<string, FcHeatmapData>>
>()

function cacheFor(
  rows: readonly CompareResultRow[],
  displayMap: Record<string, string>
): Map<string, FcHeatmapData> {
  let byMap = built.get(rows)
  if (!byMap) built.set(rows, (byMap = new WeakMap()))
  let m = byMap.get(displayMap)
  if (!m) byMap.set(displayMap, (m = new Map()))
  return m
}

export function FcHeatmapTile({
  rows,
  displayMap,
  maxGenes,
  topSplit,
  topUp,
  topDown,
  focus = [],
  orient,
  palette,
  linkage,
  leafOrder,
  colPattern = false,
  geneMax = 0,
  geneModules = false,
  geneTree = false,
  geneColors = CATEGORICAL,
  condMax = 0,
  condModules = false,
  condTree = false,
  condColors = CATEGORICAL,
  unsigned = false,
  condBar = false,
  numeric
}: {
  rows: CompareResultRow[]
  /** the rows are a two-way ANOVA's terms (unsigned effect sizes; see FcHeatmapView) */
  unsigned?: boolean
  displayMap: Record<string, string>
  maxGenes: number
  /** how the top-N splits between up and down (TopSplitConfig) */
  topSplit?: TopSplit
  topUp?: number
  topDown?: number
  /** selected genes (uniqIDs); when non-empty, show exactly these rows */
  focus?: string[]
  orient?: 'landscape' | 'portrait'
  /** the fold-change palette (the plot's own, else the global one) */
  palette?: PaletteRef
  /** clustering linkage and leaf order (see buildFcHeatmap) */
  linkage?: HeatmapLinkage
  leafOrder?: LeafOrder
  /** cluster the comparison columns on the pattern of their changes alone (see buildFcHeatmap) */
  colPattern?: boolean
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
  /** the condition tracks along the comparison columns */
  condBar?: boolean
  /** the dataset's numeric conditions: their tracks run along a level palette */
  numeric?: NumericConds
}) {
  // The tracks' level palettes: the dose and time roles' global ones, as Clean data's heatmap.
  const dosePalette = useRolePalette('dose')
  const timePalette = useRolePalette('time')
  const levels = useMemo(
    () => (numeric ? { dose: dosePalette, time: timePalette, numeric } : undefined),
    [dosePalette, timePalette, numeric]
  )
  const focusKey = focus.join(',')
  const key = `${maxGenes}\u0000${topSplit ?? ''}:${topUp ?? ''}:${topDown ?? ''}\u0000${focusKey}\u0000${linkage ?? ''}\u0000${leafOrder ?? ''}\u0000${colPattern}`
  const cached = cacheFor(rows, displayMap).get(key)
  // the last one built here — shown, while a new one clusters, until it's in
  const [last, setLast] = useState<FcHeatmapData | null>(null)
  // a cached one counts as shown (so it stays up while a later change clusters)
  if (cached && cached !== last) setLast(cached)
  useEffect(() => {
    const cache = cacheFor(rows, displayMap)
    if (cache.get(key)) return
    let live = true
    // Only genes differential (significant) in ≥1 comparison are shown — a focus pick overrides.
    const gen = buildFcHeatmapSteps(rows, {
      displayMap,
      maxGenes,
      split: topSplitOf({ topSplit, topUp, topDown }),
      focus,
      differentialOnly: true,
      linkage,
      leafOrder,
      colPattern
    })
    const step = (r: ReturnType<typeof gen.next>): void => {
      if (r.done) {
        // kept even when no longer shown here — it's this key's heatmap all the same
        cache.set(key, r.value)
        if (live) setLast(r.value)
        return
      }
      if (!live) return
      const { rows: m, opts } = r.value
      engineUi.clusterRowTree(m, opts).then(
        (tree) => step(gen.next(tree)),
        // the worker lane failed: cluster here rather than show nothing
        () => live && step(gen.next(clusterRowTree(m, opts)))
      )
    }
    step(gen.next())
    return () => {
      live = false
    }
    // key stands in for maxGenes, the split, focus's contents, linkage, leafOrder and colPattern
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, displayMap, key])
  // Each side's look, kept while its settings hold (so the view's layout isn't redone per render).
  const geneSide = useMemo<ClusterSide>(
    () => ({ max: geneMax, modules: geneModules, tree: geneTree, colors: geneColors }),
    [geneMax, geneModules, geneTree, geneColors]
  )
  const condSide = useMemo<ClusterSide>(
    () => ({ max: condMax, modules: condModules, tree: condTree, colors: condColors }),
    [condMax, condModules, condTree, condColors]
  )
  const data = cached ?? last
  if (!data) return <Spinner />
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
      unsigned={unsigned}
      condBar={condBar}
      levels={levels}
    />
  )
}
