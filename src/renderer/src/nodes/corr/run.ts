/** The correlation plot's run: every sample pair under every metric (engine/buildSampleCorrAll), in
 *  the worker — every pair's pass over thousands of proteins (and Spearman's ranks) would otherwise
 *  hold up the UI. The tile's metric, clustering and sample order arrange it. */
import { analysisScaleOf } from '../../engine'
import { engine } from '../../engine/client'
import { holderTable } from '../../engine/lazyRows'
import type { NodeResult } from '../../graph/types'
import type { PlotRunContext } from '../runContext'
import { NotReady } from '../../shared/diagnostics'

export async function run(ctx: PlotRunContext): Promise<NodeResult> {
  const { upstream } = ctx
  if (upstream.kind !== 'standardize') throw new NotReady('Needs a Clean data upstream.')
  const std = upstream.std
  // a columnar table goes as its columns (none of its rows built here); scored on the analysis
  // scale (log as Clean data sets it)
  const corr = await engine.sampleCorr(
    holderTable(std) ?? std.rows,
    std.activeConditions,
    analysisScaleOf(std)
  )
  return { kind: 'corr', corr }
}
