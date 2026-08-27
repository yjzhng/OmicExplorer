/** Sample-correlation heatmap panel body. The pairwise correlation is O(samples² × genes)
 *  on the render thread, so it's memoized on the standardized result + clustering flag (not
 *  every parent re-render). */
import { useMemo } from 'react'

import { buildSampleCorr, type StandardizeResult } from '../engine'
import { CorrMatrixView } from '../ui/CorrMatrixView'

export function CorrTile({
  std,
  cluster
}: {
  std: StandardizeResult
  cluster: boolean
}) {
  const data = useMemo(() => buildSampleCorr(std, { cluster }), [std, cluster])
  const title = `sample correlation (${data.labels.length} samples${cluster ? ', clustered' : ''})`
  return <CorrMatrixView data={data} title={title} />
}
