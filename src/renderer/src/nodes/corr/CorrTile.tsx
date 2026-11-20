/** Sample-correlation heatmap panel body. The pairwise correlation is O(samples² × genes)
 *  on the render thread, so it's memoized on the standardized result + clustering flag (not
 *  every parent re-render). */
import { useMemo } from 'react'

import {
  buildSampleCorr,
  type SampleOrder,
  type StandardizeResult,
  type ValueScale
} from '../../engine'
import { CorrMatrixView } from './CorrMatrixView'
import type { PaletteRef } from '../../ui/palettes'

export function CorrTile({
  std,
  cluster,
  scale,
  palette,
  sampleOrder = 'natural'
}: {
  std: StandardizeResult
  cluster: boolean
  /** the samples' order while unclustered (natural: by condition; original: the data's) */
  sampleOrder?: SampleOrder
  /** the scale abundance is shown on (presentScaleOf) — log or not changes the correlation */
  scale?: ValueScale
  /** the correlation palette (the plot's own, else Greens) */
  palette?: PaletteRef
}) {
  const data = useMemo(
    () =>
      buildSampleCorr(std, {
        cluster,
        scale,
        order: { by: sampleOrder, samples: std.samples }
      }),
    [std, cluster, scale, sampleOrder]
  )
  const title = `sample correlation (${data.labels.length} samples${cluster ? ', clustered' : ''})`
  return <CorrMatrixView data={data} title={title} palette={palette} />
}
