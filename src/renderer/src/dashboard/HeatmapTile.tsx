/** Heatmap panel body. Clustering gene rows (average-linkage) is O(n²) and runs on
 *  the render thread, so the build is memoized on the data + display options — it
 *  recomputes only when the standardized result (or the scale it's presented on) changes,
 *  not on every parent re-render (tab switches, edit-mode toggles, …). `std` comes already on
 *  the scale Clean data's log-transform setting picks (presentStd), so it's drawn as given. */
import { useMemo } from 'react'

import { abundanceLabel, buildHeatmap, type StandardizeResult, type ValueScale } from '../engine'
import { HeatmapView } from '../ui/HeatmapView'

export function HeatmapTile({
  std,
  scale,
  focus = [],
  orient,
  condBar
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
}) {
  const focusKey = focus.join(',')
  const heatmap = useMemo(
    () => buildHeatmap(std.rows, { displayMap: std.displayMap, log10: false, focus }),
    // focusKey stands in for the focus array's contents (stable across renders)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [std, focusKey]
  )
  const scope = focus.length > 0 ? `${heatmap.y.length} selected genes` : 'all genes'
  return (
    <HeatmapView
      heatmap={heatmap}
      title={`${heatmap.samples.length} samples · ${scope}, clustered`}
      orient={orient}
      valueLabel={abundanceLabel(scale)}
      condBar={condBar}
    />
  )
}
