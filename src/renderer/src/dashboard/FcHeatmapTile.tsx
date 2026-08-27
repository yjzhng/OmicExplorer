/** log₂FC heatmap panel body. Gene clustering is O(n²) on the render thread, so the pivot +
 *  cluster is memoized on the comparison rows + display options (not every parent re-render). */
import { useMemo } from 'react'

import { buildFcHeatmap, type CompareResultRow } from '../engine'
import { FcHeatmapView } from '../ui/FcHeatmapView'

export function FcHeatmapTile({
  rows,
  displayMap,
  maxGenes,
  focus = [],
  orient
}: {
  rows: CompareResultRow[]
  displayMap: Record<string, string>
  maxGenes: number
  /** focus genes (uniqIDs); when non-empty, show exactly these rows */
  focus?: string[]
  orient?: 'landscape' | 'portrait'
}) {
  const focusKey = focus.join(',')
  const data = useMemo(
    // Only genes differential (significant) in ≥1 comparison are shown — a focus pick overrides.
    () => buildFcHeatmap(rows, { displayMap, maxGenes, focus, differentialOnly: true }),
    // focusKey stands in for the focus array's contents (stable across renders)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, displayMap, maxGenes, focusKey]
  )
  const scope =
    focus.length > 0
      ? `${data.geneIds.length} focus genes`
      : maxGenes && maxGenes > 0
        ? `top ${Math.min(maxGenes, data.geneIds.length)} differential genes`
        : `${data.geneIds.length} differential genes`
  return (
    <FcHeatmapView data={data} title={`log₂ fold change (${scope}, clustered)`} orient={orient} />
  )
}
