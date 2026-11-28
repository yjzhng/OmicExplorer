/** The heatmap's run: its clustering, built whole in the UI worker lane (let go once idle — a full
 *  proteome's distance matrix is a few hundred MB), so the tile draws from it at once instead of
 *  clustering each time it mounts. Only the result's columnar table goes over: no row is built, nor
 *  any pivot made, on the UI thread.
 *  - From Clean data: the gene rows' cluster groups (each as its genes), on the scale the heatmap
 *    shows (presentScaleOf). The sample order only rearranges the columns, so it needs no run.
 *  - From a Compare / Curve fit: the built fold-change heatmap under the tile's clustering settings
 *    (runKey; a change to one runs it again — the spec's staleOn), for the overall rows and, from a
 *    two-way ANOVA, the factors rows too (the tile's show switch, or its group's, picks one).
 *  "Genes: Selected" still clusters just the selected genes on the tile; so does the tile when the
 *  worker lane fails (the result then carries no clustering). */
import { buildFcHeatmap, hasTermRows, presentScaleOf, type FcHeatmapData } from '../../engine'
import { engineUi } from '../../engine/client'
import { holderTable } from '../../engine/columns/lazyRows'
import { topSplitOf } from '../../graph/config/plotStyle'
import type { HeatmapConfig } from '../../graph/config/heatmap'
import type { NodeResult } from '../../graph/types'
import { cmpOfKind } from '../kit/cmpOfKind'
import type { PlotRunContext } from '../runContext'
import { fcHeatmapRunKey, fcHeatmapRunOpts } from './runKey'

/** One row set's fold-change heatmap, as FcHeatmapTile builds it with no gene picked. */
async function buildFc(
  holder: Parameters<typeof cmpOfKind>[0],
  displayMap: Record<string, string>,
  cfg: HeatmapConfig
): Promise<FcHeatmapData> {
  const o = fcHeatmapRunOpts(cfg)
  const opts = {
    displayMap,
    maxGenes: o.maxGenes,
    split: topSplitOf(o),
    focus: [],
    differentialOnly: true,
    linkage: o.linkage,
    leafOrder: o.leafOrder,
    colPattern: o.colPattern
  }
  // the worker lane failed: build it here rather than fail the run
  return engineUi
    .fcHeatmap(holderTable(holder) ?? holder.rows, opts)
    .catch(() => buildFcHeatmap([...holder.rows], opts))
}

export async function run(ctx: PlotRunContext): Promise<NodeResult> {
  const { upstream } = ctx
  const cfg = ctx.config as HeatmapConfig
  if (upstream.kind === 'compare') {
    const terms = hasTermRows(upstream.cmp)
    const overall = await buildFc(cmpOfKind(upstream.cmp, 'overall'), upstream.displayMap, cfg)
    const factors = terms
      ? await buildFc(cmpOfKind(upstream.cmp, 'factors'), upstream.displayMap, cfg)
      : undefined
    return {
      kind: 'heatmap',
      fc: { key: fcHeatmapRunKey(cfg), overall, ...(factors ? { factors } : null) }
    }
  }
  if (upstream.kind !== 'standardize') return { kind: 'plot' }
  const std = upstream.std
  const scale = presentScaleOf(std)
  try {
    const { n, groups } = await engineUi.heatmapGroups(holderTable(std) ?? std.rows, scale)
    return { kind: 'heatmap', std: { scale, n, groups } }
  } catch {
    // the worker lane failed: the tile clusters (in its own worker call, or here as a last resort)
    return { kind: 'heatmap' }
  }
}
