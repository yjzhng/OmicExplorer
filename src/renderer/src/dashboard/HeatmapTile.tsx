/** Heatmap panel body. Clustering gene rows (average-linkage) is O(n²) and runs on
 *  the render thread, so the build is memoized on the data + display options — it
 *  recomputes only when the standardized result or the log10 setting changes,
 *  not on every parent re-render (tab switches, edit-mode toggles, …). */
import { useMemo } from 'react'

import { buildHeatmap, type StandardizeResult } from '../engine'
import { HeatmapView } from '../ui/HeatmapView'

export function HeatmapTile({
  std,
  log10,
  focus = [],
  orient
}: {
  std: StandardizeResult
  log10: boolean
  /** selected genes (uniqIDs); when non-empty, show exactly these rows */
  focus?: string[]
  /** landscape = genes across x; portrait (default) = genes down y */
  orient?: 'landscape' | 'portrait'
}) {
  const focusKey = focus.join(',')
  const heatmap = useMemo(
    () => buildHeatmap(std.rows, { displayMap: std.displayMap, log10, focus }),
    // focusKey stands in for the focus array's contents (stable across renders)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [std, log10, focusKey]
  )
  const scope = focus.length > 0 ? `${heatmap.y.length} selected genes` : 'all genes'
  return (
    <HeatmapView
      heatmap={heatmap}
      title={`${heatmap.samples.length} samples · ${scope}, clustered`}
      orient={orient}
    />
  )
}
