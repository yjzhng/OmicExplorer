/** Sample-correlation heatmap panel body: the plot's run (every metric's matrix, computed in the
 *  worker — O(samples² × genes) each) arranged for the metric, clustering and sample order on show
 *  (arrangeSampleCorr: a permutation, cheap). */
import { useMemo } from 'react'

import {
  arrangeSampleCorr,
  type CorrMetric,
  type SampleCorrAll,
  type SampleOrder,
  type StandardizeResult
} from '../../engine'
import { CorrMatrixView } from './CorrMatrixView'
import type { PaletteRef } from '../../ui/color/palettes'

export function CorrTile({
  all,
  std,
  cluster,
  palette,
  sampleOrder = 'natural',
  metric = 'pearson'
}: {
  /** how each sample pair is scored */
  metric?: CorrMetric
  /** the plot's run: every metric's matrix */
  all: SampleCorrAll
  /** the data it was computed from (its samples, for the unclustered order) */
  std: StandardizeResult
  cluster: boolean
  /** the samples' order while unclustered (natural: by condition; original: the data's) */
  sampleOrder?: SampleOrder
  /** the correlation palette (the plot's own, else Greens) */
  palette?: PaletteRef
}) {
  const data = useMemo(
    () =>
      arrangeSampleCorr(all, metric, {
        cluster,
        order: { by: sampleOrder, samples: std.samples }
      }),
    [all, std, cluster, sampleOrder, metric]
  )
  const title = `sample correlation (${data.labels.length} samples${cluster ? ', clustered' : ''})`
  return <CorrMatrixView data={data} title={title} palette={palette} />
}
