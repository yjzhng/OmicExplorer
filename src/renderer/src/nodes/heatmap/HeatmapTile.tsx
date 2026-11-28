/** Heatmap panel body. Clustering gene rows (average-linkage) is O(n²) in time and memory — a
 *  full proteome's is seconds and a few hundred MB — so the plot's run does it (heatmap/run.ts)
 *  and the tile only pivots the data and orders it by the run's groups. Where there are none (a
 *  gene pick, a result from before the run clustered) it clusters here, in the UI worker lane
 *  (engineUi), off the UI thread, and draws when it's back, keeping the previous heatmap up
 *  meanwhile. It rebuilds only when the
 *  standardized result (or the scale it's presented on) or the focus genes change, not on every
 *  parent re-render. `std` comes already on the scale Clean data's log-transform setting picks
 *  (presentStd), so it's drawn as given. */
import { useEffect, useState } from 'react'
import type { PaletteRef } from '../../ui/color/palettes'

import {
  quantityLabel,
  valueUnitOf,
  buildHeatmapSteps,
  clusterRowGroups,
  numericOf,
  sampleIndex,
  type HeatmapData,
  type SampleOrder,
  type StandardizeResult,
  type ValueScale
} from '../../engine'
import { engineUi } from '../../engine/client'
import { groupsAt } from '../../engine/plot/heatmapGroups'
import { Spinner } from '../../ui/controls/Spinner'
import { HeatmapView } from './HeatmapView'

/** Built heatmaps by result and options key, app-wide: a remount (Results opened again, a tab,
 *  facet or orientation switch back) shows the heatmap at once rather than pivoting and
 *  clustering again. `std` is presentStd's cached copy, so it's the same object each time. */
const built = new WeakMap<StandardizeResult, Map<string, HeatmapData>>()

function cacheFor(std: StandardizeResult): Map<string, HeatmapData> {
  let m = built.get(std)
  if (!m) built.set(std, (m = new Map()))
  return m
}

export function HeatmapTile({
  std,
  scale,
  focus = [],
  orient,
  condBar,
  palette,
  sampleOrder = 'natural',
  plainScale,
  runGroups
}: {
  /** its values shown plain on a log colour scale (ui/plot/quantityAxis): `scale`, when they are */
  plainScale?: ValueScale
  /** on its presented scale (see presentStd) */
  std: StandardizeResult
  /** that scale — for the labels */
  scale: ValueScale
  /** selected genes (uniqIDs); when non-empty, show exactly these rows */
  focus?: string[]
  /** landscape = genes across x; portrait (default) = genes down y */
  orient?: 'landscape' | 'portrait'
  /** show the condition bar (default on) */
  condBar?: boolean
  /** the value palette (the plot's own, else viridis) */
  palette?: PaletteRef
  /** the sample columns' order (default natural) */
  sampleOrder?: SampleOrder
  /** the plot's run's cluster groups of all `n` gene rows, each as its genes (heatmap/run.ts),
   *  used in place of clustering here — not for a gene pick, which clusters just those genes */
  runGroups?: { n: number; groups: string[][] }
}) {
  const focusKey = focus.join(',')
  const key = `${sampleOrder}\u0000${focusKey}`
  const cached = cacheFor(std).get(key)
  // the last one built here — shown, while a new one clusters, until it's in
  const [last, setLast] = useState<HeatmapData | null>(null)
  // a cached one counts as shown (so it stays up while a later change clusters)
  if (cached && cached !== last) setLast(cached)
  useEffect(() => {
    const cache = cacheFor(std)
    if (cache.get(key)) return
    let live = true
    // off the result's shared sample index (sampleIndex): rows read as ids, no row built
    const gen = buildHeatmapSteps(sampleIndex(std), {
      displayMap: std.displayMap,
      log10: false,
      focus,
      order: { by: sampleOrder, samples: std.samples }
    })
    const step = (r: ReturnType<typeof gen.next>): void => {
      if (r.done) {
        // kept even when no longer shown here — it's this key's heatmap all the same
        cache.set(key, r.value)
        if (live) setLast(r.value)
        return
      }
      if (!live) return
      const { matrix, k, genes } = r.value
      // the run clustered these rows: its groups, as these rows' positions
      const fromRun = focus.length === 0 ? groupsAt(runGroups, genes) : null
      if (fromRun) return step(gen.next(fromRun))
      engineUi.clusterRowGroups(matrix, k).then(
        (groups) => step(gen.next(groups)),
        // the worker lane failed: cluster here rather than show nothing
        () => live && step(gen.next(clusterRowGroups(matrix, k)))
      )
    }
    step(gen.next())
    return () => {
      live = false
    }
    // key stands in for sampleOrder and the focus array's contents (stable across renders)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [std, key, runGroups])
  const heatmap = cached ?? last
  if (!heatmap) return <Spinner />
  const scope = focus.length > 0 ? `${heatmap.y.length} selected genes` : 'all genes'
  return (
    <HeatmapView
      heatmap={heatmap}
      title={`${heatmap.samples.length} samples · ${scope}, clustered`}
      orient={orient}
      valueLabel={quantityLabel(scale, valueUnitOf(std), !!plainScale)}
      plainScale={plainScale}
      condBar={condBar}
      palette={palette}
      numeric={numericOf(std)}
    />
  )
}
