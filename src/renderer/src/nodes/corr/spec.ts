/** corr: its node contract (see nodes/contract.ts). */
import type { CorrConfig } from '../../graph/config/qc'
import { defineSpec } from '../contract'

export const corrSpec = defineSpec<'corr'>({
  kind: 'corr',
  label: 'Correlation',
  category: 'plotting',
  input: { accepts: ['quantity'] },
  output: null,
  hasRun: true,
  defaultConfig: (): CorrConfig => ({ cluster: true }),
  // its run scores every pair under every metric (in the worker); the tile's metric, clustering
  // and sample order only arrange it — another run only for a result from before it computed. (A
  // result missing the picked metric is kept: the view asks for a run on that metric alone, the
  // others still drawn.)
  staleOn: (_next, _prev, result) => result?.kind !== 'corr',
  plot: {
    computes: true,
    tileHint: 'Sample × sample correlation matrix. Select to view.',
    configurable: true,
    legend: true,
    axes: true,
    quick: { sampleOrder: false }
  }
})
