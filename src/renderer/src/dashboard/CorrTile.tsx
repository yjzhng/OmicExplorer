/** Sample-correlation heatmap panel body. The pairwise correlation is O(samples² × genes)
 *  on the render thread, so it's memoized on the standardized result + clustering flag (not
 *  every parent re-render). */
import { useMemo } from 'react'

import { buildSampleCorr, type StandardizeResult, type ValueScale } from '../engine'
import { CorrMatrixView } from '../ui/CorrMatrixView'
import type { PaletteRef } from '../ui/palettes'

export function CorrTile({
  std,
  cluster,
  scale,
  palette
}: {
  std: StandardizeResult
  cluster: boolean
  /** the scale abundance is shown on (plotScaleOf) — log or not changes the correlation */
  scale?: ValueScale
  /** the correlation palette (the plot's own, else Greens) */
  palette?: PaletteRef
}) {
  const data = useMemo(() => buildSampleCorr(std, { cluster, scale }), [std, cluster, scale])
  const title = `sample correlation (${data.labels.length} samples${cluster ? ', clustered' : ''})`
  return <CorrMatrixView data={data} title={title} palette={palette} />
}
