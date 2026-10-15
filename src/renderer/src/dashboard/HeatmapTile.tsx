/** Heatmap panel body. Clustering gene rows (average-linkage) is O(n²) in time and memory — a
 *  full proteome's is seconds and a few hundred MB — so it runs in the UI worker lane
 *  (engineUi), off the UI thread: the tile pivots the data, hands the clustering out, and draws
 *  when it's back, keeping the previous heatmap up meanwhile. It rebuilds only when the
 *  standardized result (or the scale it's presented on) or the focus genes change, not on every
 *  parent re-render. `std` comes already on the scale Clean data's log-transform setting picks
 *  (presentStd), so it's drawn as given. */
import { useEffect, useState } from 'react'
import type { PaletteRef } from '../ui/palettes'

import {
  abundanceLabel,
  buildHeatmapSteps,
  clusterRowGroups,
  type HeatmapData,
  type SampleOrder,
  type StandardizeResult,
  type ValueScale
} from '../engine'
import { engineUi } from '../engine/client'
import { Spinner } from '../ui/Spinner'
import { HeatmapView } from '../ui/HeatmapView'

export function HeatmapTile({
  std,
  scale,
  focus = [],
  orient,
  condBar,
  palette,
  sampleOrder = 'natural'
}: {
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
}) {
  const focusKey = focus.join(',')
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null)
  useEffect(() => {
    let live = true
    const gen = buildHeatmapSteps(std.rows, {
      displayMap: std.displayMap,
      log10: false,
      focus,
      order: { by: sampleOrder, samples: std.samples }
    })
    const step = (r: ReturnType<typeof gen.next>): void => {
      if (!live) return
      if (r.done) return setHeatmap(r.value)
      const { matrix, k } = r.value
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
    // focusKey stands in for the focus array's contents (stable across renders)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [std, focusKey, sampleOrder])
  if (!heatmap) return <Spinner />
  const scope = focus.length > 0 ? `${heatmap.y.length} selected genes` : 'all genes'
  return (
    <HeatmapView
      heatmap={heatmap}
      title={`${heatmap.samples.length} samples · ${scope}, clustered`}
      orient={orient}
      valueLabel={abundanceLabel(scale)}
      condBar={condBar}
      palette={palette}
    />
  )
}
